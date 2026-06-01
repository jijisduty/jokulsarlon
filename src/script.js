import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { FontLoader }   from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import GUI from "lil-gui";
import Stats from "three/examples/jsm/libs/stats.module.js";

THREE.ColorManagement.enabled = false;

// ─────────────────────────────────────────────────────────────────────────────
//  Stats / FPS counter  
// ─────────────────────────────────────────────────────────────────────────────
/* const stats = new Stats();
stats.showPanel(0); 
document.body.appendChild(stats.dom);
 */
// ─────────────────────────────────────────────────────────────────────────────
//  Water-mirror shaders
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
//  Snowflake shaders
// ─────────────────────────────────────────────────────────────────────────────
const snowflakeVertexShader = `
  attribute float size;
  attribute float vOpacity;
  uniform float sizeScale;   // viewportHeight / referenceHeight — 1.0 at load, scales on resize
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
    vec2 p = gl_PointCoord - 0.5;   // centre at origin, [-0.5, 0.5]
    float d = length(p);
    if (d > 0.5) discard;

    float angle = atan(p.y, p.x);

    // ── Irregular boundary — polystyrene / foam flake silhouette ─────────
    // Several harmonics at non-integer ratios produce an organic, lumpy edge
    // with no symmetry axis — looks like a torn piece of expanded foam.
    float r = 0.41
      + 0.016 * sin(angle * 2.0 + 1.23)
      + 0.012 * cos(angle * 3.0 + 0.67)
      + 0.007 * sin(angle * 5.0 + 2.14)
      + 0.004 * cos(angle * 4.0 + 3.50);

    // Edge — firm but not razor-sharp, like compressed expanded foam
    float alpha = 1.0 - smoothstep(r - 0.038, r + 0.022, d);

    // Subtle inner foam texture: concentric rings broken by angular variation
    float foam = 0.88 + 0.12 * sin(d * 20.0 + angle * 1.8);
    alpha *= mix(1.0, foam, smoothstep(0.0, 0.28, d));

    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha < 0.02) discard;

    // Very subtle cool tint only at the rim (foam is mostly pure white)
    vec3 col = mix(snowColor, vec3(0.80, 0.91, 1.0), smoothstep(0.22, r, d) * 0.28);

    gl_FragColor = vec4(col, alpha * fragOpacity);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  Canvas / Scene
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.querySelector("canvas.webgl");
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0xFAE9F6);

// ─────────────────────────────────────────────────────────────────────────────
//  Model
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
//  Lights
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
//  Sizes / resize
// ─────────────────────────────────────────────────────────────────────────────
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


// ─────────────────────────────────────────────────────────────────────────────
//  Camera
// ─────────────────────────────────────────────────────────────────────────────

const camPresets = {
  //A: { fov: 28,  posX: 50.0, posY: 10.5, posZ: -10.6, targetX: 0, targetY: 0.75, targetZ: 0, rotateSpeed: 0.3, enableZoom: false },
  B: { fov: 24,  posX: 50.0, posY: 25.4, posZ: -31.5, targetX: 0, targetY: 0.75, targetZ: 0, rotateSpeed: 0.3, enableZoom: false },
};
let activeCamPreset = "B";

const cameraParams = { ...camPresets.B };

const camera = new THREE.PerspectiveCamera(cameraParams.fov, sizes.width / sizes.height, 0.1, 100);
camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ);
scene.add(camera);

// ─────────────────────────────────────────────────────────────────────────────
//  Controls
// ─────────────────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, canvas);
controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ);
controls.enableDamping = true;
controls.enableZoom    = cameraParams.enableZoom;
controls.rotateSpeed   = cameraParams.rotateSpeed;

const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
if (isTouchDevice) controls.rotateSpeed = cameraParams.rotateSpeed * 2;

// ─────────────────────────────────────────────────────────────────────────────
//  Renderer
// ─────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ─────────────────────────────────────────────────────────────────────────────
//  Glass Globe
// ─────────────────────────────────────────────────────────────────────────────
const GLOBE_RADIUS = 5;
const GLOBE_CENTER = new THREE.Vector3(0, 3.70, 0);

// ── Globe material parameters ────────────────────────
const globeParams = {
  // Geometry / position
  posY:                GLOBE_CENTER.y,
  // Base
  color:               '#0098a3',
  emissive:            '#000000',
  emissiveIntensity:   0.0,
  // PBR
  metalness:           10.95,
  roughness:           0.0,
  // Alpha
  transparent:         true,
  opacity:             0.051,
  depthWrite:          false,
  // Transmission / refraction
  transmission:        0.29,
  ior:                 1.5,
  thickness:           0.25,
  attenuationDistance: Infinity,
  attenuationColor:    '#ffffff',
  // Clearcoat
  clearcoat:           0.0,
  clearcoatRoughness:  0.0,
  // Reflectivity / specular
  reflectivity:        0.99,
  specularIntensity:   1.0,
  specularColor:       '#ffffff',
  // Sheen
  sheen:               0.0,
  sheenRoughness:      1.0,
  sheenColor:          '#000000',
  // Iridescence
  iridescence:         0.0,
  iridescenceIOR:      1.3,
  iridescenceThicknessMin: 100,
  iridescenceThicknessMax: 400,
  // Display
  side:                'Front',   // 'Front' | 'Back' | 'Double'
  wireframe:           false,
  flatShading:         false,
};

const glassSphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 32, 32),
  new THREE.MeshPhysicalMaterial({
    color:               globeParams.color,
    emissive:            globeParams.emissive,
    emissiveIntensity:   globeParams.emissiveIntensity,
    metalness:           globeParams.metalness,
    roughness:           globeParams.roughness,
    transparent:         globeParams.transparent,
    opacity:             globeParams.opacity,
    depthWrite:          globeParams.depthWrite,
    transmission:        globeParams.transmission,
    ior:                 globeParams.ior,
    thickness:           globeParams.thickness,
    attenuationDistance: globeParams.attenuationDistance,
    attenuationColor:    new THREE.Color(globeParams.attenuationColor),
    clearcoat:           globeParams.clearcoat,
    clearcoatRoughness:  globeParams.clearcoatRoughness,
    reflectivity:        globeParams.reflectivity,
    specularIntensity:   globeParams.specularIntensity,
    specularColor:       new THREE.Color(globeParams.specularColor),
    sheen:               globeParams.sheen,
    sheenRoughness:      globeParams.sheenRoughness,
    sheenColor:          new THREE.Color(globeParams.sheenColor),
    iridescence:         globeParams.iridescence,
    iridescenceIOR:      globeParams.iridescenceIOR,
    iridescenceThicknessRange: [globeParams.iridescenceThicknessMin, globeParams.iridescenceThicknessMax],
    side:                THREE.FrontSide,
    wireframe:           globeParams.wireframe,
    flatShading:         globeParams.flatShading,
  })
);
glassSphere.position.copy(GLOBE_CENTER);
scene.add(glassSphere);

// ── Pedestal parameters (all tweakable via GUI) ──────────────────────────────
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
  color:              0xcde0fe,
  metalness:          0.0,
  roughness:          0.5,
  clearcoat:          0.0,
  clearcoatRoughness: 0.04,
  transmission:       0.70,
  ior:                1.5,
  thickness:          0.5,
  flatShading:        true,
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
  radiusTop:          3.8,
  radiusBottom:       5.0,
  height:             2.9,
  radialSegments:     64,
  posY:              -1.85,
  // material
  color:              "#cde8fe",
  metalness:          0.02,
  roughness:          0.0,
  clearcoat:          0.0,
  clearcoatRoughness: 0.0,
  transmission:       0.38,
  ior:                2.5,
  thickness:          1.1,
  flatShading:        true,
};

const bottomCylMaterial = new THREE.MeshPhysicalMaterial({
  color:              bottomCylParams.color,
  metalness:          bottomCylParams.metalness,
  roughness:          bottomCylParams.roughness,
  clearcoat:          bottomCylParams.clearcoat,
  clearcoatRoughness: bottomCylParams.clearcoatRoughness,
  transmission:       bottomCylParams.transmission,
  ior:                bottomCylParams.ior,
  thickness:          bottomCylParams.thickness,
  flatShading:        bottomCylParams.flatShading,
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

function rebuildBottomCylinder() {
  const p = bottomCylParams;
  bottomCylinder.geometry.dispose();
  bottomCylinder.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
  bottomCylinder.position.y = p.posY;
}


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

// ─────────────────────────────────────────────────────────────────────────────
//  Torus
// ─────────────────────────────────────────────────────────────────────────────
const torusParams = {
  radius:          4.7,
  tube:            0.25,
  radialSegments:  40,
  tubularSegments: 69,
  posY:           -3.4,
};

const torusMaterial = new THREE.MeshPhysicalMaterial({
  color:              0xe8c09a,
  //metalness:          0.6,
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
torus.rotation.x = Math.PI / 2;   // lay flat
torus.position.y = torusParams.posY;
scene.add(torus);

function rebuildTorus() {
  const p = torusParams;
  torus.geometry.dispose();
  torus.geometry = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
  torus.position.y = p.posY;
}

// ─────────────────────────────────────────────────────────────────────────────
//  3D Text — "Jokulsarlon" 
// ─────────────────────────────────────────────────────────────────────────────
const textParams = {
  posX:               0.0,
  posY:              -0.4,
  posZ:               0.0,
  rotX:               0.0,
  rotY:               2.2,
  rotZ:               0.0,
  size:               0.6,
  depth:              0.15,
  letterSpacing:      0.0,
  kernJo:            -0.08,  // negative = pull o closer to J
  metalness:          0.31,
  roughness:          0.0,
  clearcoat:          0.24,
  clearcoatRoughness: 0.65,
  color:              "#b28053",
};

const textMaterial = new THREE.MeshPhysicalMaterial({
  color:              textParams.color,
  roughness:          textParams.roughness,
  metalness:          textParams.metalness,
  clearcoat:          textParams.clearcoat,
  clearcoatRoughness: textParams.clearcoatRoughness,
});

// Group wraps all character meshes — move/rotate this to reposition the text
const textGroup = new THREE.Group();
scene.add(textGroup);

let loadedFont = null;

function rebuildText() {
  if (!loadedFont) return;

  // Dispose & remove old meshes
  while (textGroup.children.length > 0) {
    const m = textGroup.children[0];
    m.geometry.dispose();
    textGroup.remove(m);
  }

  const arcR = pedestalParams.radius;
  const text  = "Jokulsarlon";

  // ── Pass 1: build per-character geometries and measure widths ─────────────
  const charData = [];
  let totalWidth = 0;
  for (const char of text) {
    const geo = new TextGeometry(char, {
      font:           loadedFont,
      size:           textParams.size,
      height:         textParams.depth,
      curveSegments:  16,
      bevelEnabled:   true,
      bevelThickness: 0.015,
      bevelSize:      0.008,
      bevelSegments:  4,
    });
    geo.computeBoundingBox();
    const w = geo.boundingBox.max.x - geo.boundingBox.min.x;
    charData.push({ geo, w });
    totalWidth += w;
  }
  totalWidth += textParams.letterSpacing * (charData.length - 1);
  totalWidth += textParams.kernJo;       // kerning shifts total width too

  // ── Pass 2: place each char flat (centred), then apply cylindrical warp ───
  let xCursor = -totalWidth / 2;
  charData.forEach(({ geo, w }, idx) => {
    if (idx === 1) xCursor += textParams.kernJo;   // between J (0) and o (1)

    geo.translate(xCursor, 0, 0);        // position in flat layout

    // Cylindrical warp: x → arc angle, z (extrusion) → radial offset
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

// ─────────────────────────────────────────────────────────────────────────────
//  Cylinder 3  - guide
// ─────────────────────────────────────────────────────────────────────────────
const torus3Params = {
  radiusTop:      4.8,
  radiusBottom:   4.25,
  height:         1.45,
  radialSegments: 42,
  posX:           0.0,
  posY:          -2.1,
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
torus3.visible = false;             // hidden — GUI has a toggle to reveal wireframe
scene.add(torus3);

function rebuildTorus3() {
  const p = torus3Params;
  torus3.geometry.dispose();
  torus3.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
  torus3.position.set(p.posX, p.posY, p.posZ);
  rebuildDots();                    // dots always follow the guide cylinder
}

// ─────────────────────────────────────────────────────────────────────────────
//  Torus 3 - dots
// ─────────────────────────────────────────────────────────────────────────────
const dotParams = {
  count:     20,
  size:      0.17,
  color:     "#edddf6",
  roughness: 1.0,
  metalness: 0.0,
};

const MAX_DOTS    = 2000;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));  

const dotMat = new THREE.MeshPhysicalMaterial({
  color:     dotParams.color,
  roughness: dotParams.roughness,
  metalness: dotParams.metalness,
});

// Unit sphere — size is encoded as per-instance scale, so no geometry rebuild needed
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
    const y = (t - 0.5) * height;                 // centred at origin
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

// ─────────────────────────────────────────────────────────────────────────────
//  Snow params
// ─────────────────────────────────────────────────────────────────────────────
const snowParams = {
  // Flakes
  amount:       3000,
  sizeMin:      0.2,
  sizeMax:      2.1,
  color:        "#ffffff",
  opacityMin:   0.98,
  opacityMax:   2.5,
  // Physics
  gravity:      0.000004,
  damping:      0.9999,
  bounceEnergy: 0.2,
  // Drift
  speedMult:    0.9,
  oscillation:  0.000022,
  jitter:       0.001,
  // Spin
  turbStrength: 0.5,
  turbDecay:    0.6,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Snow — geometry 
// ─────────────────────────────────────────────────────────────────────────────
const MAX_SNOW    = 12000;
const SNOW_RADIUS = 4.5;
const SNOW_CENTER = GLOBE_CENTER.clone();
const FLOOR_Y     = 0.49;   // water-mirror surface — hard lower boundary

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
    y = (Math.random() * 0.5 - 1) * SNOW_RADIUS;
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
  snowOpacities[i] = active
    ? snowParams.opacityMin + snowBaseOpacity[i] * (snowParams.opacityMax - snowParams.opacityMin)
    : 0;
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
    sizeScale: { value: 1.0 },   // starts at 1 → identical to original at load height
  },
  transparent: true,
  depthWrite:  false,
  blending:    THREE.NormalBlending,
});

scene.add(new THREE.Points(snowGeometry, snowMaterial));

// ── Static dots specks for the orb ────────────────────
{
  const pos = new Float32Array(2000 * 3);
  for (let i = 0; i < 2000; i++) {
    let x, y, z;
    do { x = (Math.random()*2-1)*SNOW_RADIUS; y = (Math.random()*2-1)*SNOW_RADIUS; z = (Math.random()*2-1)*SNOW_RADIUS; }
    while (x*x + y*y + z*z > SNOW_RADIUS * SNOW_RADIUS);
    pos[i*3] = SNOW_CENTER.x+x;  pos[i*3+1] = SNOW_CENTER.y+y;  pos[i*3+2] = SNOW_CENTER.z+z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.5, depthWrite: false })));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Snow — GUI helpers
// ─────────────────────────────────────────────────────────────────────────────
/* function refreshSizes() {
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
    attr.array[i] = i < snowParams.amount
      ? snowParams.opacityMin + snowBaseOpacity[i] * (snowParams.opacityMax - snowParams.opacityMin)
      : 0;
  }
  attr.needsUpdate = true;
}
 */
// ─────────────────────────────────────────────────────────────────────────────
//  Scene colour controls
// ─────────────────────────────────────────────────────────────────────────────
const sceneColors = {
  sphere:     "#aa9900",
  mirror:     "#90d4fe",
  background: "#f1eafb",
  capTop:     "#ffffff",
};

//const gui = new GUI({ title: "🎨  Colours", width: 260 });
/* 
const fCamera = gui.addFolder("🎥  Camera");

// Helper — apply cameraParams to the live camera + controls + refresh all sliders
function applyCameraParams() {
  camera.fov = cameraParams.fov;
  camera.updateProjectionMatrix();
  camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ);
  controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ);
  controls.rotateSpeed = cameraParams.rotateSpeed;
  controls.enableZoom  = cameraParams.enableZoom;
  controls.update();
  fCamera.controllers.forEach(c => c.updateDisplay());
}

// Toggle button — switches between preset A and B, updates everything
const toggleProxy = { toggle: () => {
  activeCamPreset = activeCamPreset === "A" ? "B" : "A";
  Object.assign(cameraParams, camPresets[activeCamPreset]);
  applyCameraParams();
  toggleBtn.name(activeCamPreset === "A" ? "⇄  Switch to B" : "⇄  Switch to A");
}};
const toggleBtn = fCamera.add(toggleProxy, "toggle").name("⇄  Switch to A");

fCamera.add(cameraParams, "fov", 20, 120, 1).name("FOV")
  .onChange(v => { camera.fov = v; camera.updateProjectionMatrix(); });
fCamera.add(cameraParams, "posX", -100, 100, 0.1).name("Pos X")
  .onChange(() => { camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ); controls.update(); });
fCamera.add(cameraParams, "posY",  -50,  50, 0.1).name("Pos Y")
  .onChange(() => { camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ); controls.update(); });
fCamera.add(cameraParams, "posZ", -100, 100, 0.1).name("Pos Z")
  .onChange(() => { camera.position.set(cameraParams.posX, cameraParams.posY, cameraParams.posZ); controls.update(); });
fCamera.add(cameraParams, "targetX", -20, 20, 0.05).name("Target X")
  .onChange(() => { controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ); controls.update(); });
fCamera.add(cameraParams, "targetY", -20, 20, 0.05).name("Target Y")
  .onChange(() => { controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ); controls.update(); });
fCamera.add(cameraParams, "targetZ", -20, 20, 0.05).name("Target Z")
  .onChange(() => { controls.target.set(cameraParams.targetX, cameraParams.targetY, cameraParams.targetZ); controls.update(); });
fCamera.add(cameraParams, "rotateSpeed", 0.05, 2.0, 0.05).name("Rotate speed")
  .onChange(v => { controls.rotateSpeed = v; });
fCamera.add(cameraParams, "enableZoom").name("Enable zoom")
  .onChange(v => { controls.enableZoom = v; });
fCamera.add({
  log: () => {
    const p = camera.position;
    const t = controls.target;
    const out = `posX: ${p.x.toFixed(2)}, posY: ${p.y.toFixed(2)}, posZ: ${p.z.toFixed(2)}\ntargetX: ${t.x.toFixed(2)}, targetY: ${t.y.toFixed(2)}, targetZ: ${t.z.toFixed(2)}`;
    console.log(out);
    if (navigator.clipboard) navigator.clipboard.writeText(out);
  }
}, "log").name("📋  Copy current position");
fCamera.close();

// gui.addColor(sceneColors, "mirror").name("Mirror colour")
//   .onChange(v => groundMirror.material.uniforms.color.value.set(v));
// gui.addColor(sceneColors, "capTop").name("Top cap")
//   .onChange(v => capDiscTop.material.color.set(v));
// gui.addColor(sceneColors, "background").name("Background")
//   .onChange(v => scene.background.set(v));

// Fixed offsets so cap radii stay locked relative to the main radius
const capBotOffset = pedestalParams.radius - pedestalParams.capBotRadius; // 0.05
const capTopOffset = pedestalParams.radius - pedestalParams.capTopRadius; // 0.12

// ─────────────────────────────────────────────────────────────────────────────
//  Glass Globe GUI
// ─────────────────────────────────────────────────────────────────────────────
const globeSideMap = { Front: THREE.FrontSide, Back: THREE.BackSide, Double: THREE.DoubleSide };

const fGlobe = gui.addFolder("🔮  Glass Globe");

// Geometry / position
fGlobe.add(globeParams, "posY", -5.0, 10.0, 0.05).name("Y position")
  .onChange(v => { glassSphere.position.y = v; });

// Base colour + emissive
fGlobe.addColor(globeParams, "color").name("Colour")
  .onChange(v => glassSphere.material.color.set(v));
fGlobe.addColor(globeParams, "emissive").name("Emissive")
  .onChange(v => glassSphere.material.emissive.set(v));
fGlobe.add(globeParams, "emissiveIntensity", 0.0, 5.0, 0.01).name("Emissive intensity")
  .onChange(v => { glassSphere.material.emissiveIntensity = v; });

// PBR
fGlobe.add(globeParams, "metalness",  0.0, 15.0, 0.05).name("Metalness")
  .onChange(v => { glassSphere.material.metalness = v; });
fGlobe.add(globeParams, "roughness",  0.0, 1.0, 0.01).name("Roughness")
  .onChange(v => { glassSphere.material.roughness = v; });

// Alpha
fGlobe.add(globeParams, "opacity",    0.0, 1.0, 0.001).name("Opacity")
  .onChange(v => { glassSphere.material.opacity = v; });
fGlobe.add(globeParams, "transparent").name("Transparent")
  .onChange(v => { glassSphere.material.transparent = v; glassSphere.material.needsUpdate = true; });
fGlobe.add(globeParams, "depthWrite").name("Depth write")
  .onChange(v => { glassSphere.material.depthWrite = v; glassSphere.material.needsUpdate = true; });

// Transmission / refraction
fGlobe.add(globeParams, "transmission",        0.0,  1.0,    0.01).name("Transmission")
  .onChange(v => { glassSphere.material.transmission = v; });
fGlobe.add(globeParams, "ior",                 1.0,  2.5,    0.01).name("IOR")
  .onChange(v => { glassSphere.material.ior = v; });
fGlobe.add(globeParams, "thickness",           0.0,  10.0,   0.05).name("Thickness")
  .onChange(v => { glassSphere.material.thickness = v; });
fGlobe.add(globeParams, "attenuationDistance", 0.01, 9999.0, 0.1).name("Attenuation dist (9999=∞)")
  .onChange(v => { glassSphere.material.attenuationDistance = v >= 9999 ? Infinity : v; });
fGlobe.addColor(globeParams, "attenuationColor").name("Attenuation colour")
  .onChange(v => glassSphere.material.attenuationColor.set(v));

// Clearcoat
fGlobe.add(globeParams, "clearcoat",           0.0, 1.0, 0.01).name("Clearcoat")
  .onChange(v => { glassSphere.material.clearcoat = v; });
fGlobe.add(globeParams, "clearcoatRoughness",  0.0, 1.0, 0.01).name("Clearcoat rough")
  .onChange(v => { glassSphere.material.clearcoatRoughness = v; });

// Reflectivity / specular
fGlobe.add(globeParams, "reflectivity",        0.0, 1.0, 0.01).name("Reflectivity")
  .onChange(v => { glassSphere.material.reflectivity = v; });
fGlobe.add(globeParams, "specularIntensity",   0.0, 1.0, 0.01).name("Specular intensity")
  .onChange(v => { glassSphere.material.specularIntensity = v; });
fGlobe.addColor(globeParams, "specularColor").name("Specular colour")
  .onChange(v => glassSphere.material.specularColor.set(v));

// Sheen
fGlobe.add(globeParams, "sheen",               0.0, 1.0, 0.01).name("Sheen")
  .onChange(v => { glassSphere.material.sheen = v; });
fGlobe.add(globeParams, "sheenRoughness",      0.0, 1.0, 0.01).name("Sheen roughness")
  .onChange(v => { glassSphere.material.sheenRoughness = v; });
fGlobe.addColor(globeParams, "sheenColor").name("Sheen colour")
  .onChange(v => glassSphere.material.sheenColor.set(v));

// Iridescence
fGlobe.add(globeParams, "iridescence",              0.0, 1.0,  0.01).name("Iridescence")
  .onChange(v => { glassSphere.material.iridescence = v; });
fGlobe.add(globeParams, "iridescenceIOR",           1.0, 2.5,  0.01).name("Iridescence IOR")
  .onChange(v => { glassSphere.material.iridescenceIOR = v; });
fGlobe.add(globeParams, "iridescenceThicknessMin",  0,   1000, 5   ).name("Iridescence t-min")
  .onChange(v => { glassSphere.material.iridescenceThicknessRange = [v, globeParams.iridescenceThicknessMax]; });
fGlobe.add(globeParams, "iridescenceThicknessMax",  0,   1000, 5   ).name("Iridescence t-max")
  .onChange(v => { glassSphere.material.iridescenceThicknessRange = [globeParams.iridescenceThicknessMin, v]; });

// Display
fGlobe.add(globeParams, "side", Object.keys(globeSideMap)).name("Side")
  .onChange(v => { glassSphere.material.side = globeSideMap[v]; glassSphere.material.needsUpdate = true; });
fGlobe.add(globeParams, "wireframe").name("Wireframe")
  .onChange(v => { glassSphere.material.wireframe = v; });
fGlobe.add(globeParams, "flatShading").name("Flat shading")
  .onChange(v => { glassSphere.material.flatShading = v; glassSphere.material.needsUpdate = true; });

// ── Globe A/B snapshot ─────────────────────────────────────────────────────
let globeSnapA   = { ...globeParams };   // auto-saved at page load
let globeSnapB   = null;
let globeOnSnapA = false;

function applyGlobeState(snap) {
  Object.assign(globeParams, snap);
  const gm = glassSphere.material;
  gm.color.set(globeParams.color);
  gm.emissive.set(globeParams.emissive);
  gm.emissiveIntensity   = globeParams.emissiveIntensity;
  gm.metalness           = globeParams.metalness;
  gm.roughness           = globeParams.roughness;
  gm.transparent         = globeParams.transparent;
  gm.opacity             = globeParams.opacity;
  gm.depthWrite          = globeParams.depthWrite;
  gm.transmission        = globeParams.transmission;
  gm.ior                 = globeParams.ior;
  gm.thickness           = globeParams.thickness;
  gm.attenuationDistance = globeParams.attenuationDistance;
  gm.attenuationColor.set(globeParams.attenuationColor);
  gm.clearcoat           = globeParams.clearcoat;
  gm.clearcoatRoughness  = globeParams.clearcoatRoughness;
  gm.reflectivity        = globeParams.reflectivity;
  gm.specularIntensity   = globeParams.specularIntensity;
  gm.specularColor.set(globeParams.specularColor);
  gm.sheen               = globeParams.sheen;
  gm.sheenRoughness      = globeParams.sheenRoughness;
  gm.sheenColor.set(globeParams.sheenColor);
  gm.iridescence         = globeParams.iridescence;
  gm.iridescenceIOR      = globeParams.iridescenceIOR;
  gm.iridescenceThicknessRange = [globeParams.iridescenceThicknessMin, globeParams.iridescenceThicknessMax];
  gm.side                = globeSideMap[globeParams.side] ?? THREE.FrontSide;
  gm.wireframe           = globeParams.wireframe;
  gm.flatShading         = globeParams.flatShading;
  gm.needsUpdate         = true;
  glassSphere.position.y = globeParams.posY;
  fGlobe.controllersRecursive().forEach(c => c.updateDisplay());
}

fGlobe.add({ fn: () => { globeSnapA = { ...globeParams }; globeOnSnapA = false; } }, 'fn')
  .name('💾  Save globe  (A)');
fGlobe.add({
  fn: () => {
    if (!globeOnSnapA) { globeSnapB = { ...globeParams }; applyGlobeState(globeSnapA); globeOnSnapA = true; }
    else               { if (globeSnapB) applyGlobeState(globeSnapB); globeOnSnapA = false; }
  }
}, 'fn').name('🔁  Toggle globe  A ↔ B');

fGlobe.close();

const fPedestal = gui.addFolder("🏛️  Pedestal");
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

const fBottomCyl = gui.addFolder("🔷  Bottom Cylinder");
fBottomCyl.add(bottomCylParams, "radiusTop",      0.1, 20.0, 0.05).name("Radius top")      .onChange(rebuildBottomCylinder);
fBottomCyl.add(bottomCylParams, "radiusBottom",   0.1, 20.0, 0.05).name("Radius bottom")   .onChange(rebuildBottomCylinder);
fBottomCyl.add(bottomCylParams, "height",         0.1, 20.0, 0.05).name("Height")          .onChange(rebuildBottomCylinder);
fBottomCyl.add(bottomCylParams, "radialSegments", 3,   64,   1   ).name("Radial segments") .onChange(rebuildBottomCylinder);
fBottomCyl.add(bottomCylParams, "posY",          -10.0, 5.0, 0.05).name("Y position")      .onChange(rebuildBottomCylinder);
fBottomCyl.addColor(bottomCylParams, "color").name("Colour")
  .onChange(v => bottomCylinder.material.color.set(v));
fBottomCyl.add(bottomCylParams, "metalness",          0.0, 1.0, 0.01).name("Metalness")
  .onChange(v => { bottomCylinder.material.metalness = v; });
fBottomCyl.add(bottomCylParams, "roughness",          0.0, 1.0, 0.01).name("Roughness")
  .onChange(v => { bottomCylinder.material.roughness = v; });
fBottomCyl.add(bottomCylParams, "clearcoat",          0.0, 1.0, 0.01).name("Clearcoat")
  .onChange(v => { bottomCylinder.material.clearcoat = v; });
fBottomCyl.add(bottomCylParams, "clearcoatRoughness", 0.0, 1.0, 0.01).name("Clearcoat rough")
  .onChange(v => { bottomCylinder.material.clearcoatRoughness = v; });
fBottomCyl.add(bottomCylParams, "transmission",       0.0, 1.0, 0.01).name("Transmission")
  .onChange(v => { bottomCylinder.material.transmission = v; });
fBottomCyl.add(bottomCylParams, "ior",                1.0, 2.5, 0.01).name("IOR")
  .onChange(v => { bottomCylinder.material.ior = v; });
fBottomCyl.add(bottomCylParams, "thickness",          0.0, 5.0, 0.05).name("Thickness")
  .onChange(v => { bottomCylinder.material.thickness = v; });
fBottomCyl.add(bottomCylParams, "flatShading").name("Flat shading")
  .onChange(v => { bottomCylinder.material.flatShading = v; bottomCylinder.material.needsUpdate = true; });
fBottomCyl.close();

const fText = gui.addFolder("✍️  Text");
fText.add(textParams, "posX",  -10.0, 10.0, 0.05).name("X offset")         .onChange(updateTextPosition);
fText.add(textParams, "posY",  -10.0, 10.0, 0.05).name("Y position")        .onChange(updateTextPosition);
fText.add(textParams, "posZ",  -10.0, 10.0, 0.05).name("Z position")        .onChange(updateTextPosition);
fText.add(textParams, "rotX", -Math.PI, Math.PI, 0.01).name("Rot X")        .onChange(updateTextPosition);
fText.add(textParams, "rotY", -Math.PI, Math.PI, 0.01).name("Rot Y")        .onChange(updateTextPosition);
fText.add(textParams, "rotZ", -Math.PI, Math.PI, 0.01).name("Rot Z")        .onChange(updateTextPosition);
fText.add(textParams, "size",          0.1,  3.0, 0.05).name("Size")         .onChange(rebuildText);
fText.add(textParams, "depth",        0.01,  1.0, 0.01).name("Depth")        .onChange(rebuildText);
fText.add(textParams, "letterSpacing", 0.0,  2.0, 0.01).name("Letter spacing").onChange(rebuildText);
fText.add(textParams, "kernJo",       -0.5,  0.5, 0.01).name("Kern J→o")      .onChange(rebuildText);
fText.addColor(textParams, "color").name("Colour")
  .onChange(v => textMaterial.color.set(v));
fText.add(textParams, "metalness",          0.0, 1.0, 0.01).name("Metalness")          .onChange(v => { textMaterial.metalness          = v; });
fText.add(textParams, "roughness",          0.0, 1.0, 0.01).name("Roughness")          .onChange(v => { textMaterial.roughness          = v; });
fText.add(textParams, "clearcoat",          0.0, 1.0, 0.01).name("Clearcoat")          .onChange(v => { textMaterial.clearcoat          = v; });
fText.add(textParams, "clearcoatRoughness", 0.0, 1.0, 0.01).name("Clearcoat roughness").onChange(v => { textMaterial.clearcoatRoughness = v; });
fText.close();

const fTorus = gui.addFolder("⭕  Torus");
fTorus.add(torusParams, "radius",          0.5, 20.0, 0.05).name("Radius")           .onChange(rebuildTorus);
fTorus.add(torusParams, "tube",            0.05, 3.0, 0.05).name("Tube thickness")   .onChange(rebuildTorus);
fTorus.add(torusParams, "radialSegments",  3,    64,  1   ).name("Radial segments")  .onChange(rebuildTorus);
fTorus.add(torusParams, "tubularSegments", 8,   200,  1   ).name("Tubular segments") .onChange(rebuildTorus);
fTorus.add(torusParams, "posY",           -8.0,  8.0, 0.05).name("Y position")       .onChange(rebuildTorus);
fTorus.addColor({ color: "#e8c09a" }, "color").name("Colour")
  .onChange(v => torusMaterial.color.set(v));
fTorus.close();

const fTorus2 = gui.addFolder("⭕  Torus 2");
fTorus2.add(torus2Params, "radius",          0.5, 20.0, 0.05).name("Radius")           .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "tube",            0.05, 3.0, 0.05).name("Tube thickness")   .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "radialSegments",  3,    64,  1   ).name("Radial segments")  .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "tubularSegments", 8,   200,  1   ).name("Tubular segments") .onChange(rebuildTorus2);
fTorus2.add(torus2Params, "posY",           -8.0,  8.0, 0.05).name("Y position")       .onChange(rebuildTorus2);
fTorus2.addColor({ color: "#606c90" }, "color").name("Colour")
  .onChange(v => torus2Material.color.set(v));
fTorus2.close();

const fTorus3 = gui.addFolder("🔵  Cylinder (dot guide)");
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

const fDots = gui.addFolder("✦  Torus Dots");
fDots.add(dotParams, "count",     1, MAX_DOTS, 1    ).name("Count")    .onChange(rebuildDots);
fDots.add(dotParams, "size",      0.01, 0.5,   0.005).name("Dot size") .onChange(rebuildDots);
fDots.addColor(dotParams, "color").name("Colour")
  .onChange(v => dotMat.color.set(v));
fDots.add(dotParams, "roughness", 0.0, 1.0, 0.01).name("Roughness")
  .onChange(v => { dotMat.roughness = v; });
fDots.add(dotParams, "metalness", 0.0, 1.0, 0.01).name("Metalness")
  .onChange(v => { dotMat.metalness = v; });
fDots.close(); */

// ─────────────────────────────────────────────────────────────────────────────
//  Snow — GUI panel (commented out — settings baked into snowParams above)
// ─────────────────────────────────────────────────────────────────────────────
//const gui = new GUI({ title: "❄️  Snow Controls", width: 310 });
/* 
const fFlakes = gui.addFolder("❄️   Flakes");
fFlakes.add(snowParams, "amount",     10, MAX_SNOW, 1   ).name("Amount").onChange(() => { refreshSizes(); refreshOpacities(); });
fFlakes.add(snowParams, "sizeMin",   0.2, 10.0,     0.1 ).name("Size  min").onChange(refreshSizes);
fFlakes.add(snowParams, "sizeMax",   0.5, 20.0,     0.1 ).name("Size  max").onChange(refreshSizes);
fFlakes.addColor(snowParams, "color").name("Color")
  .onChange(v => snowMaterial.uniforms.snowColor.value.set(v));
fFlakes.add(snowParams, "opacityMin", 0.0, 3.0, 0.01).name("Opacity  min").onChange(refreshOpacities);
fFlakes.add(snowParams, "opacityMax", 0.0, 3.0, 0.01).name("Opacity  max").onChange(refreshOpacities);

const fPhysics = gui.addFolder("🌊   Physics");
fPhysics.add(snowParams, "gravity",      0,    0.0002, 0.000001).name("Gravity");
fPhysics.add(snowParams, "damping",      0.90, 0.9999, 0.0001  ).name("Damping");
fPhysics.add(snowParams, "bounceEnergy", 0.0,  1.0,    0.01    ).name("Bounce energy");

const fDrift = gui.addFolder("✨   Drift");
fDrift.add(snowParams, "speedMult",   0.0, 5.0,    0.01    ).name("Speed ×");
fDrift.add(snowParams, "oscillation", 0,   0.0005, 0.000001).name("Oscillation");
fDrift.add(snowParams, "jitter",      0,   0.001,  0.000001).name("Jitter");

const fSpin = gui.addFolder("🌀   Spin");
fSpin.add(snowParams, "turbStrength", 0,   50,    0.5  ).name("Strength");
fSpin.add(snowParams, "turbDecay",    0.5, 0.999, 0.001).name("Decay");
 */
// ─────────────────────────────────────────────────────────────────────────────
//  A / B snapshot — save a base look, tweak freely, toggle back instantly
// ─────────────────────────────────────────────────────────────────────────────
function captureState() {
  return {
    globe:     { ...globeParams },
    bottomCyl: { ...bottomCylParams },
    snow:      { ...snowParams },
    pedestal:  { ...pedestalParams },
    colors:    { ...sceneColors },
  };
}

function applyState(snap) {
  // ── Globe ──────────────────────────────────────────────────────────────────
  Object.assign(globeParams, snap.globe);
  const gm = glassSphere.material;
  gm.color.set(globeParams.color);
  gm.emissive.set(globeParams.emissive);
  gm.emissiveIntensity   = globeParams.emissiveIntensity;
  gm.metalness           = globeParams.metalness;
  gm.roughness           = globeParams.roughness;
  gm.transparent         = globeParams.transparent;
  gm.opacity             = globeParams.opacity;
  gm.depthWrite          = globeParams.depthWrite;
  gm.transmission        = globeParams.transmission;
  gm.ior                 = globeParams.ior;
  gm.thickness           = globeParams.thickness;
  gm.attenuationDistance = globeParams.attenuationDistance;
  gm.attenuationColor.set(globeParams.attenuationColor);
  gm.clearcoat           = globeParams.clearcoat;
  gm.clearcoatRoughness  = globeParams.clearcoatRoughness;
  gm.reflectivity        = globeParams.reflectivity;
  gm.specularIntensity   = globeParams.specularIntensity;
  gm.specularColor.set(globeParams.specularColor);
  gm.sheen               = globeParams.sheen;
  gm.sheenRoughness      = globeParams.sheenRoughness;
  gm.sheenColor.set(globeParams.sheenColor);
  gm.iridescence         = globeParams.iridescence;
  gm.iridescenceIOR      = globeParams.iridescenceIOR;
  gm.iridescenceThicknessRange = [globeParams.iridescenceThicknessMin, globeParams.iridescenceThicknessMax];
  gm.side                = globeSideMap[globeParams.side] ?? THREE.FrontSide;
  gm.wireframe           = globeParams.wireframe;
  gm.flatShading         = globeParams.flatShading;
  gm.needsUpdate         = true;
  glassSphere.position.y = globeParams.posY;

  // ── Bottom cylinder ────────────────────────────────────────────────────────
  Object.assign(bottomCylParams, snap.bottomCyl);
  const bm = bottomCylinder.material;
  bm.color.set(bottomCylParams.color);
  bm.metalness          = bottomCylParams.metalness;
  bm.roughness          = bottomCylParams.roughness;
  bm.clearcoat          = bottomCylParams.clearcoat;
  bm.clearcoatRoughness = bottomCylParams.clearcoatRoughness;
  bm.transmission       = bottomCylParams.transmission;
  bm.ior                = bottomCylParams.ior;
  bm.thickness          = bottomCylParams.thickness;
  bm.flatShading        = bottomCylParams.flatShading;
  bm.needsUpdate        = true;
  rebuildBottomCylinder();

  // ── Snow ───────────────────────────────────────────────────────────────────
  Object.assign(snowParams, snap.snow);
  snowMaterial.uniforms.snowColor.value.set(snowParams.color);
  refreshSizes();
  refreshOpacities();

  // ── Pedestal ───────────────────────────────────────────────────────────────
  Object.assign(pedestalParams, snap.pedestal);
  rebuildPedestal();

  // ── Scene colours ──────────────────────────────────────────────────────────
  Object.assign(sceneColors, snap.colors);
  groundMirror.material.uniforms.color.value.set(sceneColors.mirror);
  scene.background.set(sceneColors.background);
  capDiscTop.material.color.set(sceneColors.capTop);

  // Sync every GUI controller display without firing onChange
  //gui.controllersRecursive().forEach(c => c.updateDisplay());
}

// State A = saved baseline   State B = what you had just before toggling to A
let stateA  = captureState();   // captured right now at page load
let stateB  = null;
let onStateA = false;           // we start in the "live" / B side
/* 
gui.add({
  fn: () => {
    stateA   = captureState();
    onStateA = false;           // treat current as B again after re-saving
    console.log("Snapshot A saved");
  }
}, "fn").name("💾  Save as A  (base)");

gui.add({
  fn: () => {
    if (!onStateA) {
      stateB   = captureState();   // save what we have now as B
      applyState(stateA);
      onStateA = true;
    } else {
      if (stateB) applyState(stateB);
      onStateA = false;
    }
  }
}, "fn").name("🔁  Toggle  A ↔ B");

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
}, "log").name("📋  Copy settings to clipboard");
 */
// ─────────────────────────────────────────────────────────────────────────────
//  Turbulence state
// ─────────────────────────────────────────────────────────────────────────────
let prevAzimuth      = controls.getAzimuthalAngle();
let prevPolar        = controls.getPolarAngle();
const snowTurbulence = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
//  Water mirror
// ─────────────────────────────────────────────────────────────────────────────
const mirrorShader = Reflector.ReflectorShader;
mirrorShader.vertexShader   = vertexShader;
mirrorShader.fragmentShader = fragmentShader;

// ── Generate DuDv map on canvas — no file load needed ────────────────────────
function makeDudvMap(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d   = img.data;
  const PI2 = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i  = (y * size + x) * 4;
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
      d[i]   = Math.round(du * 255);
      d[i+1] = Math.round(dv * 255);
      d[i+2] = 0;
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const dudvMap = makeDudvMap();
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

// ─────────────────────────────────────────────────────────────────────────────
//  Demo — Thick disk with frozen wave + water shader  [COMMENTED OUT]
//  Placed to the left of the snow globe.  Mouse interaction added later.
// ─────────────────────────────────────────────────────────────────────────────
// const WAVE_POS       = new THREE.Vector3(-13, 0, 3);
// const WAVE_RADIUS    = 3.5;
// const WAVE_THICKNESS = 1.5;
// const WAVE_BASE_Y    = WAVE_POS.y + WAVE_THICKNESS;   // world Y of the water surface

// // ── Side walls — open cylinder, slightly wider at the base ────────────────
// const waveDiskWallMat = new THREE.MeshPhysicalMaterial({
//   color:        0x8ab4d4,
//   roughness:    0.05,
//   transmission: 0.60,
//   thickness:    1.0,
//   ior:          1.33,
//   transparent:  true,
//   side:         THREE.DoubleSide,
// });

// const waveDiskBody = new THREE.Mesh(
//   new THREE.CylinderGeometry(WAVE_RADIUS, WAVE_RADIUS * 1.08, WAVE_THICKNESS, 64, 1, true),
//   waveDiskWallMat
// );
// waveDiskBody.position.set(WAVE_POS.x, WAVE_POS.y + WAVE_THICKNESS * 0.5, WAVE_POS.z);
// scene.add(waveDiskBody);

// // ── Bottom cap ─────────────────────────────────────────────────────────────
// const waveDiskBase = new THREE.Mesh(
//   new THREE.CircleGeometry(WAVE_RADIUS * 1.08, 64),
//   waveDiskWallMat
// );
// waveDiskBase.rotation.x = -Math.PI / 2;
// waveDiskBase.position.set(WAVE_POS.x, WAVE_POS.y, WAVE_POS.z);
// scene.add(waveDiskBase);

// // ── Top surface — custom ShaderMaterial with DuDv animated water ─────────
// // We can't use Reflector here: Reflector maps UVs via textureMatrix which
// // assumes a flat plane.  With deformed vertices the projection goes wrong
// // and the whole surface collapses to a solid teal fill.
// // Instead we drive the exact same DuDv distortion pass used on groundMirror,
// // but look up the texture with world-space XZ coords so it's immune to
// // any amount of vertex displacement.
// const waveSurfaceMat = new THREE.ShaderMaterial({
//   uniforms: {
//     tDudv: { value: dudvMap },
//     time:  { value: 0 },
//     color: { value: new THREE.Color(0x90d4fe) },
//   },
//   vertexShader: `
//     varying vec2 vWorldUv;
//     void main() {
//       // World-space XZ, scaled to roughly match the DuDv tiling on groundMirror
//       vec4 worldPos = modelMatrix * vec4(position, 1.0);
//       vWorldUv = worldPos.xz * 0.18;
//       gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
//     }
//   `,
//   fragmentShader: `
//     uniform sampler2D tDudv;
//     uniform float     time;
//     uniform vec3      color;
//     varying vec2      vWorldUv;
//     void main() {
//       float waveStrength = 0.12;
//       float waveSpeed    = 0.035;
//       vec2 uv = vWorldUv;
//       // Two-pass DuDv distortion — identical technique to the groundMirror shader
//       vec2 distortedUv = texture2D(tDudv, vec2(uv.x + time * waveSpeed, uv.y)).rg * waveStrength;
//       distortedUv = uv + vec2(distortedUv.x, distortedUv.y + time * waveSpeed);
//       vec2 distortion = (texture2D(tDudv, distortedUv).rg * 2.0 - 1.0) * waveStrength;
//       vec4 dudv = texture2D(tDudv, uv + distortion);
//       // Mix DuDv surface texture with the water colour
//       gl_FragColor = vec4(mix(dudv.rgb * 0.35 + vec3(0.05, 0.25, 0.45), color, 0.60), 0.95);
//     }
//   `,
//   transparent: true,
//   side: THREE.FrontSide,
// });

