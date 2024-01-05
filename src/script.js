import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
//import vertexShader from "./shaders/vertex.glsl";

console.log("22****update test2***");

// Start of the code
THREE.ColorManagement.enabled = false;

/**
 * Shaders
 */

// Vertex Shader
const vertexShader = `
uniform mat4 textureMatrix;
		varying vec4 vUv;

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>		

		}
`;

// Fragment Shader
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
       float waveSpeed = 0.035;
  
        vec2 distortedUv = texture2D( tDudv, vec2( vUv.x + time * waveSpeed, vUv.y ) ).rg * waveStrength;
        distortedUv = vUv.xy + vec2( distortedUv.x, distortedUv.y + time * waveSpeed );
        vec2 distortion = ( texture2D( tDudv, distortedUv ).rg * 2.0 - 1.0 ) * waveStrength;
  
        // new uv coords
  
        vec4 uv = vec4( vUv );
        uv.xy += distortion;

       vec4 base = texture2DProj( tDiffuse, uv );
       gl_FragColor = vec4( mix( base.rgb, color, 0.5 ), 1.0 );

       #include <tonemapping_fragment>
       

   }
`;

// Canvas
const canvas = document.querySelector("canvas.webgl");

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfbeaf7);
/**
 * Models
 */

// Instantiate a loader
const loader = new GLTFLoader();

// Optional: Provide a DRACOLoader instance to decode compressed mesh data
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");
loader.setDRACOLoader(dracoLoader);

let jokulModel;
// Load a glTF resource
loader.load(
  "models/mountains7.glb",
  function (gltf) {
    jokulModel = gltf.scene;

    scene.add(jokulModel);

    gltf.animations;
    gltf.scene;
    gltf.scenes;
    gltf.cameras;
    gltf.asset;
  },
  function (xhr) {
    console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
  },
  function (error) {
    console.log("An error happened");
  }
);

/**
 * Lights
 */
const ambientLight = new THREE.AmbientLight(0xfeffff, 0.9);
scene.add(ambientLight);

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
pointLight.position.x = 0;
pointLight.position.y = 40;
pointLight.position.z = 2;
scene.add(pointLight);

/**
 * Sizes
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

window.addEventListener("resize", () => {
  // Update sizes
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  // Update camera
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  // Update renderer
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(
  63,
  sizes.width / sizes.height,
  0.1,
  100
);
//camera.position.set(5.2, 1.7, 4.6);
//camera.position.set(5.2, 10.7, 14.6);
camera.position.set(10.2, 10.5, -10.6);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.75, 0);
controls.enableDamping = true;
controls.enableZoom = false;
controls.rotateSpeed = 0.3;

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
});
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

/**
 * Texture
 */

const mirrorShader = Reflector.ReflectorShader;
mirrorShader.vertexShader = vertexShader;
mirrorShader.fragmentShader = fragmentShader;

const dudvMap = new THREE.TextureLoader().load(
  "public/static/images/waterdudv.jpg",
  function () {
    //tick();
  }
);

mirrorShader.uniforms.tDudv = { value: dudvMap };
mirrorShader.uniforms.time = { value: 0 };

console.log(mirrorShader.uniforms.tDudv.value);
console.log(mirrorShader.uniforms.time.value);

dudvMap.wrapS = dudvMap.wrapT = THREE.RepeatWrapping;

let groundMirror, mirrorOptions;

const planeGeometry2 = new THREE.CircleGeometry(3.843, 64);
mirrorOptions = {
  shader: mirrorShader,
  clipBias: 0.000001,
  textureWidth: window.innerWidth,
  textureHeight: window.innerHeight,
  color: 0x77c0ec,
  //textureWidth: window.innerWidth * window.devicePixelRatio,
  //textureHeight: window.innerHeight * window.devicePixelRatio,
};

groundMirror = new Reflector(planeGeometry2, mirrorOptions);
groundMirror.position.y = 0.49;
groundMirror.rotation.x = -Math.PI * 0.5;
scene.add(groundMirror);
/**
 * Animate
 */
const clock = new THREE.Clock();
let previousTime = 0;

const tick = () => {
  const elapsedTime = clock.getElapsedTime();
  const deltaTime = elapsedTime - previousTime;
  previousTime = elapsedTime;
  mirrorShader.uniforms.time.value += 0.503;
  groundMirror.material.uniforms.time.value += 0.0503;
  // Update controls
  controls.update();

  // Render
  renderer.render(scene, camera);

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
};

tick();
