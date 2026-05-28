import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

THREE.ColorManagement.enabled = false;

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

const camPresets = {
  A: { fov: 28, posX: 50.0, posY: 10.5, posZ: -10.6, targetX: 0, targetY: 0.75, targetZ: 0, rotateSpeed: 0.3, enableZoom: false },
  B: { fov: 24, posX: 50.0, posY: 25.4, posZ: -31.5, targetX: 0, targetY: 0.75, targetZ: 0, rotateSpeed: 0.3, enableZoom: false },
};

const cameraParams = { ...camPresets.B };

const camera = new THREE.PerspectiveCamera(cameraParams.fov, sizes.width / sizes.height, 0.1, 100);
camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ);
scene.add(camera);

const controls = new OrbitControls(camera, canvas);
controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ);
controls.enableDamping = true;
controls.enableZoom    = cameraParams.enableZoom;
controls.rotateSpeed   = cameraParams.rotateSpeed;

const renderer = new THREE.WebGLRenderer({ canvas });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const GLOBE_RADIUS = 5;
const GLOBE_CENTER = new THREE.Vector3(0, 3.70, 0);

const globeParams = {
  posY: GLOBE_CENTER.y,
  color: '#0098a3',
  emissive: '#000000',
  emissiveIntensity: 0.0,
  metalness: 10.95,
  roughness: 0.0,
  transparent: true,
  opacity: 0.051,
  depthWrite: false,
  transmission: 0.29,
  ior: 1.5,
  thickness: 0.25,
  attenuationDistance: Infinity,
  attenuationColor: '#ffffff',
  clearcoat: 0.0,
  clearcoatRoughness: 0.0,
  reflectivity: 0.99,
  specularIntensity: 1.0,
  specularColor: '#ffffff',
  sheen: 0.0,
  sheenRoughness: 1.0,
  sheenColor: '#000000',
  iridescence: 0.0,
  iridescenceIOR: 1.3,
  iridescenceThicknessMin: 100,
  iridescenceThicknessMax: 400,
  side: 'Front',
  wireframe: false,
  flatShading: false,
};

const glassSphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 32, 32),
  new THREE.MeshPhysicalMaterial({
    color: globeParams.color,
    emissive: globeParams.emissive,
    emissiveIntensity: globeParams.emissiveIntensity,
    metalness: globeParams.metalness,
    roughness: globeParams.roughness,
    transparent: globeParams.transparent,
    opacity: globeParams.opacity,
    depthWrite: globeParams.depthWrite,
    transmission: globeParams.transmission,
    ior: globeParams.ior,
    thickness: globeParams.thickness,
    attenuationDistance: globeParams.attenuationDistance,
    attenuationColor: new THREE.Color(globeParams.attenuationColor),
    clearcoat: globeParams.clearcoat,
    clearcoatRoughness: globeParams.clearcoatRoughness,
    reflectivity: globeParams.reflectivity,
    specularIntensity: globeParams.specularIntensity,
    specularColor: new THREE.Color(globeParams.specularColor),
    sheen: globeParams.sheen,
    sheenRoughness: globeParams.sheenRoughness,
    sheenColor: new THREE.Color(globeParams.sheenColor),
    iridescence: globeParams.iridescence,
    iridescenceIOR: globeParams.iridescenceIOR,
    iridescenceThicknessRange: [globeParams.iridescenceThicknessMin, globeParams.iridescenceThicknessMax],
    side: THREE.FrontSide,
    wireframe: globeParams.wireframe,
    flatShading: globeParams.flatShading,
  })
);
glassSphere.position.copy(GLOBE_CENTER);
scene.add(glassSphere);

