import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import GUI from "lil-gui";
import Stats from "three/examples/jsm/libs/stats.module.js";

THREE.ColorManagement.enabled = false;

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const vertexShader = `
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = `
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  varying vec4 vUv;
  uniform sampler2D tDudv;
  uniform float time;
  uniform float waveStrength;
  uniform float waveSpeed;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float waveStrength = 0.12;
    float waveSpeed    = 0.035;
    vec2 distortedUv = texture2D(tDudv, vec2(vUv.x + time * waveSpeed, vUv.y)).rg * waveStrength;
    distortedUv = vUv.xy + vec2(distortedUv.x, distortedUv.y + time * waveSpeed);
    vec2 distortion = (texture2D(tDudv, distortedUv).rg * 2.0 - 1.0) * waveStrength;
    vec4 uv = vec4(vUv);
    uv.xy += distortion;
    vec4 base = texture2DProj(tDiffuse, uv);
    gl_FragColor = vec4(mix(base.rgb, color, 0.5), 1.0);
    #include <tonemapping_fragment>
  }
`;

const snowflakeVertexShader = `
  attribute float size;
  attribute float vOpacity;
  uniform float sizeScale;
  varying float fragOpacity;
  void main() {
    fragOpacity = vOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * (190.0 * sizeScale / -mvPosition.z), 2.0, 28.0);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

const snowflakeFragmentShader = `
  uniform vec3 snowColor;
  varying float fragOpacity;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;

    float angle = atan(p.y, p.x);

    float r = 0.41
      + 0.016 * sin(angle * 2.0 + 1.23)
      + 0.012 * cos(angle * 3.0 + 0.67)
      + 0.007 * sin(angle * 5.0 + 2.14)
      + 0.004 * cos(angle * 4.0 + 3.50);

    float alpha = 1.0 - smoothstep(r - 0.038, r + 0.022, d);

    float foam = 0.88 + 0.12 * sin(d * 20.0 + angle * 1.8);
    alpha *= mix(1.0, foam, smoothstep(0.0, 0.28, d));

    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha < 0.02) discard;

    vec3 col = mix(snowColor, vec3(0.80, 0.91, 1.0), smoothstep(0.22, r, d) * 0.28);

    gl_FragColor = vec4(col, alpha * fragOpacity);
  }
`;

const canvas = document.querySelector("canvas.webgl");
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0xFAE9F6);

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");
loader.setDRACOLoader(dracoLoader);

loader.load(
  "models/mountains7.glb",
  (gltf) => scene.add(gltf.scene),
  (xhr)  => console.log((xhr.loaded / xhr.total) * 100 + "% loaded"),
  ()     => console.log("An error happened")
);

scene.add(new THREE.AmbientLight(0xfeffff, 0.9));

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(1024, 1024);
directionalLight.position.set(10, 20, -7);
scene.add(directionalLight);

const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight2.castShadow = false;
directionalLight2.position.set(-10, 20, 7);
scene.add(directionalLight2);

const pointLight = new THREE.PointLight(0xffffff, 0.55);
pointLight.position.set(0, 40, 2);
scene.add(pointLight);

const sizes = { width: window.innerWidth, height: window.innerHeight };
const REFERENCE_HEIGHT = window.innerHeight;
window.addEventListener("resize", () => {
  sizes.width  = window.innerWidth;
  sizes.height = window.innerHeight;
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  snowMaterial.uniforms.sizeScale.value = sizes.height / REFERENCE_HEIGHT;
});

const camera = new THREE.PerspectiveCamera(63, sizes.width / sizes.height, 0.1, 100);
camera.position.set(10.2, 10.5, -10.6);
scene.add(camera);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.75, 0);
controls.enableDamping = true;
controls.enableZoom    = false;
controls.rotateSpeed   = 0.3;

const renderer = new THREE.WebGLRenderer({ canvas });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const GLOBE_RADIUS = 5;
const GLOBE_CENTER = new THREE.Vector3(0, 3.70, 0);

const glassSphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 32, 32),
  new THREE.MeshPhysicalMaterial({
    color: 0x0098a3, roughness: 0.0, metalness: 10.95,
    transmission:     0.29,
    ior:              1.5,
    thickness:        0.25,
    reflectivity: 0.99, transparent: true, opacity: 0.051,
    depthWrite: false, side: THREE.FrontSide,
  })
);
glassSphere.position.copy(GLOBE_CENTER);
scene.add(glassSphere);

const pedestalParams = {
  radius:       4.05,
  halfHeight:   0.8,
  bevel:        0.24,
  posY:        -0.15,
  capBotRadius: 4.0,
  capTopRadius: 1.0,
};

function buildCylinderProfile(R, halfH, bevel, segs = 12) {
  const profile = [];
  for (let i = 0; i <= segs; i++) {
    const a = (Math.PI / 2) * (i / segs);
    profile.push(new THREE.Vector2(
      (R - bevel) + bevel * Math.sin(a),
      (-halfH + bevel) - bevel * Math.cos(a)
    ));
  }
  for (let i = 0; i <= segs; i++) {
    const a = (Math.PI / 2) * (i / segs);
    profile.push(new THREE.Vector2(
      (R - bevel) + bevel * Math.cos(a),
      (halfH - bevel) + bevel * Math.sin(a)
    ));
  }
  return profile;
}

const cylinderMaterial = new THREE.MeshPhysicalMaterial({
  color:              0xFEE2BA,
  clearcoatRoughness: 0.04,
  flatShading:        true,
  transmission:       0.70,
});
const cylinder = new THREE.Mesh(
  new THREE.LatheGeometry(
    buildCylinderProfile(pedestalParams.radius, pedestalParams.halfHeight, pedestalParams.bevel),
    490
  ),
  cylinderMaterial
);
cylinder.position.y = pedestalParams.posY;
scene.add(cylinder);

const bottomGeometry = new THREE.CylinderGeometry( 3.8, 5, 4, 32 );
const bottomMaterial = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
const bottomCylinder = new THREE.Mesh( bottomGeometry, cylinderMaterial );
scene.add( bottomCylinder );
bottomCylinder.position.y = -2.8;

const capDisc = new THREE.Mesh(
  new THREE.CircleGeometry(pedestalParams.capBotRadius, 72),
  new THREE.MeshBasicMaterial({ color: 0xE8C5AA, side: THREE.DoubleSide })
);
capDisc.rotation.x = -Math.PI / 2;
capDisc.position.y = pedestalParams.posY - pedestalParams.halfHeight;

const capDiscTop = new THREE.Mesh(
  new THREE.CircleGeometry(pedestalParams.capTopRadius, 72),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
);
capDiscTop.rotation.x = -Math.PI / 2;
capDiscTop.position.y = pedestalParams.posY + pedestalParams.halfHeight;

function rebuildPedestal() {
  const p = pedestalParams;
  cylinder.geometry.dispose();
  cylinder.geometry = new THREE.LatheGeometry(buildCylinderProfile(p.radius, p.halfHeight, p.bevel), 72);
  cylinder.position.y = p.posY;
  capDisc.geometry.dispose();
  capDisc.geometry = new THREE.CircleGeometry(p.capBotRadius, 72);
  capDisc.position.y = p.posY - p.halfHeight;
  capDiscTop.geometry.dispose();
  capDiscTop.geometry = new THREE.CircleGeometry(p.capTopRadius, 72);
  capDiscTop.position.y = p.posY + p.halfHeight;
}

const torusParams = {
  radius:          5.0,
  tube:            0.15,
  radialSegments:  40,
  tubularSegments: 69,
  posY:           -4.7,
};

const torusMaterial = new THREE.MeshPhysicalMaterial({
  color:              0xe8c09a,
  roughness:          0.2,
  clearcoat:          1.0,
  clearcoatRoughness: 0.1,
});

const torus = new THREE.Mesh(
  new THREE.TorusGeometry(
    torusParams.radius,
    torusParams.tube,
    torusParams.radialSegments,
    torusParams.tubularSegments
  ),
  torusMaterial
);
torus.rotation.x = Math.PI / 2;
torus.position.y = torusParams.posY;
scene.add(torus);

