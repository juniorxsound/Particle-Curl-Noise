import * as THREE from 'three';

var gui;
var now = Date.now();

var width = 0;
var height = 0;

var TEXTURE_SIZE = 256;
var AMOUNT = TEXTURE_SIZE * TEXTURE_SIZE;

var camera;
var scene;
var renderer;

var particles;
var geometry;
var copyShader;
var velocityShader;
var velocity4dShader;
var positionShader;
var velocityRenderTarget;
var positionRenderTarget;
var positionRenderTarget2;
var fboMesh;
var fboScene;
var fboCamera;

var config = {
    color1: '#ffffff',
    color2: '#ffcd2d',
    speed: 0.3,
    use4d: true,
    message: 'fire'
};

function preInit() {

    renderer = new THREE.WebGLRenderer({});

    var gl = renderer.getContext();

    if (!gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)) {
        alert('No support for vertex shader textures!');
        return;
    }
    // high precision
    if (!gl.getExtension('OES_texture_float')) {
        alert('No OES_texture_float support for float textures!');
        return;
    }

    camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
    camera.position.z = 1000;
    scene = new THREE.Scene();

    document.body.appendChild(renderer.domElement);

    geometry = new THREE.BufferGeometry();
    geometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(AMOUNT * 3), 3));

    var fboUV = new Float32Array(AMOUNT * 2);
    geometry.addAttribute('fboUV', new THREE.BufferAttribute(fboUV, 2));
    for (var i = 0; i < AMOUNT; i++) {
        fboUV[i * 2] = (i % TEXTURE_SIZE) / TEXTURE_SIZE;
        fboUV[i * 2 + 1] = ~~(i / TEXTURE_SIZE) / TEXTURE_SIZE;
    }

    var material = new THREE.ShaderMaterial({
        uniforms: {
            texturePosition: {
                type: 't',
                value: null
            },
            color1: {
                type: 'c',
                value: new THREE.Color(config.color1)
            },
            color2: {
                type: 'c',
                value: new THREE.Color(config.color2)
            },
            opacity: {
                type: 'f',
                value: 0.25
            },
            sizeBase: {
                type: 'f',
                value: 0
            },
            sizeExtra: {
                type: 'f',
                value: 9.9
            },
            hardness: {
                type: 'f',
                value: 0.16
            }
        },
        vertexShader: "#define GLSLIFY 1\n\n// uniform mat4 modelViewMatrix;\n// uniform mat4 projectionMatrix;\n// attribute vec3 position;\n\nattribute vec2 fboUV;\n\nvarying float vColor;\nvarying float vAlpha;\n\nuniform sampler2D texturePosition;\nuniform float opacity;\nuniform float sizeBase;\nuniform float sizeExtra;\n\nhighp float random_1_0(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n\n\nvoid main() {\n    vec3 pos = texture2D( texturePosition, fboUV ).xyz;\n\n    float r = (1.0 - cos(smoothstep(500.0, 300.0, pos.x) * 3.141592654)) * 0.5;\n    pos.yz *= r;\n\n    pos.x = clamp(pos.x, -500.0, 500.0);\n\n    vColor = random_1_0(fboUV + vec2(23.0, 31.22));\n\n    gl_Position = projectionMatrix * viewMatrix  * vec4( pos, 1.0 );\n\n    vAlpha = smoothstep(-500.0 + 200.0 * random_1_0(fboUV + 1.0), -200.0, pos.x) * clamp(1000.0 / gl_Position.z, 0.0, 1.0) * opacity;\n\n    gl_PointSize = (sizeBase + random_1_0(fboUV) * sizeExtra) * (500.0 / gl_Position.z);\n\n}\n",
        fragmentShader: "#define GLSLIFY 1\n\nvarying float vColor;\n\nvarying float vAlpha;\n\nuniform vec3 color1;\nuniform vec3 color2;\nuniform float hardness;\n\nvoid main() {\n\n    float d = length(gl_PointCoord.xy - .5) * 2.0;\n\n    float c = 1.0 - smoothstep(hardness, 1.0, d);\n    // float c = 1.0 - d;\n\n    gl_FragColor = vec4(mix(\n        color1,\n        color2,\n        vColor) * c, 1.0) * vAlpha;\n}\n",
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: true,
        depthTest: false
    });

    particles = new THREE.Points(geometry, material);
    scene.add(particles);

    initFbo();

    gui = new dat.GUI();
    gui.addColor(config, 'color1').listen().onChange(onColorChange.bind(material.uniforms.color1.value));
    gui.addColor(config, 'color2').listen().onChange(onColorChange.bind(material.uniforms.color2.value));
    gui.add(material.uniforms.opacity, 'value', 0, 1).name('opacity').listen();
    gui.add(material.uniforms.sizeBase, 'value', 0, 8).name('sizeBase').listen();
    gui.add(material.uniforms.sizeExtra, 'value', 0, 48).name('sizeExtra').listen();
    gui.add(material.uniforms.hardness, 'value', 0, 1).name('hardness').listen();
    gui.add(config, 'speed', 0, 3).listen();
    gui.add(config, 'use4d');

    window.addEventListener('resize', onResize);
    window.addEventListener('mousedown', () => {
        console.log(positionRenderTarget);
        console.log(positionRenderTarget2);
        // copyTexture(createVelocityTexture(), velocityRenderTarget);
        copyTexture(createPositionTexture(), positionRenderTarget);
        // copyTexture(positionRenderTarget, positionRenderTarget2);
    });
    onResize();
    loop();
}

