import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import GUI from "lil-gui";

THREE.ColorManagement.enabled = false;

// ─────────────────────────────────────────────────────────────────────────────
//  Water shaders
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
  varying float fragOpacity;
  void main() {
    fragOpacity = vOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * (200.0 / -mvPosition.z), 2.0, 28.0);
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
directionalLight2.castShadow = true;
directionalLight2.shadow.mapSize.set(1024, 1024);
directionalLight2.position.set(-10, 20, 7);
scene.add(directionalLight2);

const pointLight = new THREE.PointLight(0xffffff, 0.55);
pointLight.position.set(0, 40, 2);
scene.add(pointLight);

// ─────────────────────────────────────────────────────────────────────────────
//  Sizes / resize
// ─────────────────────────────────────────────────────────────────────────────
const sizes = { width: window.innerWidth, height: window.innerHeight };
window.addEventListener("resize", () => {
  sizes.width  = window.innerWidth;
  sizes.height = window.innerHeight;
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ─────────────────────────────────────────────────────────────────────────────
//  Camera
// ─────────────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(63, sizes.width / sizes.height, 0.1, 100);
camera.position.set(10.2, 10.5, -10.6);
scene.add(camera);

// ─────────────────────────────────────────────────────────────────────────────
//  Controls
// ─────────────────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.75, 0);
controls.enableDamping = true;
controls.enableZoom    = false;
controls.rotateSpeed   = 0.3;

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

const glassSphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 32, 32),
  new THREE.MeshPhysicalMaterial({
    color: 0x0098a3,     roughness: 0.0, metalness: 10.95,
      transmission:     0.29,        
  ior:              1.5,       
  thickness:        0.25,        
    reflectivity: 0.99, transparent: true, opacity: 0.051,
    depthWrite: false, side: THREE.FrontSide,

  })
);
glassSphere.position.copy(GLOBE_CENTER);
scene.add(glassSphere);

// Rounded-bevel disc
const _bevel = 0.10, _segs = 12, _R = 4.9, _halfH = 1.0;
const _profile = [];
// Bottom outer corner: arc from bottom face → side
for (let i = 0; i <= _segs; i++) {
  const a = (Math.PI / 2) * (i / _segs);
  _profile.push(new THREE.Vector2(
    (_R - _bevel) + _bevel * Math.sin(a),
    (-_halfH + _bevel) - _bevel * Math.cos(a)
  ));
}
// Top outer corner: arc from side → top face
for (let i = 0; i <= _segs; i++) {
  const a = (Math.PI / 2) * (i / _segs);
  _profile.push(new THREE.Vector2(
    (_R - _bevel) + _bevel * Math.cos(a),
    (_halfH - _bevel) + _bevel * Math.sin(a)
  ));
}
const geometry = new THREE.LatheGeometry(_profile, 420);
const material = new THREE.MeshPhysicalMaterial({
  color:              0xFEE2BA,
  clearcoat:          1.0,    
  clearcoatRoughness: 0.04,
  reflectivity:       0.95,
  flatShading:        true,
   clearcoat:           1.0,  
  transmission:     0.70,        
  ior:              2.5,       
  thickness:        0.5,        
});
const cylinder = new THREE.Mesh( geometry, material );
scene.add( cylinder );
cylinder.position.y = -1.1;

// Flat cap disc bottom
const capDisc = new THREE.Mesh(
  new THREE.CircleGeometry(4.85, 420),
  new THREE.MeshBasicMaterial({ color: 0xE8C5AA, side: THREE.DoubleSide })
);
capDisc.rotation.x = -Math.PI / 2;          // rotate flat (CircleGeometry faces +Z by default)
capDisc.position.y = -1.1 - 1.0;            // cylinder.position.y − halfHeight = bottom face
scene.add(capDisc);

// Flat cap disc — top 
const capDiscTop = new THREE.Mesh(
  new THREE.CircleGeometry(4.78, 420),
  new THREE.MeshBasicMaterial({ color: 0xfbfff0, side: THREE.DoubleSide })
);
capDiscTop.rotation.x = -Math.PI / 2;
capDiscTop.position.y = -1.1 + 1.0;             // cylinder.position.y + halfHeight = top face
scene.add(capDiscTop);

// ─────────
//  Snow 
// ───────
const snowParams = {
  // Flakes
  amount:       450,
  sizeMin:      0.2,
  sizeMax:      1.5,
  color:        "#ffffff",
  opacityMin:   0.98,
  opacityMax:   1.7,
  // Physics
  gravity:      0.000004,
  damping:      0.9999,
  bounceEnergy: 0.09,
  // Drift
  speedMult:    0.39,
  oscillation:  0.000022,
  jitter:       0.001,
  // Spin
  turbStrength: 0.5,
  turbDecay:    0.522,
};

// ───────────────────────
//  Snow — geometry 
// ──────────────────────────
const MAX_SNOW    = 1000;
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
  uniforms: { snowColor: { value: new THREE.Color(snowParams.color) } },
  transparent: true,
  depthWrite:  false,
  blending:    THREE.NormalBlending,
});

scene.add(new THREE.Points(snowGeometry, snowMaterial));

// ──────────────────────────────
//  Snow — GUI helpers
// ─────────────────────────────
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

