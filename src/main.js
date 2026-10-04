import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createTextureSupport, missing } from './textures.js';

// Everything in public/assets/ is copied as-is to the built site.
const ASSETS = `${import.meta.env.BASE_URL}assets/`;

const DEFAULTS = {
  title: '',
  description: '',
  model: 'model.fbx',
  version: '',
  autoRotate: true,
  playAnimation: true,
  background: '',
};

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'),
  title: $('title'),
  subtitle: $('subtitle'),
  loader: $('loader'),
  barFill: $('bar-fill'),
  loaderText: $('loader-text'),
  hint: $('hint'),
  notice: $('notice'),
  noticeText: $('notice-text'),
  noticeClose: $('notice-close'),
  toolbar: document.querySelector('.toolbar'),
  btnReset: $('btn-reset'),
  btnRotate: $('btn-rotate'),
  btnAnim: $('btn-anim'),
  btnFull: $('btn-full'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

/* ---------- Renderer, scene, camera ---------- */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true, // let the CSS studio backdrop show through
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap for phone performance
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
ui.stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.autoRotateSpeed = 1.2;

// Soft studio lighting: sky/ground fill, a shadow-casting key, and a rim from behind.
scene.add(new THREE.HemisphereLight(0xffffff, 0x7d838a, 1.7));

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0005;
scene.add(key, key.target);

const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
scene.add(rim);

// Invisible floor that only shows the model's shadow.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShadowMaterial({ opacity: 0.16 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- Render loop (renders only when something changes) ---------- */

const timer = new THREE.Timer();
timer.connect(document); // pauses timing while the tab is hidden
let mixer = null;
let animPaused = false;
let dirty = true;
let home = null;

controls.addEventListener('change', () => (dirty = true));

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  let changed = controls.update(dt);
  if (mixer && !animPaused) {
    mixer.update(dt);
    changed = true;
  }
  if (changed || dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = ui.stage;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(ui.stage);
resize();

/* ---------- Framing ---------- */

function frameModel(object) {
  // Centre the model and stand it on the floor.
  let box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.position.y += center.y - box.min.y;
  box = new THREE.Box3().setFromObject(object);

  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1e-3);
  const target = new THREE.Vector3(0, size.y / 2, 0);

  // Fit the bounding sphere in whichever field of view is narrower (portrait phones).
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;

  const direction = new THREE.Vector3(0.9, 0.45, 1.4).normalize();
  home = {
    position: target.clone().addScaledVector(direction, distance),
    target,
  };

  camera.near = distance / 200;
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.15;
  controls.maxDistance = distance * 6;

  ground.scale.setScalar(radius * 10);

  key.position.set(radius * 2, radius * 3.5, radius * 2.5).add(target);
  key.target.position.copy(target);
  const s = key.shadow.camera;
  s.left = s.bottom = -radius * 1.4;
  s.right = s.top = radius * 1.4;
  s.near = radius * 0.1;
  s.far = radius * 10;
  s.updateProjectionMatrix();
  key.shadow.normalBias = radius * 0.004;

  rim.position.set(-radius * 2.5, radius * 2, -radius * 3).add(target);

  resetView();
}

function resetView() {
  if (!home) return;
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  controls.update();
  dirty = true;
}

/* ---------- Loading ---------- */

let bust = '';

const manager = new THREE.LoadingManager();
createTextureSupport(manager, { assetsBase: ASSETS, bust: () => bust });

function setProgress(fraction, text) {
  ui.loader.classList.toggle('is-indeterminate', fraction == null);
  if (fraction != null) ui.barFill.style.width = `${Math.round(fraction * 100)}%`;
  if (text) ui.loaderText.textContent = text;
}

function formatMB(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function loadConfig() {
  try {
    const res = await fetch(`${ASSETS}viewer.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return { ...DEFAULTS, ...(await res.json()) };
  } catch {
    return DEFAULTS;
  }
}

// The manager is "busy" from the first file request until every file
// (model + textures, including failed ones) has finished.
let busy = false;
const idleWaiters = [];
manager.onStart = () => (busy = true);
manager.onLoad = () => {
  busy = false;
  idleWaiters.splice(0).forEach((resolve) => resolve());
};
manager.onProgress = (_url, loaded, total) => {
  // `total` includes the FBX itself, which is already done at this stage.
  if (ui.loader.dataset.phase === 'textures' && total > 1) {
    setProgress((loaded - 1) / (total - 1), `Loading textures ${loaded - 1} of ${total - 1}`);
  }
};

function waitForTextures() {
  return busy ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
}

function prepareMaterials(object) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.frustumCulled = !child.isSkinnedMesh; // skinned meshes can be culled wrongly while animating
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of materials) {
      // A texture that couldn't be loaded would draw as solid black; show the plain material colour instead.
      for (const key of ['map', 'normalMap', 'specularMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'aoMap']) {
        if (m[key]?.userData.failed) {
          m[key] = null;
          m.needsUpdate = true;
        }
      }
      if (m.map) m.map.anisotropy = maxAniso;
    }
  });
}

function showError(message) {
  ui.loader.classList.remove('is-indeterminate');
  ui.loader.classList.add('is-error');
  ui.loaderText.textContent = message;
}

async function start() {
  const config = await loadConfig();

  document.title = config.title || '3D model viewer';
  ui.title.textContent = config.title;
  if (config.description) {
    ui.subtitle.textContent = config.description;
    ui.subtitle.hidden = false;
  }
  if (config.background) {
    document.body.style.background = config.background;
  }
  bust = config.version ? `?v=${encodeURIComponent(config.version)}` : '';

  ui.loader.dataset.phase = 'model';
  setProgress(null, 'Loading model');

  const loader = new FBXLoader(manager);
  let object;
  try {
    object = await loader.loadAsync(`${ASSETS}${encodeURIComponent(config.model)}${bust}`, (e) => {
      if (e.lengthComputable) {
        setProgress(e.loaded / e.total, `Loading model ${formatMB(e.loaded)} of ${formatMB(e.total)}`);
      } else {
        setProgress(null, `Loading model ${formatMB(e.loaded)}`);
      }
    });
  } catch (err) {
    console.error(err);
    showError(
      `Couldn't load "${config.model}". Check that the file is in public/assets/ and that its name in viewer.json matches exactly, including upper and lower case.`,
    );
    return;
  }

  ui.loader.dataset.phase = 'textures';
  setProgress(null, 'Loading textures');
  await waitForTextures();

  prepareMaterials(object);
  scene.add(object);
  frameModel(object);

  if (object.animations.length && config.playAnimation) {
    mixer = new THREE.AnimationMixer(object);
    mixer.clipAction(object.animations[0]).play();
    ui.btnAnim.hidden = false;
  }

  controls.autoRotate = config.autoRotate && !reducedMotion;
  ui.btnRotate.setAttribute('aria-pressed', String(controls.autoRotate));

  ui.loader.classList.add('is-done');
  ui.toolbar.hidden = false;
  showHint();

  if (missing.size) {
    const list = [...missing].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ');
    ui.noticeText.textContent = `Missing textures: ${list}. Add files with these names (.tga, .png or .jpg) to public/assets/.`;
    ui.notice.hidden = false;
    ui.hint.hidden = true;
  }
  dirty = true;
}

/* ---------- UI ---------- */

function showHint() {
  ui.hint.textContent = coarsePointer
    ? 'Drag to rotate, pinch to zoom, two fingers to move'
    : 'Drag to rotate, scroll to zoom, right-drag to move';
  ui.hint.hidden = false;
  const hide = () => ui.hint.classList.add('is-gone');
  controls.addEventListener('start', hide, { once: true });
  setTimeout(hide, 6000);
}

ui.btnReset.addEventListener('click', resetView);

ui.btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  ui.btnRotate.setAttribute('aria-pressed', String(controls.autoRotate));
});

ui.btnAnim.addEventListener('click', () => {
  animPaused = !animPaused;
  ui.btnAnim.classList.toggle('is-paused', animPaused);
  const label = animPaused ? 'Play animation' : 'Pause animation';
  ui.btnAnim.setAttribute('aria-label', label);
  ui.btnAnim.title = label;
  timer.update(); // avoid a jump when resuming
});

// iPhone Safari doesn't support fullscreen for pages, so the button only shows where it works.
if (document.fullscreenEnabled) {
  ui.btnFull.hidden = false;
  ui.btnFull.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
}

ui.noticeClose.addEventListener('click', () => (ui.notice.hidden = true));

// Double-click / double-tap to go back to the starting view.
renderer.domElement.addEventListener('dblclick', resetView);

start();