const pedestalParams = {
  radius: 4.05,
  halfHeight: 0.8,
  bevel: 0.24,
  posY: -0.15,
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
  color: 0xcde0fe,
  metalness: 0.0,
  roughness: 0.5,
  clearcoat: 0.0,
  clearcoatRoughness: 0.04,
  transmission: 0.70,
  ior: 1.5,
  thickness: 0.5,
  flatShading: true,
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

const bottomCylParams = {
  radiusTop: 3.8,
  radiusBottom: 5.0,
  height: 2.9,
  radialSegments: 64,
  posY: -1.85,
  color: "#cde8fe",
  metalness: 0.02,
  roughness: 0.0,
  clearcoat: 0.0,
  clearcoatRoughness: 0.0,
  transmission: 0.38,
  ior: 2.5,
  thickness: 1.1,
  flatShading: true,
};

const bottomCylMaterial = new THREE.MeshPhysicalMaterial({
  color: bottomCylParams.color,
  metalness: bottomCylParams.metalness,
  roughness: bottomCylParams.roughness,
  clearcoat: bottomCylParams.clearcoat,
  clearcoatRoughness: bottomCylParams.clearcoatRoughness,
  transmission: bottomCylParams.transmission,
  ior: bottomCylParams.ior,
  thickness: bottomCylParams.thickness,
  flatShading: bottomCylParams.flatShading,
});

const bottomCylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(
    bottomCylParams.radiusTop,
    bottomCylParams.radiusBottom,
    bottomCylParams.height,
    bottomCylParams.radialSegments
  ),
  bottomCylMaterial
);
bottomCylinder.position.y = bottomCylParams.posY;
scene.add(bottomCylinder);

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

const torusParams = {
  radius: 4.7,
  tube: 0.25,
  radialSegments: 40,
  tubularSegments: 69,
  posY: -3.4,
};

const torusMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xe8c09a,
  roughness: 0.2,
  clearcoat: 1.0,
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

const textParams = {
  posX: 0.0,
  posY: -0.4,
  posZ: 0.0,
  rotX: 0.0,
  rotY: 2.2,
  rotZ: 0.0,
  size: 0.6,
  depth: 0.15,
  letterSpacing: 0.0,
  kernJo: -0.08,
  metalness: 0.31,
  roughness: 0.0,
  clearcoat: 0.24,
  clearcoatRoughness: 0.65,
  color: "#b28053",
};

const textMaterial = new THREE.MeshPhysicalMaterial({
  color: textParams.color,
  roughness: textParams.roughness,
  metalness: textParams.metalness,
  clearcoat: textParams.clearcoat,
  clearcoatRoughness: textParams.clearcoatRoughness,
});

const textGroup = new THREE.Group();
scene.add(textGroup);

let loadedFont = null;

function rebuildText() {
  if (!loadedFont) return;

  while (textGroup.children.length > 0) {
    const m = textGroup.children[0];
    m.geometry.dispose();
    textGroup.remove(m);
  }

  const arcR = pedestalParams.radius;
  const text  = "Jokulsarlon";

  const charData = [];
  let totalWidth = 0;
  for (const char of text) {
    const geo = new TextGeometry(char, {
      font: loadedFont,
      size: textParams.size,
      height: textParams.depth,
      curveSegments: 16,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.008,
      bevelSegments: 4,
    });
    geo.computeBoundingBox();
    const w = geo.boundingBox.max.x - geo.boundingBox.min.x;
    charData.push({ geo, w });
    totalWidth += w;
  }
  totalWidth += textParams.letterSpacing * (charData.length - 1);
  totalWidth += textParams.kernJo;

  let xCursor = -totalWidth / 2;
  charData.forEach(({ geo, w }, idx) => {
    if (idx === 1) xCursor += textParams.kernJo;

    geo.translate(xCursor, 0, 0);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const angle = x / arcR;
      const r     = arcR + z;
      pos.setXYZ(i, Math.sin(angle) * r, y, Math.cos(angle) * r);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    textGroup.add(new THREE.Mesh(geo, textMaterial));
    xCursor += w + textParams.letterSpacing;
  });

  updateTextPosition();
}

function updateTextPosition() {
  textGroup.position.set(textParams.posX, textParams.posY, textParams.posZ);
  textGroup.rotation.set(textParams.rotX, textParams.rotY, textParams.rotZ);
}

const fontLoader = new FontLoader();
fontLoader.load("/fonts/Dancing Script_Bold.json", (font) => {
  loadedFont = font;
  rebuildText();
});