// ─────────────────────────────────
//  Scene colour controls
// ──────────────────────────────────────
/* const sceneColors = {
  sphere:     "#aa9900",
  mirror:     "#90d4fe",
  background: "#f1eafb",
  capTop:     "#E4d7F9",
};
const gui = new GUI({ title: "🎨  Colours", width: 260 });
gui.addColor(sceneColors, "sphere").name("Globe colour")
  .onChange(v => glassSphere.material.color.set(v));
gui.addColor(sceneColors, "mirror").name("Mirror colour")
  .onChange(v => groundMirror.material.uniforms.color.value.set(v));
gui.addColor(sceneColors, "capTop").name("Top cap")
  .onChange(v => capDiscTop.material.color.set(v));
gui.addColor(sceneColors, "background").name("Background")
  .onChange(v => scene.background.set(v));
 */
// ─────────────────────────────────────────────────────────────────────────────
//  Snow — GUI panel 
// ─────────────────────────────────────────────────────────────────────────────
// const gui = new GUI({ title: "❄️  Snow Controls", width: 310 });
//
// const fFlakes = gui.addFolder("❄️   Flakes");
// fFlakes.add(snowParams, "amount",     10, MAX_SNOW, 1   ).name("Amount").onChange(refreshSizes);
// fFlakes.add(snowParams, "sizeMin",   0.2, 10.0,     0.1 ).name("Size  min").onChange(refreshSizes);
// fFlakes.add(snowParams, "sizeMax",   0.5, 20.0,     0.1 ).name("Size  max").onChange(refreshSizes);
// fFlakes.addColor(snowParams, "color").name("Color")
//   .onChange(v => snowMaterial.uniforms.snowColor.value.set(v));
// fFlakes.add(snowParams, "opacityMin", 0.0, 3.0, 0.01).name("Opacity  min").onChange(refreshOpacities);
// fFlakes.add(snowParams, "opacityMax", 0.0, 3.0, 0.01).name("Opacity  max").onChange(refreshOpacities);
//
// const fPhysics = gui.addFolder("🌊   Physics");
// fPhysics.add(snowParams, "gravity",      0,    0.0002, 0.000001).name("Gravity");
// fPhysics.add(snowParams, "damping",      0.90, 0.9999, 0.0001  ).name("Damping");
// fPhysics.add(snowParams, "bounceEnergy", 0.0,  1.0,    0.01    ).name("Bounce energy");
//
// const fDrift = gui.addFolder("✨   Drift");
// fDrift.add(snowParams, "speedMult",   0.0, 5.0,    0.01    ).name("Speed ×");
// fDrift.add(snowParams, "oscillation", 0,   0.0005, 0.000001).name("Oscillation");
// fDrift.add(snowParams, "jitter",      0,   0.001,  0.000001).name("Jitter");
//
// const fSpin = gui.addFolder("🌀   Spin");
// fSpin.add(snowParams, "turbStrength", 0,   50,    0.5  ).name("Strength");
// fSpin.add(snowParams, "turbDecay",    0.5, 0.999, 0.001).name("Decay");
//
// gui.add({
//   log: () => {
//     const p = snowParams;
//     const out =
// `// ── Paste these into snowParams ─────────────────────────
//   amount:       ${p.amount},
//   sizeMin:      ${p.sizeMin},
//   sizeMax:      ${p.sizeMax},
//   color:        "${p.color}",
//   opacityMin:   ${p.opacityMin},
//   opacityMax:   ${p.opacityMax},
//   gravity:      ${p.gravity},
//   damping:      ${p.damping},
//   bounceEnergy: ${p.bounceEnergy},
//   speedMult:    ${p.speedMult},
//   oscillation:  ${p.oscillation},
//   jitter:       ${p.jitter},
//   turbStrength: ${p.turbStrength},
//   turbDecay:    ${p.turbDecay},`;
//     console.log(out);
//     if (navigator.clipboard) navigator.clipboard.writeText(out);
//   }
// }, "log").name("📋  Copy settings to clipboard");

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

const dudvMap = new THREE.TextureLoader().load(
  "https://pink-sunset.vercel.app/src/waterdudv.jpg"
);
dudvMap.wrapS = dudvMap.wrapT = THREE.RepeatWrapping;
mirrorShader.uniforms.tDudv = { value: dudvMap };
mirrorShader.uniforms.time  = { value: 0 };

const groundMirror = new Reflector(
  new THREE.CircleGeometry(3.843, 64),
  { shader: mirrorShader, clipBias: 0.000001,
    textureWidth: window.innerWidth, textureHeight: window.innerHeight,
    color: 0x90d4fe }
);
groundMirror.position.y = 0.49;
groundMirror.rotation.x = -Math.PI * 0.5;
scene.add(groundMirror);

// ─────────────────────────────────────────────────────────────────────────────
//  Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  mirrorShader.uniforms.time.value          += 0.503;
  groundMirror.material.uniforms.time.value += 0.0503;
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
  snowTurbulence.y += hMag * 0.18;
  snowTurbulence.multiplyScalar(snowParams.turbDecay);

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
    vel.x += snowTurbulence.x * sc;
    vel.y += snowTurbulence.y * sc;
    vel.z += snowTurbulence.z * sc;

    // Oscillation drift (unique phase per flake)
    const t = elapsedTime * 0.35 + snowPhases[i];
    vel.x += Math.sin(t * 0.9 + snowPhases[i] * 1.3) * snowParams.oscillation * sp;
    vel.z += Math.cos(t * 1.1 + snowPhases[i] * 0.7) * snowParams.oscillation * sp;

    // Brownian jitter — prevents convergence to the same attractor
    vel.x += (Math.random() - 0.5) * snowParams.jitter * sp;
    vel.z += (Math.random() - 0.5) * snowParams.jitter * sp;

    // Gravity
    vel.y -= snowParams.gravity;

    // Damping
    vel.multiplyScalar(snowParams.damping);

    let nx = px + vel.x;
    let ny = py + vel.y;
    let nz = pz + vel.z;

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