function onColorChange(value) {
    this.setHex(value.replace('#', '0x'));
}

function initFbo() {

    fboScene = new THREE.Scene();
    fboCamera = new THREE.Camera();
    fboCamera.position.z = 1;

    copyShader = new THREE.ShaderMaterial({
        uniforms: {
            resolution: {
                type: 'v2',
                value: new THREE.Vector2(TEXTURE_SIZE, TEXTURE_SIZE)
            },
            texture: {
                type: 't',
                value: null
            }
        },
        vertexShader: "#define GLSLIFY 1\n\nvoid main() {\n    gl_Position = vec4( position, 1.0 );\n}\n",
        fragmentShader: "#define GLSLIFY 1\n\nuniform vec2 resolution;\nuniform sampler2D texture;\n\nvoid main() {\n    vec2 uv = gl_FragCoord.xy / resolution.xy;\n    vec3 color = texture2D( texture, uv ).xyz;\n    gl_FragColor = vec4( color, 1.0 );\n}\n"
    });

    velocityShader = new THREE.ShaderMaterial({
        uniforms: {
            time: {
                type: 'f',
                value: 0.0
            },
            speed: {
                type: 'f',
                value: 1.0
            },
            resolution: {
                type: 'v2',
                value: new THREE.Vector2(TEXTURE_SIZE, TEXTURE_SIZE)
            },
            texturePosition: {
                type: 't',
                value: null
            }
        },
        vertexShader: "#define GLSLIFY 1\n\nvoid main() {\n    gl_Position = vec4( position, 1.0 );\n}\n",
        fragmentShader: "#define GLSLIFY 1\n\nuniform vec2 resolution;\n\nuniform sampler2D texturePosition;\n\nuniform float speed;\n\n//\n// Description : Array and textureless GLSL 2D/3D/4D simplex\n//               noise functions.\n//      Author : Ian McEwan, Ashima Arts.\n//  Maintainer : ijm\n//     Lastmod : 20110822 (ijm)\n//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.\n//               Distributed under the MIT License. See LICENSE file.\n//               https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_3_0(vec3 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_3_0(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_3_1(vec4 x) {\n     return mod289_3_0(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_3_2(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nfloat snoise_3_3(vec3 v)\n  {\n  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;\n  const vec4  D_3_4 = vec4(0.0, 0.5, 1.0, 2.0);\n\n// First corner\n  vec3 i  = floor(v + dot(v, C.yyy) );\n  vec3 x0 =   v - i + dot(i, C.xxx) ;\n\n// Other corners\n  vec3 g_3_5 = step(x0.yzx, x0.xyz);\n  vec3 l = 1.0 - g_3_5;\n  vec3 i1 = min( g_3_5.xyz, l.zxy );\n  vec3 i2 = max( g_3_5.xyz, l.zxy );\n\n  //   x0 = x0 - 0.0 + 0.0 * C.xxx;\n  //   x1 = x0 - i1  + 1.0 * C.xxx;\n  //   x2 = x0 - i2  + 2.0 * C.xxx;\n  //   x3 = x0 - 1.0 + 3.0 * C.xxx;\n  vec3 x1 = x0 - i1 + C.xxx;\n  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y\n  vec3 x3 = x0 - D_3_4.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y\n\n// Permutations\n  i = mod289_3_0(i);\n  vec4 p = permute_3_1( permute_3_1( permute_3_1(\n             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))\n           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))\n           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));\n\n// Gradients: 7x7 points over a square, mapped onto an octahedron.\n// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)\n  float n_ = 0.142857142857; // 1.0/7.0\n  vec3  ns = n_ * D_3_4.wyz - D_3_4.xzx;\n\n  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)\n\n  vec4 x_ = floor(j * ns.z);\n  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)\n\n  vec4 x = x_ *ns.x + ns.yyyy;\n  vec4 y = y_ *ns.x + ns.yyyy;\n  vec4 h = 1.0 - abs(x) - abs(y);\n\n  vec4 b0 = vec4( x.xy, y.xy );\n  vec4 b1 = vec4( x.zw, y.zw );\n\n  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;\n  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;\n  vec4 s0 = floor(b0)*2.0 + 1.0;\n  vec4 s1 = floor(b1)*2.0 + 1.0;\n  vec4 sh = -step(h, vec4(0.0));\n\n  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;\n  vec4 a1_3_6 = b1.xzyw + s1.xzyw*sh.zzww ;\n\n  vec3 p0_3_7 = vec3(a0.xy,h.x);\n  vec3 p1 = vec3(a0.zw,h.y);\n  vec3 p2 = vec3(a1_3_6.xy,h.z);\n  vec3 p3 = vec3(a1_3_6.zw,h.w);\n\n//Normalise gradients\n  vec4 norm = taylorInvSqrt_3_2(vec4(dot(p0_3_7,p0_3_7), dot(p1,p1), dot(p2, p2), dot(p3,p3)));\n  p0_3_7 *= norm.x;\n  p1 *= norm.y;\n  p2 *= norm.z;\n  p3 *= norm.w;\n\n// Mix final noise value\n  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);\n  m = m * m;\n  return 42.0 * dot( m*m, vec4( dot(p0_3_7,x0), dot(p1,x1),\n                                dot(p2,x2), dot(p3,x3) ) );\n  }\n\n\n\n\nvec3 snoiseVec3_1_8( vec3 x ){\n\n  float s  = snoise_3_3(vec3( x ));\n  float s1 = snoise_3_3(vec3( x.y - 19.1 , x.z + 33.4 , x.x + 47.2 ));\n  float s2 = snoise_3_3(vec3( x.z + 74.2 , x.x - 124.5 , x.y + 99.4 ));\n  vec3 c = vec3( s , s1 , s2 );\n  return c;\n\n}\n\n\nvec3 curlNoise_1_9( vec3 p ){\n  \n  const float e = .1;\n  vec3 dx = vec3( e   , 0.0 , 0.0 );\n  vec3 dy = vec3( 0.0 , e   , 0.0 );\n  vec3 dz = vec3( 0.0 , 0.0 , e   );\n\n  vec3 p_x0 = snoiseVec3_1_8( p - dx );\n  vec3 p_x1 = snoiseVec3_1_8( p + dx );\n  vec3 p_y0 = snoiseVec3_1_8( p - dy );\n  vec3 p_y1 = snoiseVec3_1_8( p + dy );\n  vec3 p_z0 = snoiseVec3_1_8( p - dz );\n  vec3 p_z1 = snoiseVec3_1_8( p + dz );\n\n  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;\n  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;\n  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;\n\n  const float divisor = 1.0 / ( 2.0 * e );\n  return normalize( vec3( x , y , z ) * divisor );\n\n}\n\n\n\nhighp float random_2_10(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n\n\nvoid main() {\n\n    vec2 uv = gl_FragCoord.xy / resolution.xy;\n    vec3 position = texture2D( texturePosition, uv ).xyz;\n\n    vec3 velocity = curlNoise_1_9(position * 0.02) * 0.1;\n\n    float l = pow(smoothstep(500.0, -500.0,  position.x), 2.0);\n\n    velocity.x += -0.05 + l * - (0.2 + random_2_10(uv) * 0.2);\n\n    velocity.x = clamp(velocity.x, -5.0, -0.01);\n\n    velocity *= speed;\n\n    gl_FragColor = vec4( velocity, 1.0 );\n\n}\n"
    });

    velocity4dShader = new THREE.ShaderMaterial({
        uniforms: {
            time: {
                type: 'f',
                value: 0.0
            },
            speed: {
                type: 'f',
                value: 1.0
            },
            resolution: {
                type: 'v2',
                value: new THREE.Vector2(TEXTURE_SIZE, TEXTURE_SIZE)
            },
            texturePosition: {
                type: 't',
                value: null
            }
        },
        vertexShader: "#define GLSLIFY 1\n\nvoid main() {\n    gl_Position = vec4( position, 1.0 );\n}\n",
        fragmentShader: "#define GLSLIFY 1\n\nuniform vec2 resolution;\n\nuniform sampler2D texturePosition;\n\nuniform float time;\nuniform float speed;\n\n//\n// Description : Array and textureless GLSL 2D/3D/4D simplex\n//               noise functions.\n//      Author : Ian McEwan, Ashima Arts.\n//  Maintainer : ijm\n//     Lastmod : 20110822 (ijm)\n//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.\n//               Distributed under the MIT License. See LICENSE file.\n//               https://github.com/ashima/webgl-noise\n//\n\nvec4 mod289_2_0(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0; }\n\nfloat mod289_2_0(float x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0; }\n\nvec4 permute_2_1(vec4 x) {\n     return mod289_2_0(((x*34.0)+1.0)*x);\n}\n\nfloat permute_2_1(float x) {\n     return mod289_2_0(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_2_2(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nfloat taylorInvSqrt_2_2(float r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec4 grad4_2_3(float j, vec4 ip)\n  {\n  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);\n  vec4 p,s;\n\n  p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;\n  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);\n  s = vec4(lessThan(p, vec4(0.0)));\n  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;\n\n  return p;\n  }\n\n// (sqrt(5) - 1)/4 = F4, used once below\n#define F4 0.309016994374947451\n\nfloat snoise_2_4(vec4 v)\n  {\n  const vec4  C = vec4( 0.138196601125011,  // (5 - sqrt(5))/20  G4\n                        0.276393202250021,  // 2 * G4\n                        0.414589803375032,  // 3 * G4\n                       -0.447213595499958); // -1 + 4 * G4\n\n// First corner\n  vec4 i  = floor(v + dot(v, vec4(F4)) );\n  vec4 x0 = v -   i + dot(i, C.xxxx);\n\n// Other corners\n\n// Rank sorting originally contributed by Bill Licea-Kane, AMD (formerly ATI)\n  vec4 i0;\n  vec3 isX = step( x0.yzw, x0.xxx );\n  vec3 isYZ = step( x0.zww, x0.yyz );\n//  i0.x = dot( isX, vec3( 1.0 ) );\n  i0.x = isX.x + isX.y + isX.z;\n  i0.yzw = 1.0 - isX;\n//  i0.y += dot( isYZ.xy, vec2( 1.0 ) );\n  i0.y += isYZ.x + isYZ.y;\n  i0.zw += 1.0 - isYZ.xy;\n  i0.z += isYZ.z;\n  i0.w += 1.0 - isYZ.z;\n\n  // i0 now contains the unique values 0,1,2,3 in each channel\n  vec4 i3 = clamp( i0, 0.0, 1.0 );\n  vec4 i2 = clamp( i0-1.0, 0.0, 1.0 );\n  vec4 i1 = clamp( i0-2.0, 0.0, 1.0 );\n\n  //  x0 = x0 - 0.0 + 0.0 * C.xxxx\n  //  x1 = x0 - i1  + 1.0 * C.xxxx\n  //  x2 = x0 - i2  + 2.0 * C.xxxx\n  //  x3 = x0 - i3  + 3.0 * C.xxxx\n  //  x4 = x0 - 1.0 + 4.0 * C.xxxx\n  vec4 x1 = x0 - i1 + C.xxxx;\n  vec4 x2 = x0 - i2 + C.yyyy;\n  vec4 x3 = x0 - i3 + C.zzzz;\n  vec4 x4 = x0 + C.wwww;\n\n// Permutations\n  i = mod289_2_0(i);\n  float j0 = permute_2_1( permute_2_1( permute_2_1( permute_2_1(i.w) + i.z) + i.y) + i.x);\n  vec4 j1 = permute_2_1( permute_2_1( permute_2_1( permute_2_1 (\n             i.w + vec4(i1.w, i2.w, i3.w, 1.0 ))\n           + i.z + vec4(i1.z, i2.z, i3.z, 1.0 ))\n           + i.y + vec4(i1.y, i2.y, i3.y, 1.0 ))\n           + i.x + vec4(i1.x, i2.x, i3.x, 1.0 ));\n\n// Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope\n// 7*7*6 = 294, which is close to the ring size 17*17 = 289.\n  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0) ;\n\n  vec4 p0_2_5 = grad4_2_3(j0,   ip);\n  vec4 p1 = grad4_2_3(j1.x, ip);\n  vec4 p2 = grad4_2_3(j1.y, ip);\n  vec4 p3 = grad4_2_3(j1.z, ip);\n  vec4 p4 = grad4_2_3(j1.w, ip);\n\n// Normalise gradients\n  vec4 norm = taylorInvSqrt_2_2(vec4(dot(p0_2_5,p0_2_5), dot(p1,p1), dot(p2, p2), dot(p3,p3)));\n  p0_2_5 *= norm.x;\n  p1 *= norm.y;\n  p2 *= norm.z;\n  p3 *= norm.w;\n  p4 *= taylorInvSqrt_2_2(dot(p4,p4));\n\n// Mix contributions from the five corners\n  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);\n  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)            ), 0.0);\n  m0 = m0 * m0;\n  m1 = m1 * m1;\n  return 49.0 * ( dot(m0*m0, vec3( dot( p0_2_5, x0 ), dot( p1, x1 ), dot( p2, x2 )))\n               + dot(m1*m1, vec2( dot( p3, x3 ), dot( p4, x4 ) ) ) ) ;\n\n  }\n\n\n\n\nvec4 snoiseVec4_1_6( vec4 x ){\n\n  float s  = snoise_2_4(vec4( x ));\n  float s1 = snoise_2_4(vec4( x.y - 19.1 , x.z + 33.4 , x.w + 47.2 , x.x + 12.2 ));\n  float s2 = snoise_2_4(vec4( x.z + 74.2 , x.w - 124.5 , x.x + 99.4 , x.y - 123.2 ));\n  float s3 = snoise_2_4(vec4( x.w + 21.2 , x.x - 52.5 , x.y + 60.4 , x.z + 42.2 ));\n  vec4 c = vec4( s , s1 , s2 , s3 );\n  return c;\n\n}\n\n\nvec4 curlNoise_1_7( vec4 p ){\n\n  const float e = .1;\n  vec4 dx = vec4( e   , 0.0 , 0.0 , 0.0 );\n  vec4 dy = vec4( 0.0 , e   , 0.0 , 0.0 );\n  vec4 dz = vec4( 0.0 , 0.0 , e   , 0.0 );\n  vec4 dw = vec4( 0.0 , 0.0 , 0.0 , e  );\n\n  vec4 p_x0 = snoiseVec4_1_6( p - dx );\n  vec4 p_x1 = snoiseVec4_1_6( p + dx );\n  vec4 p_y0 = snoiseVec4_1_6( p - dy );\n  vec4 p_y1 = snoiseVec4_1_6( p + dy );\n  vec4 p_z0 = snoiseVec4_1_6( p - dz );\n  vec4 p_z1 = snoiseVec4_1_6( p + dz );\n  vec4 p_w0 = snoiseVec4_1_6( p - dw );\n  vec4 p_w1 = snoiseVec4_1_6( p + dw );\n\n  float x = p_y1.z - p_y0.z - p_z1.w + p_z0.w + p_w0.y - p_w1.y;\n  float y = p_z1.w - p_z0.w - p_w1.x + p_w0.x + p_x0.z - p_x1.z;\n  float z = p_w1.x - p_w0.x - p_x1.y + p_x0.y + p_y0.w - p_y1.w;\n  float w = p_x1.y - p_x0.y - p_y1.z + p_y0.z + p_z0.x - p_y1.x;\n\n  const float divisor = 1.0 / ( 2.0 * e );\n  return normalize( vec4( x , y , z, w ) * divisor );\n\n}\n\n\n\nhighp float random_3_8(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n\n\nvoid main() {\n\n    vec2 uv = gl_FragCoord.xy / resolution.xy;\n    vec3 position = texture2D( texturePosition, uv ).xyz;\n\n    vec3 velocity = curlNoise_1_7(vec4(position * 0.02, time * 0.001 * speed)).xyz * 0.1;\n\n    float l = pow(smoothstep(500.0, -500.0,  position.x), 2.0);\n\n    velocity.x += -0.05 + l * - (0.2 + random_3_8(uv) * 0.2);\n\n    velocity.x = clamp(velocity.x, -5.0, -0.01);\n\n    velocity *= speed;\n\n    gl_FragColor = vec4( velocity, 1.0 );\n\n}\n"
    });

    positionShader = new THREE.ShaderMaterial({
        uniforms: {
            delta: {
                type: 'f',
                value: 0.0
            },
            resolution: {
                type: 'v2',
                value: new THREE.Vector2(TEXTURE_SIZE, TEXTURE_SIZE)
            },
            texturePosition: {
                type: 't',
                value: null
            },
            textureVelocity: {
                type: 't',
                value: null
            }
        },
        vertexShader: "#define GLSLIFY 1\n\nvoid main() {\n    gl_Position = vec4( position, 1.0 );\n}\n",
        fragmentShader: "#define GLSLIFY 1\n\nuniform vec2 resolution;\nuniform sampler2D textureVelocity;\nuniform sampler2D texturePosition;\n\nuniform float delta;\n\nhighp float random_1_0(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n\n\nvoid main() {\n\n    vec2 uv = gl_FragCoord.xy / resolution.xy;\n    vec3 position = texture2D( texturePosition, uv ).xyz;\n    vec3 velocity = texture2D( textureVelocity, uv ).xyz;\n\n    position += velocity * delta * 1.0;\n\n    if(position.x < -500.0) {\n        position.x = 500.0 + random_1_0(uv + vec2(21.3, 63.21)) * 500.0;\n        position.y = random_1_0(uv + vec2(32.3, 734.21));\n        position.z = random_1_0(uv + vec2(127.3, 31.21));\n    }\n\n    gl_FragColor = vec4( position, 1.0 );\n\n}\n"
    });

    fboMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), copyShader);
    fboScene.add(fboMesh);

    velocityRenderTarget = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
        stencilBuffer: false
    });

    positionRenderTarget = velocityRenderTarget.clone();
    positionRenderTarget2 = velocityRenderTarget.clone();
    copyTexture(createVelocityTexture(), velocityRenderTarget);
    copyTexture(createPositionTexture(), positionRenderTarget);
    copyTexture(positionRenderTarget, positionRenderTarget2);
}