// const waveSurface = new THREE.Mesh(
//   new THREE.CircleGeometry(WAVE_RADIUS, 64),
//   waveSurfaceMat
// );
// waveSurface.position.set(WAVE_POS.x, WAVE_BASE_Y, WAVE_POS.z);
// waveSurface.rotation.x = -Math.PI / 2;
// scene.add(waveSurface);

// // ── Cache rest-state (X, Y) for each vertex ──────────────────────────────
// // Z is computed live every frame from scratch so there's no accumulation drift.
// // CircleGeometry: XY plane, Z = 0.  After rotation.x = -π/2, local Z → world Y.
// const waveVtxCount = waveSurface.geometry.attributes.position.count;
// const waveRestX    = new Float32Array(waveVtxCount);
// const waveRestY    = new Float32Array(waveVtxCount);
// const waveR2       = WAVE_RADIUS * WAVE_RADIUS;
// {
//   const wPos = waveSurface.geometry.attributes.position;
//   for (let i = 0; i < waveVtxCount; i++) {
//     waveRestX[i] = wPos.getX(i);
//     waveRestY[i] = wPos.getY(i);
//   }
// }

// ─────────────────────────────────────────────────────────────────────────────
//  Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

const tick = () => {
  const deltaTime   = clock.getDelta();
  const elapsedTime = clock.elapsedTime;
  // dt60 = 1.0 at 60 fps; all per-frame constants were tuned at 60 fps.
  // Clamped to 3 frames to prevent a huge jump after a tab switch or stall.
  const dt60 = Math.min(deltaTime * 165, 8);

  mirrorShader.uniforms.time.value          += 0.503  * dt60;
  groundMirror.material.uniforms.time.value += 0.0503 * dt60;
  //waveSurface.material.uniforms.time.value  += 0.0503 * dt60;
  controls.dampingFactor = 1 - Math.pow(0.95, dt60);
  controls.update();

  // ── Orbit delta → turbulence ──────────────────────────────────────────────
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
  // Horizontal spin alone gives turbulence.y = 0; feed a fraction of XZ magnitude
  // as upward kick so spinning always lifts flakes off the water surface.
  const hMag = Math.sqrt(snowTurbulence.x * snowTurbulence.x + snowTurbulence.z * snowTurbulence.z);
  snowTurbulence.y += hMag * 0.18 * dt60;
  snowTurbulence.multiplyScalar(snowParams.turbDecay ** dt60);

  // ── Snowflake physics ─────────────────────────────────────────────────────
  const posAttr = snowGeometry.attributes.position;
  const count   = snowParams.amount;

  for (let i = 0; i < count; i++) {
    let px = posAttr.getX(i);
    let py = posAttr.getY(i);
    let pz = posAttr.getZ(i);

    const vel = snowVelocities[i];
    const sc  = snowTurbScales[i];
    const sp  = snowParams.speedMult;

    // Spin turbulence — per-flake scale keeps them from clumping
    vel.x += snowTurbulence.x * sc * dt60;
    vel.y += snowTurbulence.y * sc * dt60;
    vel.z += snowTurbulence.z * sc * dt60;

    // Oscillation drift (unique phase per flake)
    const t = elapsedTime * 0.35 + snowPhases[i];
    vel.x += Math.sin(t * 0.9 + snowPhases[i] * 1.3) * snowParams.oscillation * sp * dt60;
    vel.z += Math.cos(t * 1.1 + snowPhases[i] * 0.7) * snowParams.oscillation * sp * dt60;

    // Brownian jitter — prevents convergence to the same attractor
    vel.x += (Math.random() - 0.5) * snowParams.jitter * sp * dt60;
    vel.z += (Math.random() - 0.5) * snowParams.jitter * sp * dt60;

    // Gravity
    vel.y -= snowParams.gravity * dt60;

    // Damping — exponent keeps per-second decay rate constant across frame rates
    vel.multiplyScalar(snowParams.damping ** dt60);

    let nx = px + vel.x * dt60;
    let ny = py + vel.y * dt60;
    let nz = pz + vel.z * dt60;

    // ── Spherical boundary ────────────────────────────────────────────────
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

    // ── Floor boundary — water surface ────────────────────────────────────
    // Flakes settle here and stay still until a spin disturbs them.
    if (ny < FLOOR_Y) {
      ny = FLOOR_Y;
      if (vel.y < 0) vel.y = 0;
      vel.x *= 0.78 ** dt60;     // surface friction: lateral slide damps quickly
      vel.z *= 0.78 ** dt60;
    }

    posAttr.setXYZ(i, nx, ny, nz);
  }

  posAttr.needsUpdate = true;

  //stats.begin();
  renderer.render(scene, camera);
  //stats.end();
  window.requestAnimationFrame(tick);
};

tick();