function rebuildTorus() {
  const p = torusParams;
  torus.geometry.dispose();
  torus.geometry = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
  torus.position.y = p.posY;
}

const torus2Params = {
  radius:          3.85,
  tube:            0.1,
  radialSegments:  40,
  tubularSegments: 67,
  posY:            0.5,
};

const torus2Material = new THREE.MeshPhysicalMaterial({
  color:              0x606c90,
  roughness:          0.2,
  clearcoat:          1.0,
  clearcoatRoughness: 0.1,
});

const torus2 = new THREE.Mesh(
  new THREE.TorusGeometry(
    torus2Params.radius,
    torus2Params.tube,
    torus2Params.radialSegments,
    torus2Params.tubularSegments
  ),
  torus2Material
);
torus2.rotation.x = Math.PI / 2;
torus2.position.y = torus2Params.posY;
scene.add(torus2);

function rebuildTorus2() {
  const p = torus2Params;
  torus2.geometry.dispose();
  torus2.geometry = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
  torus2.position.y = p.posY;
}

const torus3Params = {
  radiusTop:      4.65,
  radiusBottom:   3.95,
  height:         2.25,
  radialSegments: 42,
  posX:           0.0,
  posY:          -2.7,
  posZ:           0.0,
};

const torus3 = new THREE.Mesh(
  new THREE.CylinderGeometry(
    torus3Params.radiusTop,
    torus3Params.radiusBottom,
    torus3Params.height,
    torus3Params.radialSegments
  ),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
);
torus3.position.set(torus3Params.posX, torus3Params.posY, torus3Params.posZ);
torus3.visible = false;
scene.add(torus3);

function rebuildTorus3() {
  const p = torus3Params;
  torus3.geometry.dispose();
  torus3.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
  torus3.position.set(p.posX, p.posY, p.posZ);
  rebuildDots();
}

const dotParams = {
  count:     37,
  size:      0.17,
  color:     "#f3dbff",
  roughness: 0.0,
  metalness: 0.32,
};

const MAX_DOTS    = 2000;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

const dotMat = new THREE.MeshPhysicalMaterial({
  color:     dotParams.color,
  roughness: dotParams.roughness,
  metalness: dotParams.metalness,
});

const torusDots = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 8, 8),
  dotMat,
  MAX_DOTS
);
const dummy = new THREE.Object3D();

function rebuildDots() {
  const { radiusTop, radiusBottom, height } = torus3Params;
  const count = dotParams.count;

  torusDots.count      = count;
  torusDots.rotation.x = 0;
  torusDots.position.set(torus3Params.posX, torus3Params.posY, torus3Params.posZ);

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const θ = (i * goldenAngle) % (Math.PI * 2);

    const r = radiusTop + (radiusBottom - radiusTop) * t;
    const x = r * Math.cos(θ);
    const y = (t - 0.5) * height;
    const z = r * Math.sin(θ);

    dummy.position.set(x, y, z);
    dummy.scale.setScalar(dotParams.size);
    dummy.updateMatrix();
    torusDots.setMatrixAt(i, dummy.matrix);
  }

  torusDots.instanceMatrix.needsUpdate = true;
}

rebuildDots();
scene.add(torusDots);

const snowParams = {
  amount:       1000,
  sizeMin:      0.2,
  sizeMax:      1.5,
  color:        "#ffffff",
  opacityMin:   0.98,
  opacityMax:   2.5,
  gravity:      0.000004,
  damping:      0.9999,
  bounceEnergy: 0.2,
  speedMult:    0.9,
  oscillation:  0.000022,
  jitter:       0.001,
  turbStrength: 0.5,
  turbDecay:    0.6,
};

const MAX_SNOW    = 1000;
const SNOW_RADIUS = 4.5;
const SNOW_CENTER = GLOBE_CENTER.clone();
const FLOOR_Y     = 0.42;

const snowBaseSizes   = new Float32Array(MAX_SNOW);
const snowBaseOpacity = new Float32Array(MAX_SNOW);
const snowPhases      = new Float32Array(MAX_SNOW);
const snowTurbScales  = new Float32Array(MAX_SNOW);
const snowVelocities  = [];