function updatePosition(dt) {

    fboMesh.material = config.use4d ? velocity4dShader : velocityShader;
    fboMesh.material.uniforms.time.value += dt;
    fboMesh.material.uniforms.texturePosition.value = positionRenderTarget;
    fboMesh.material.uniforms.speed.value = config.speed;
    renderer.render(fboScene, fboCamera, velocityRenderTarget);

    fboMesh.material = positionShader;
    positionShader.uniforms.texturePosition.value = positionRenderTarget;
    positionShader.uniforms.textureVelocity.value = velocityRenderTarget;
    positionShader.uniforms.delta.value = dt || 0;
    renderer.render(fboScene, fboCamera, positionRenderTarget2);

    // swap
    var tmp = positionRenderTarget;
    positionRenderTarget = positionRenderTarget2;
    positionRenderTarget2 = tmp;
}

function copyTexture(input, output) {
    fboMesh.material = copyShader;
    copyShader.uniforms.texture.value = input;
    renderer.render(fboScene, fboCamera, output);
}

function createVelocityTexture() {
    var a = new Float32Array(AMOUNT * 3);
    var texture = new THREE.DataTexture(a, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    texture.flipY = false;
    return texture;
}

function createPositionTexture() {
    var a = new Float32Array(AMOUNT * 3);
    for (var i = 0, len = a.length; i < len; i += 3) {
        a[i + 0] = -1000;
        a[i + 1] = (Math.random() - 0.5) - 1000;
        a[i + 2] = (Math.random() - 0.5) - 1000;
    }
    var texture = new THREE.DataTexture(a, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    texture.flipY = false;
    return texture;
}

function onResize() {
    width = window.innerWidth;
    height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function loop() {
    var newNow = Date.now();
    var dt = newNow - now;
    now = newNow;
    render(Math.min(dt, 16));
    requestAnimationFrame(loop);
}

function render(dt) {
    dt = dt || 0;

    updatePosition(dt);

    particles.material.uniforms.texturePosition.value = positionRenderTarget;

    renderer.render(scene, camera);
}

preInit();