const torus2Params = {
  radius: 3.85,
  tube: 0.1,
  radialSegments: 40,
  tubularSegments: 67,
  posY: 0.5,
};

const torus2Material = new THREE.MeshPhysicalMaterial({
  color: 0x606c90,
  roughness: 0.2,
  clearcoat: 1.0,
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

const torus3Params = {
  radiusTop: 4.8,
  radiusBottom: 4.25,
  height: 1.45,
  radialSegments: 42,
  posX: 0.0,
  posY: -2.1,
  posZ: 0.0,
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
  count: 20,
  size: 0.17,
  color: "#edddf6",
  roughness: 1.0,
  metalness: 0.0,
};

const MAX_DOTS = 2000;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

const dotMat = new THREE.MeshPhysicalMaterial({
  color: dotParams.color,
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

  torusDots.count = count;
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
  amount: 3000,
  sizeMin: 0.2,
  sizeMax: 2.1,
  color: "#ffffff",
  opacityMin: 0.98,
  opacityMax: 2.5,
  gravity: 0.000004,
  damping: 0.9999,
  bounceEnergy: 0.2,
  speedMult: 0.9,
  oscillation: 0.000022,
  jitter: 0.001,
  turbStrength: 0.5,
  turbDecay: 0.6,
};

const MAX_SNOW = 12000;
const SNOW_RADIUS = 4.5;
const SNOW_CENTER = GLOBE_CENTER.clone();
const FLOOR_Y = 0.49;

const snowBaseSizes = new Float32Array(MAX_SNOW);
const snowBaseOpacity = new Float32Array(MAX_SNOW);
const snowPhases = new Float32Array(MAX_SNOW);
const snowTurbScales = new Float32Array(MAX_SNOW);
const snowVelocities = [];

const snowPositions = new Float32Array(MAX_SNOW * 3);
const snowSizes = new Float32Array(MAX_SNOW);
const snowOpacities = new Float32Array(MAX_SNOW);

for (let i = 0; i < MAX_SNOW; i++) {
  let x, y, z;
  do {
    x = (Math.random() * 2 - 1) * SNOW_RADIUS;
    y = (Math.random() * 2 - 1) * SNOW_RADIUS;
    z = (Math.random() * 2 - 1) * SNOW_RADIUS;
  } while (x * x + y * y + z * z > SNOW_RADIUS * SNOW_RADIUS);

  snowPositions[i * 3] = SNOW_CENTER.x + x;
  snowPositions[i * 3 + 1] = SNOW_CENTER.y + y;
  snowPositions[i * 3 + 2] = SNOW_CENTER.z + z;

  snowVelocities.push(new THREE.Vector3(
    (Math.random() - 0.5) * 0.001,
    -(Math.random() * 0.0015 + 0.0005),
    (Math.random() - 0.5) * 0.001
  ));

  snowBaseSizes[i] = Math.random();
  snowBaseOpacity[i] = Math.random();
  snowPhases[i] = Math.random() * Math.PI * 2;
  snowTurbScales[i] = 0.0008 + Math.random() * 0.004;

  const active = i < snowParams.amount;
  snowSizes[i] = active
    ? snowParams.sizeMin + snowBaseSizes[i] * (snowParams.sizeMax - snowParams.sizeMin)
    : 0;
  snowOpacities[i] = active
    ? snowParams.opacityMin + snowBaseOpacity[i] * (snowParams.opacityMax - snowParams.opacityMin)
    : 0;
}

const snowGeometry = new THREE.BufferGeometry();
snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
snowGeometry.setAttribute("size", new THREE.BufferAttribute(snowSizes, 1));
snowGeometry.setAttribute("vOpacity", new THREE.BufferAttribute(snowOpacities, 1));

const snowMaterial = new THREE.ShaderMaterial({
  vertexShader: snowflakeVertexShader,
  fragmentShader: snowflakeFragmentShader,
  uniforms: {
    snowColor: { value: new THREE.Color(snowParams.color) },
    sizeScale: { value: 1.0 },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
});

scene.add(new THREE.Points(snowGeometry, snowMaterial));

{
  const pos = new Float32Array(2000 * 3);
  for (let i = 0; i < 2000; i++) {
    let x, y, z;
    do { x = (Math.random() * 2 - 1) * SNOW_RADIUS; y = (Math.random() * 2 - 1) * SNOW_RADIUS; z = (Math.random() * 2 - 1) * SNOW_RADIUS; }
    while (x * x + y * y + z * z > SNOW_RADIUS * SNOW_RADIUS);
    pos[i * 3] = SNOW_CENTER.x + x; pos[i * 3 + 1] = SNOW_CENTER.y + y; pos[i * 3 + 2] = SNOW_CENTER.z + z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.5, depthWrite: false })));
}

let prevAzimuth = controls.getAzimuthalAngle();
let prevPolar = controls.getPolarAngle();
const snowTurbulence = new THREE.Vector3();

const mirrorShader = Reflector.ReflectorShader;
mirrorShader.vertexShader = vertexShader;
mirrorShader.fragmentShader = fragmentShader;

function makeDudvMap(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const PI2 = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = x / size, ny = y / size;
      const du = (
        Math.sin(nx * PI2 * 4.0 + ny * PI2 * 1.5) * 0.50 +
        Math.sin(nx * PI2 * 7.0 - ny * PI2 * 3.0) * 0.30 +
        Math.sin(nx * PI2 * 2.0 + ny * PI2 * 6.0) * 0.20
      ) * 0.5 + 0.5;
      const dv = (
        Math.cos(nx * PI2 * 3.0 + ny * PI2 * 4.5) * 0.50 +
        Math.cos(nx * PI2 * 5.0 - ny * PI2 * 2.0) * 0.30 +
        Math.cos(nx * PI2 * 1.0 + ny * PI2 * 7.0) * 0.20
      ) * 0.5 + 0.5;
      d[i] = Math.round(du * 255);
      d[i + 1] = Math.round(dv * 255);
      d[i + 2] = 0;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const dudvMap = makeDudvMap();
mirrorShader.uniforms.tDudv = { value: dudvMap };
mirrorShader.uniforms.time = { value: 0 };

const groundMirror = new Reflector(
  new THREE.CircleGeometry(3.843, 64),
  {
    shader: mirrorShader, clipBias: 0.000001,
    textureWidth: window.innerWidth / 2, textureHeight: window.innerHeight / 2,
    color: 0x90d4fe
  }
);
groundMirror.position.y = 0.49;
groundMirror.rotation.x = -Math.PI * 0.5;
scene.add(groundMirror);

const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  mirrorShader.uniforms.time.value += 0.503;
  groundMirror.material.uniforms.time.value += 0.0503;
  controls.update();

  const curAzimuth = controls.getAzimuthalAngle();
  const curPolar = controls.getPolarAngle();
  const dAz = curAzimuth - prevAzimuth;
  const dPol = curPolar - prevPolar;
  prevAzimuth = curAzimuth;
  prevPolar = curPolar;

  const ts = snowParams.turbStrength;
  snowTurbulence.x += (-Math.sin(curAzimuth) * dAz + Math.cos(curAzimuth) * dPol) * ts;
  snowTurbulence.y += dPol * ts * 0.5;
  snowTurbulence.z += (Math.cos(curAzimuth) * dAz + Math.sin(curAzimuth) * dPol) * ts;

  const hMag = Math.sqrt(snowTurbulence.x * snowTurbulence.x + snowTurbulence.z * snowTurbulence.z);
  snowTurbulence.y += hMag * 0.18;
  snowTurbulence.multiplyScalar(snowParams.turbDecay);

  const posAttr = snowGeometry.attributes.position;
  const count = snowParams.amount;

  for (let i = 0; i < count; i++) {
    let px = posAttr.getX(i);
    let py = posAttr.getY(i);
    let pz = posAttr.getZ(i);

    const vel = snowVelocities[i];
    const sc = snowTurbScales[i];
    const sp = snowParams.speedMult;

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
      const dist = Math.sqrt(dist2);
      const nx_n = dx / dist, ny_n = dy / dist, nz_n = dz / dist;
      const dot = vel.x * nx_n + vel.y * ny_n + vel.z * nz_n;
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

  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
};

tick();