const snowPositions = new Float32Array(MAX_SNOW * 3);
const snowSizes     = new Float32Array(MAX_SNOW);
const snowOpacities = new Float32Array(MAX_SNOW);

for (let i = 0; i < MAX_SNOW; i++) {
  let x, y, z;
  do {
    x = (Math.random() * 2 - 1) * SNOW_RADIUS;
    y = (Math.random() * 2 - 1) * SNOW_RADIUS;
    z = (Math.random() * 2 - 1) * SNOW_RADIUS;
  } while (x * x + y * y + z * z > SNOW_RADIUS * SNOW_RADIUS);

  snowPositions[i * 3]     = SNOW_CENTER.x + x;
  snowPositions[i * 3 + 1] = SNOW_CENTER.y + y;
  snowPositions[i * 3 + 2] = SNOW_CENTER.z + z;

  snowVelocities.push(new THREE.Vector3(
    (Math.random() - 0.5) * 0.001,
    -(Math.random() * 0.0015 + 0.0005),
    (Math.random() - 0.5) * 0.001
  ));

  snowBaseSizes[i]   = Math.random();
  snowBaseOpacity[i] = Math.random();
  snowPhases[i]      = Math.random() * Math.PI * 2;
  snowTurbScales[i]  = 0.0008 + Math.random() * 0.004;

  const active     = i < snowParams.amount;
  snowSizes[i]     = active
    ? snowParams.sizeMin + snowBaseSizes[i] * (snowParams.sizeMax - snowParams.sizeMin)
    : 0;
  snowOpacities[i] = snowParams.opacityMin
    + snowBaseOpacity[i] * (snowParams.opacityMax - snowParams.opacityMin);
}

const snowGeometry = new THREE.BufferGeometry();
snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
snowGeometry.setAttribute("size",     new THREE.BufferAttribute(snowSizes,     1));
snowGeometry.setAttribute("vOpacity", new THREE.BufferAttribute(snowOpacities, 1));

const snowMaterial = new THREE.ShaderMaterial({
  vertexShader:   snowflakeVertexShader,
  fragmentShader: snowflakeFragmentShader,
  uniforms: {
    snowColor: { value: new THREE.Color(snowParams.color) },
    sizeScale: { value: 1.0 },
  },
  transparent: true,
  depthWrite:  false,
  blending:    THREE.NormalBlending,
});

scene.add(new THREE.Points(snowGeometry, snowMaterial));

function refreshSizes() {
  const attr = snowGeometry.attributes.size;
  for (let i = 0; i < MAX_SNOW; i++) {
    attr.array[i] = i < snowParams.amount
      ? snowParams.sizeMin + snowBaseSizes[i] * (snowParams.sizeMax - snowParams.sizeMin)
      : 0;
  }
  attr.needsUpdate = true;
}

function refreshOpacities() {
  const attr = snowGeometry.attributes.vOpacity;
  for (let i = 0; i < MAX_SNOW; i++) {
    attr.array[i] = snowParams.opacityMin
      + snowBaseOpacity[i] * (snowParams.opacityMax - snowParams.opacityMin);
  }
  attr.needsUpdate = true;
}

const sceneColors = {
  sphere:     "#aa9900",
  mirror:     "#90d4fe",
  background: "#f1eafb",
  capTop:     "#ffffff",
};
const gui = new GUI({ title: "🎨   Colours", width: 260 });
gui.addColor(sceneColors, "sphere").name("Globe colour")
  .onChange(v => glassSphere.material.color.set(v));
gui.addColor(sceneColors, "mirror").name("Mirror colour")
  .onChange(v => groundMirror.material.uniforms.color.value.set(v));
gui.addColor(sceneColors, "capTop").name("Top cap")
  .onChange(v => capDiscTop.material.color.set(v));
gui.addColor(sceneColors, "background").name("Background")
  .onChange(v => scene.background.set(v));

const capBotOffset = pedestalParams.radius - pedestalParams.capBotRadius;
const capTopOffset = pedestalParams.radius - pedestalParams.capTopRadius;

