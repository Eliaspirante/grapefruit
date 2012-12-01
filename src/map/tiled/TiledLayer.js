(function() {
    //Shaders
    var vShader = [
        'varying vec2 pixelCoord;',
        'varying vec2 texCoord;',

        'uniform vec2 mapSize;',
        'uniform vec2 inverseLayerSize;',
        //'uniform vec2 inverseTilesetSize;',

        //'uniform vec2 tileSize;',
        'uniform vec2 inverseTileSize;',
        //'uniform vec2 numTiles;',

        //'uniform sampler2D tileset;',
        //'uniform sampler2D tileIds;'
        //'uniform int repeatTiles;',
        //'uniform float opacity;',
        'uniform float bias;',
        'uniform float inverseScale;',

        'void main(void) {',
        '   pixelCoord = (uv * mapSize) - ((1.0 - bias) * inverseScale);', //this bias fixes a strange wrapping error
        '   texCoord = pixelCoord * inverseLayerSize * inverseTileSize;', //calculate the coord on this map
        '   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);', //hand this position to WebGL
        '}'
    ].join('\n');

    var fShader = [
        //"precision highp float;",

        'varying vec2 pixelCoord;',         
        'varying vec2 texCoord;',

        //'uniform vec2 mapSize;',
        //'uniform vec2 inverseLayerSize;',
        'uniform vec2 inverseTilesetSize;',

        'uniform vec2 tileSize;',
        //'uniform vec2 inverseTileSize;',
        'uniform vec2 numTiles;',

        'uniform sampler2D tileset;',
        'uniform sampler2D tileIds;',
        'uniform int repeatTiles;',
        'uniform float opacity;',
        'uniform float bias;',
        'uniform float inverseScale;',

        'float decode24(vec3 rgb) {',
        '   const vec3 bit_shift = vec3((256.0*256.0), 256.0, 1.0);',
        '   float fl = dot(rgb, bit_shift);', //shift the values appropriately
        '   return fl * 255.0;', //denormalize the value
        '}',

        'void main(void) {',
        '   if(repeatTiles == 0 && (texCoord.x < 0.0 || texCoord.x > 1.0 || texCoord.y < 0.0 || texCoord.y > 1.0)) { discard; }',

        '   vec3 tileId = texture2D(tileIds, texCoord).rgb;', //grab this tileId from the layer data
        //'   tileId.rgb = tileId.bgr;', //if some hardware is different endian (little?) then we need to flip here
        '   float tileValue = decode24(tileId);', //decode the normalized vec3 into the float ID
        '   vec2 tileLoc = vec2(mod(tileValue, numTiles.x), tileValue / numTiles.x);', //convert the ID into x, y coords
        '   tileLoc.x = tileLoc.x - (bias * inverseScale);', //the bias fixes a precision error by making the later floor go down by 1
        '   tileLoc.y = numTiles.y - tileLoc.y;', //convert the coord from bottomleft to topleft

        '   vec2 offset = (floor(tileLoc) * tileSize) + (bias * inverseScale);', //offset in the tileset; the bias removes the spacing between tiles
        '   vec2 coord = mod(pixelCoord, tileSize);', //coord of the tile

        '   vec4 color = texture2D(tileset, (offset + coord) * inverseTilesetSize);', //grab tile from tileset
        '   color.a = opacity;', //set opacity of this layer
        '   gl_FragColor = color;',
        '}'
    ].join('\n');

    //Each tilemap layer is just a Plane object with the map drawn on it
    gf.TiledLayer = gf.Layer.extend({
        init: function(layer, tileSize, tilesets) {
            this._super(layer);

            //set options
            this.dataBuffer = new ArrayBuffer(layer.data.length * 3);
            this.data = new Uint32Array(this.dataBuffer);
            this.data8 = new Uint8Array(this.dataBuffer);
            this.tileSize = tileSize;

            this.repeat = false;
            this.filtered = false;

            //TODO: only works with 1 tileset right now, so assume the first one :/
            this.tileset = tilesets[0];

            //pack our layer data array into an 8-bit uint array
            for (var i = 0, y = 0, il = layer.data.length; i < il; ++i, y += 3) {
                var value = layer.data[i];

                //this.data[y + 0] = (value & 0xff000000) >> 24;
                this.data8[y + 0] = (value & 0x00ff0000) >> 16;
                this.data8[y + 1] = (value & 0x0000ff00) >> 8;
                this.data8[y + 2] = (value & 0x000000ff);
            }

            //Setup Tileset
            this.tileset.texture.wrapS = this.tileset.texture.wrapT = THREE.ClampToEdgeWrapping;
            //this.tileset.flipY = false;
            if(this.filtered) {
                this.tileset.texture.magFilter = THREE.LinearFilter;
                this.tileset.texture.minFilter = THREE.LinearMipMapLinearFilter;
            } else {
                this.tileset.texture.magFilter = THREE.NearestFilter;
                this.tileset.texture.minFilter = THREE.NearestMipMapNearestFilter;
            }

            //For some reason I have to make the mesh in `init` or it explodes!
            this.dataTex = new THREE.DataTexture(
                                this.data8,
                                this.size.x, //width
                                this.size.y, //height
                                THREE.RGBFormat, //format
                                THREE.UnsignedByteType, //type
                                THREE.UVMapping, //mapping
                                THREE.ClampToEdgeWrapping, //wrapS
                                THREE.ClampToEdgeWrapping, //wrapT
                                THREE.NearestFilter, //magFilter
                                THREE.NearestMipMapNearestFilter //minFilter
                            );
            this.dataTex.needsUpdate = true;

            //setup shader uniforms
            //
            //Types:
            // i - integer
            // f - float
            // c - color
            // t - Texture
            // tv - array of Textures
            // m4 - Matrix4
            // m4v - array of Matrix4s
            // iv - array of integers with 3 x N size
            // iv1 - array of integers
            // fv - array of floats with 3 x N size
            // fv1 - array of floats
            // v2 - Vector2
            // v3 - Vector3
            // v4 - Vector4
            // v2v - array of Vector2s
            // v3v - array of Vector3s
            // v4v - array of Vector4s
            this._uniforms = {
                mapSize:            { type: 'v2', value: new THREE.Vector2(this.size.x * this.tileSize.x, this.size.y * this.tileSize.y) },
                inverseLayerSize:   { type: 'v2', value: new THREE.Vector2(1 / this.size.x, 1 / this.size.y) },
                inverseTilesetSize: { type: 'v2', value: new THREE.Vector2(1 / this.tileset.texture.image.width, 1 / this.tileset.texture.image.height) },

                tileSize:           { type: 'v2', value: this.tileSize },
                inverseTileSize:    { type: 'v2', value: new THREE.Vector2(1 / this.tileSize.x, 1 / this.tileSize.y) },
                numTiles:           { type: 'v2', value: new THREE.Vector2(this.tileset.texture.image.width / this.tileSize.x, this.tileset.texture.image.height / this.tileSize.y) },

                tileset:            { type: 't', value: this.tileset.texture },
                tileIds:            { type: 't', value: this.dataTex },
                repeatTiles:        { type: 'i', value: this.repeat ? 1 : 0 },
                opacity:            { type: 'f', value: this.opacity },
                bias:               { type: 'f', value: 0.002 },
                inverseScale:       { type: 'f', value: 1 / this.scale }
            };

            if(gf.debug.accessTiledUniforms)
                gf.debug.tiledUniforms.push(this._uniforms);

            //create the shader material
            this._material = new THREE.ShaderMaterial({
                uniforms: this._uniforms,
                vertexShader: vShader,
                fragmentShader: fShader,
                transparent: (this.opacity !== 1) //if the opacity isn't 1.0, then this needs to be transparent
            });

            this._plane = new THREE.PlaneGeometry(
                this.size.x * this.tileSize.x * this.scale,
                this.size.y * this.tileSize.y * this.scale
            );

            this._mesh = new THREE.Mesh(this._plane, this._material);
            this._mesh.visible = this.visible;
            this._mesh.position.z = this.zIndex;
        },
        //get ID of tile at specified location
        getTileId: function(x, y) {
            if(x instanceof THREE.Vector2 || x instanceof THREE.Vector3) {
                y = x.y;
                x = x.x;
            }

            var idx = (x + (y * (this.tileset.texture.image.width / this.tileSize.x)));

            return this.data[idx];
        }
        //skip parent creating mesh
        _createMesh: function() {}
    });
})();