const fPedestal = gui.addFolder("🏛️   Pedestal");
fPedestal.add(pedestalParams, "radius", 1.0, 10.0, 0.05).name("Radius")
  .onChange(v => {
    pedestalParams.capBotRadius = v - capBotOffset;
    pedestalParams.capTopRadius = v - capTopOffset;
    capBotCtrl.updateDisplay();
    capTopCtrl.updateDisplay();
    rebuildPedestal();
  });
fPedestal.add(pedestalParams, "halfHeight",   0.2,  5.0, 0.05).name("Half-height")   .onChange(rebuildPedestal);
fPedestal.add(pedestalParams, "bevel",        0.0,  0.5, 0.01).name("Bevel")         .onChange(rebuildPedestal);
fPedestal.add(pedestalParams, "posY",        -8.0,  2.0, 0.05).name("Y position")    .onChange(rebuildPedestal);
const capBotCtrl = fPedestal.add(pedestalParams, "capBotRadius", 1.0, 10.0, 0.05).name("Bottom cap R").onChange(rebuildPedestal);
const capTopCtrl = fPedestal.add(pedestalParams, "capTopRadius", 1.0, 10.0, 0.05).name("Top cap R")   .onChange(rebuildPedestal);
fPedestal.close();

const fTorus = gui.addFolder("⭕   Torus");
fTorus.add(torusParams, "radius",          0.5, 20.0, 0.05).name("Radius")           .onChange(rebuildTorus);
fTorus.add(torusParams, "tube",            0.05, 3.0, 0.05).name("Tube thickness")   .onChange(rebuildTorus);
fTorus.add(torusParams, "radialSegments",  3,    64,  1   ).name("Radial segments")  .onChange(rebuildTorus);
fTorus.add(torusParams, "tubularSegments", 8,   200,  1   ).name("Tubular segments") .onChange(rebuildTorus);
fTorus.add(torusParams, "posY",           -8.0,  8.0, 0.05).name("Y position")       .onChange(rebuildTorus);
fTorus.addColor({ color: "#e8c09a" }, "color").name("Colour")
  .onChange(v => torusMaterial.color.set(v));
fTorus.close();

const fTorus2 = gui.addFolder("⭕   Torus 2");
fTorus2.add(torus2Params, "radius",          0.5, 20.0, 0.05).name("Radius")           .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "tube",            0.05, 3.0, 0.05).name("Tube thickness")   .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "radialSegments",  3,    64,  1   ).name("Radial segments")  .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "tubularSegments", 8,   200,  1   ).name("Tubular segments") .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "posY",           -8.0,  8.0, 0.05).name("Y position")       .onChange(rebuildTorus2);
fTorus2.addColor({ color: "#606c90" }, "color").name("Colour")
  .onChange(v => torus2Material.color.set(v));
fTorus2.close();

const fTorus3 = gui.addFolder("🔵   Cylinder (dot guide)");
const t3VisibleProxy = { visible: false };
fTorus3.add(t3VisibleProxy, "visible").name("Show guide wireframe")
  .onChange(v => { torus3.visible = v; });
fTorus3.add(torus3Params, "radiusTop",      0.1, 20.0, 0.05).name("Radius top")        .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "radiusBottom",   0.1, 20.0, 0.05).name("Radius bottom")     .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "height",         0.1, 20.0, 0.05).name("Height")            .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "radialSegments", 3,   64,   1   ).name("Radial segments")   .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "posX",          -20.0, 20.0, 0.05).name("X position")       .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "posY",          -8.0,  8.0,  0.05).name("Y position")       .onChange(rebuildTorus3);
fTorus3.add(torus3Params, "posZ",          -20.0, 20.0, 0.05).name("Z position")       .onChange(rebuildTorus3);
fTorus3.close();

const fDots = gui.addFolder("✦   Torus Dots");
fDots.add(dotParams, "count",     1, MAX_DOTS, 1    ).name("Count")    .onChange(rebuildDots);
fDots.add(dotParams, "size",      0.01, 0.5,   0.005).name("Dot size") .onChange(rebuildDots);
fDots.addColor(dotParams, "color").name("Colour")
  .onChange(v => dotMat.color.set(v));
fDots.add(dotParams, "roughness", 0.0, 1.0, 0.01).name("Roughness")
  .onChange(v => { dotMat.roughness = v; });
fDots.add(dotParams, "metalness", 0.0, 1.0, 0.01).name("Metalness")
  .onChange(v => { dotMat.metalness = v; });
fDots.close();

const fFlakes = gui.addFolder("❄️    Flakes");
fFlakes.add(snowParams, "amount",     10, MAX_SNOW, 1   ).name("Amount").onChange(refreshSizes);
fFlakes.add(snowParams, "sizeMin",   0.2, 10.0,     0.1 ).name("Size  min").onChange(refreshSizes);
fFlakes.add(snowParams, "sizeMax",   0.5, 20.0,     0.1 ).name("Size  max").onChange(refreshSizes);
fFlakes.addColor(snowParams, "color").name("Color")
  .onChange(v => snowMaterial.uniforms.snowColor.value.set(v));
fFlakes.add(snowParams, "opacityMin", 0.0, 3.0, 0.01).name("Opacity  min").onChange(refreshOpacities);
fFlakes.add(snowParams, "opacityMax", 0.0, 3.0, 0.01).name("Opacity  max").onChange(refreshOpacities);

const fPhysics = gui.addFolder("🌊    Physics");
fPhysics.add(snowParams, "gravity",      0,    0.0002, 0.000001).name("Gravity");
fPhysics.add(snowParams, "damping",      0.90, 0.9999, 0.0001  ).name("Damping");
fPhysics.add(snowParams, "bounceEnergy", 0.0,  1.0,    0.01    ).name("Bounce energy");

const fDrift = gui.addFolder("✨    Drift");
fDrift.add(snowParams, "speedMult",   0.0, 5.0,    0.01    ).name("Speed ×");
fDrift.add(snowParams, "oscillation", 0,   0.0005, 0.000001).name("Oscillation");
fDrift.add(snowParams, "jitter",      0,   0.001,  0.000001).name("Jitter");

const fSpin = gui.addFolder("🌀    Spin");
fSpin.add(snowParams, "turbStrength", 0,   50,    0.5  ).name("Strength");
fSpin.add(snowParams, "turbDecay",    0.5, 0.999, 0.001).name("Decay");

gui.add({
  log: () => {
    const p = snowParams;
    const out =
`// ── Paste these into snowParams ─────────────────────────
  amount:       ${p.amount},
  sizeMin:      ${p.sizeMin},
  sizeMax:      ${p.sizeMax},
  color:        "${p.color}",
  opacityMin:   ${p.opacityMin},
  opacityMax:   ${p.opacityMax},
  gravity:      ${p.gravity},
  damping:      ${p.damping},
  bounceEnergy: ${p.bounceEnergy},
  speedMult:    ${p.speedMult},
  oscillation:  ${p.oscillation},
  jitter:       ${p.jitter},
  turbStrength: ${p.turbStrength},
  turbDecay:    ${p.turbDecay},`;
    console.log(out);
    if (navigator.clipboard) navigator.clipboard.writeText(out);
  }
}, "log").name("📋   Copy settings to clipboard");

let prevAzimuth      = controls.getAzimuthalAngle();
let prevPolar        = controls.getPolarAngle();
const snowTurbulence = new THREE.Vector3();

const mirrorShader = Reflector.ReflectorShader;
mirrorShader.vertexShader   = vertexShader;
mirrorShader.fragmentShader = fragmentShader;

const dudvMap = new THREE.TextureLoader().load(
  "https://pink-sunset.vercel.app/src/waterdudv.jpg"
);
dudvMap.wrapS = dudvMap.wrapT = THREE.RepeatWrapping;
mirrorShader.uniforms.tDudv = { value: dudvMap };
mirrorShader.uniforms.time  = { value: 0 };

const groundMirror = new Reflector(
  new THREE.CircleGeometry(3.843, 64),
  { shader: mirrorShader, clipBias: 0.000001,
    textureWidth: window.innerWidth / 2, textureHeight: window.innerHeight / 2,
    color: 0x90d4fe }
);
groundMirror.position.y = 0.49;
groundMirror.rotation.x = -Math.PI * 0.5;
scene.add(groundMirror);

const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  mirrorShader.uniforms.time.value          += 0.503;
  groundMirror.material.uniforms.time.value += 0.0503;
  controls.update();

  const curAzimuth = controls.getAzimuthalAngle();
  const curPolar   = controls.getPolarAngle();
  const dAz  = curAzimuth - prevAzimuth;
  const dPol = curPolar   - prevPolar;
  prevAzimuth = curAzimuth;
  prevPolar   = curPolar;

  const ts = snowParams.turbStrength;
  snowTurbulence.x += (-Math.sin(curAzimuth) * dAz + Math.cos(curAzimuth) * dPol) * ts;
  snowTurbulence.y += dPol * ts * 0.5;
  snowTurbulence.z += ( Math.cos(curAzimuth) * dAz + Math.sin(curAzimuth) * dPol) * ts;
  
  const hMag = Math.sqrt(snowTurbulence.x * snowTurbulence.x + snowTurbulence.z * snowTurbulence.z);
  snowTurbulence.y += hMag * 0.18;
  snowTurbulence.multiplyScalar(snowParams.turbDecay);

  const posAttr = snowGeometry.attributes.position;
  const count   = snowParams.amount;

  for (let i = 0; i < count; i++) {
    let px = posAttr.getX(i);
    let py = posAttr.getY(i);
    let pz = posAttr.getZ(i);

    const vel = snowVelocities[i];
    const sc  = snowTurbScales[i];
    const sp  = snowParams.speedMult;

    vel.x += snowTurbulence.x * sc;
    vel.y += snowTurbulence.y * sc;
    vel.z += snowTurbulence.z * sc;

    const t = elapsedTime * 0.35 + snowPhases[i];
    vel.x += Math.sin(t * 0.9 + snowPhases[i] * 1.3) * snowParams.oscillation * sp;
    vel.z += Math.cos(t * 1.1 + snowPhases[i] * 0.7) * snowParams.oscillation * sp;

    vel.x += (Math.random() - 0.5) * snowParams.jitter * sp;
    vel.z += (Math.random() - 0.5) * snowParams.jitter * sp;

    vel.y -= snowParams.gravity;

    vel.multiplyScalar(snowParams.damping);

    let nx = px + vel.x;
    let ny = py + vel.y;
    let nz = pz + vel.z;

    const dx = nx - SNOW_CENTER.x;
    const dy = ny - SNOW_CENTER.y;
    const dz = nz - SNOW_CENTER.z;
    const dist2 = dx * dx + dy * dy + dz * dz;

    if (dist2 > SNOW_RADIUS * SNOW_RADIUS) {
      const dist  = Math.sqrt(dist2);
      const nx_n  = dx / dist, ny_n = dy / dist, nz_n = dz / dist;
      const dot   = vel.x * nx_n + vel.y * ny_n + vel.z * nz_n;
      vel.x -= 2.0 * dot * nx_n;
      vel.y -= 2.0 * dot * ny_n;
      vel.z -= 2.0 * dot * nz_n;
      vel.multiplyScalar(snowParams.bounceEnergy);
      nx = SNOW_CENTER.x + nx_n * (SNOW_RADIUS - 0.001);
      ny = SNOW_CENTER.y + ny_n * (SNOW_RADIUS - 0.001);
      nz = SNOW_CENTER.z + nz_n * (SNOW_RADIUS - 0.001);
    }

    if (ny < FLOOR_Y) {
      ny = FLOOR_Y;
      if (vel.y < 0) vel.y = 0;
      vel.x *= 0.78;
      vel.z *= 0.78;
    }

    posAttr.setXYZ(i, nx, ny, nz);
  }

  posAttr.needsUpdate = true;

  stats.begin();
  renderer.render(scene, camera);
  stats.end();
  window.requestAnimationFrame(tick);
};

tick();
