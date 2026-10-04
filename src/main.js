import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { assetUrl, createTextureSupport, findAsset, splitName } from './textures.js';

// Everything in public/assets/ is copied as-is to the built site.
const ASSETS = `${import.meta.env.BASE_URL}assets/`;

const DEFAULTS = {
  version: '',
  autoRotate: true,
  playAnimation: true,
  background: '',
};

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'),
  tabs: $('tabs'),
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
controls.zoomSpeed = 1.3;
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
let tween = null; // camera fly-to animation
let bounds = null; // the view's focus point can't leave the model's neighbourhood
let modelRoot = null; // the model on screen

controls.addEventListener('change', () => {
  dirty = true;
  if (!bounds) return;
  // Panning over empty background would otherwise drift away from the model.
  const clamped = controls.target.clone().clamp(bounds.min, bounds.max);
  if (!clamped.equals(controls.target)) {
    clamped.sub(controls.target);
    controls.target.add(clamped);
    camera.position.add(clamped);
  }
});

renderer.setAnimationLoop((now) => {
  timer.update();
  const dt = timer.getDelta();
  if (tween) stepTween(now);
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

/** Centres the model, stands it on the floor and returns its measurements. Run once per model. */
function placeModel(object) {
  let box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.position.y += center.y - box.min.y;
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  return {
    box,
    radius: Math.max(size.length() / 2, 1e-3),
    target: new THREE.Vector3(0, size.y / 2, 0),
  };
}

/** Sets up camera limits, lights and shadow for a model. */
function applyFraming({ box, radius, target }) {
  // Fit the bounding sphere in whichever field of view is narrower (portrait phones).
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;

  const direction = new THREE.Vector3(0.9, 0.45, 1.4).normalize();
  home = {
    position: target.clone().addScaledVector(direction, distance),
    target: target.clone(),
  };

  camera.near = radius * 0.004; // close enough to zoom right up to small details
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.01;
  controls.maxDistance = distance * 6;

  bounds = box.clone().expandByScalar(radius * 0.15);

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
}

function flyTo(position, target) {
  if (reducedMotion) {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    dirty = true;
    return;
  }
  tween = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: position.clone(),
    toTarget: target.clone(),
    start: null,
  };
}

function stepTween(now) {
  const t = tween;
  t.start ??= now;
  const k = Math.min((now - t.start) / 450, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // ease in-out
  camera.position.lerpVectors(t.fromPos, t.toPos, e);
  controls.target.lerpVectors(t.fromTarget, t.toTarget, e);
  controls.update();
  dirty = true;
  if (k === 1) tween = null;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** Fly the camera in to the spot of the model under the screen position. */
function focusAt(clientX, clientY) {
  if (!modelRoot) return false;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(modelRoot, true)[0];
  if (!hit) return false;
  const point = hit.point;
  const away = camera.position.clone().sub(point);
  const distance = Math.max(away.length() * 0.4, controls.minDistance * 4);
  flyTo(point.clone().add(away.setLength(distance)), point);
  return true;
}

function resetView() {
  tween = null;
  if (!home) return;
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  controls.update();
  dirty = true;
}

/* ---------- Loading one model ---------- */

let bust = '';

function formatMB(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const joinPath = (folder, name) => (folder ? `${folder}/${name}` : name);

/** Loads an OBJ and the material file (.mtl) it refers to. */
async function loadObj(manager, entry, url, onBytes, missing) {
  const text = await new THREE.FileLoader(manager).loadAsync(url, onBytes);

  // An OBJ names its material file on a "mtllib" line; viewer.json can override it with "mtl".
  const mtlNames = entry.mtl
    ? [entry.mtl]
    : [...text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]);

  let materials = null;
  for (const name of mtlNames) {
    const path = findAsset(entry.folder, name);
    if (!path) {
      missing.add(name.split(/[\\/]/).pop());
      continue;
    }
    materials = await new MTLLoader(manager).loadAsync(assetUrl(ASSETS, path) + bust);
    materials.preload();
    break; // three.js uses one material file per OBJ
  }

  const loader = new OBJLoader(manager);
  if (materials) loader.setMaterials(materials);
  const object = loader.parse(text);

  object.traverse((child) => {
    if (!child.isMesh) return;
    // OBJs without normals would render faceted and black-ish.
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
      // Some exporters write a black base colour next to a texture, which would hide the texture.
      if (m.map && m.color?.getHex() === 0x000000) m.color.set(0xffffff);
    }
  });
  return object;
}

/**
 * Loads one model and all its textures, with its own loading manager so two
 * models can load at the same time without mixing up their files.
 */
async function loadModel(entry, report) {
  const manager = new THREE.LoadingManager();
  const { missing } = createTextureSupport(manager, { assetsBase: ASSETS, folder: entry.folder, bust });

  let busy = false;
  let lastLoaded = 0;
  let textureBase = null; // files already done when textures started
  const idleWaiters = [];
  manager.onStart = () => (busy = true);
  manager.onLoad = () => {
    busy = false;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  };
  manager.onProgress = (_url, loaded, total) => {
    lastLoaded = loaded;
    if (textureBase != null && total > textureBase) {
      const done = loaded - textureBase;
      const all = total - textureBase;
      report(done / all, `Loading textures ${done} of ${all}`);
    }
  };

  const path = findAsset(entry.folder, entry.file) ?? joinPath(entry.folder, entry.file);
  const url = assetUrl(ASSETS, path) + bust;
  const onBytes = (e) => {
    if (e.lengthComputable) report(e.loaded / e.total, `Loading model ${formatMB(e.loaded)} of ${formatMB(e.total)}`);
    else report(null, `Loading model ${formatMB(e.loaded)}`);
  };

  const { ext } = splitName(entry.file);
  let object;
  if (ext === 'fbx') object = await new FBXLoader(manager).loadAsync(url, onBytes);
  else if (ext === 'obj') object = await loadObj(manager, entry, url, onBytes, missing);
  else throw Object.assign(new Error('unsupported'), { unsupported: true });

  textureBase = lastLoaded;
  report(null, 'Loading textures');
  if (busy) await new Promise((resolve) => idleWaiters.push(resolve));

  return { object, missing };
}

function prepareMaterials(object, alphaModes) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.frustumCulled = !child.isSkinnedMesh; // skinned meshes can be culled wrongly while animating
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of materials) {
      // A texture that couldn't be loaded would draw as solid black; show the plain material colour instead.
      for (const slot of ['map', 'normalMap', 'specularMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'aoMap']) {
        if (m[slot]?.userData.failed) {
          m[slot] = null;
          m.needsUpdate = true;
        }
      }
      if (m.map) m.map.anisotropy = maxAniso;

      // Transparency stored in a texture's alpha channel (hair strands, eyelashes).
      // Only applied to the textures named in viewer.json, because in other textures
      // the alpha channel is a colour mask and cutting it would punch holes.
      const mode = m.map && alphaModes[m.map.userData.stem];
      if (mode === 'cutout') {
        m.alphaTest = 0.5;
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
      } else if (mode === 'blend') {
        m.transparent = true;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
    }
  });
}

/* ---------- Models and tabs ---------- */

/** @type {Array<{entry, slug, alpha, playAnimation, status, progress, object, framing, mixer, missing, error, view, noticeDismissed, tab}>} */
let models = [];
let current = null;
let hintShown = false;

const slugify = (text) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'model';

const normalizeAlpha = (alpha) =>
  Object.fromEntries(
    Object.entries(alpha ?? {}).map(([name, mode]) => [String(name).replace(/\.[^.]+$/, '').toLowerCase(), mode]),
  );

async function loadConfig() {
  let raw = {};
  try {
    const res = await fetch(`${ASSETS}viewer.json`, { cache: 'no-cache' });
    if (res.ok) raw = await res.json();
  } catch {
    /* use defaults */
  }
  const config = { ...DEFAULTS, ...raw };
  // Older single-model format: { "title": ..., "model": "x.fbx" }
  config.models =
    Array.isArray(raw.models) && raw.models.length
      ? raw.models
      : [{ title: raw.title, description: raw.description, file: raw.model ?? 'model.fbx', alpha: raw.alpha }];
  return config;
}

function setProgress(fraction, text) {
  ui.loader.classList.toggle('is-indeterminate', fraction == null);
  if (fraction != null) ui.barFill.style.width = `${Math.round(fraction * 100)}%`;
  if (text) ui.loaderText.textContent = text;
}

function showLoader(model) {
  ui.loader.classList.remove('is-done', 'is-error');
  ui.barFill.style.width = '0';
  setProgress(model.progress?.fraction ?? null, model.progress?.text ?? 'Loading model');
}

function showError(message) {
  ui.loader.classList.remove('is-done', 'is-indeterminate');
  ui.loader.classList.add('is-error');
  ui.loaderText.textContent = message;
}

function folderLabel(entry) {
  return `public/assets/${entry.folder ? `${entry.folder}/` : ''}`;
}

async function load(model) {
  model.status = 'loading';
  try {
    const { object, missing } = await loadModel(model.entry, (fraction, text) => {
      model.progress = { fraction, text };
      if (current === model) setProgress(fraction, text);
    });
    prepareMaterials(object, model.alpha);
    object.visible = false;
    scene.add(object);
    model.framing = placeModel(object);
    if (object.animations?.length && model.playAnimation) {
      model.mixer = new THREE.AnimationMixer(object);
      model.mixer.clipAction(object.animations[0]).play();
    }
    model.object = object;
    model.missing = missing;
    model.status = 'ready';
  } catch (err) {
    console.error(err);
    model.status = 'error';
    const { file } = model.entry;
    model.error = err.unsupported
      ? `"${file}" isn't a supported format. Use an .fbx or .obj file.`
      : `Couldn't load "${file}". Check that the file is in ${folderLabel(model.entry)} and that its name in viewer.json matches.`;
  }
  if (current === model) show(model);
}

/** Puts a model on screen, or its loading/error state. */
function show(model) {
  // Leave the other models loaded but hidden, so switching back is instant.
  for (const m of models) if (m !== model && m.object) m.object.visible = false;

  ui.title.textContent = model.entry.title;
  ui.subtitle.textContent = model.entry.description;
  ui.subtitle.hidden = !model.entry.description;
  document.title = model.entry.title || '3D model viewer';
  ui.notice.hidden = true;

  if (model.status !== 'ready') {
    modelRoot = null;
    mixer = null;
    bounds = null;
    ui.btnAnim.hidden = true;
    if (model.status === 'error') showError(model.error);
    else showLoader(model);
    return;
  }

  model.object.visible = true;
  modelRoot = model.object;
  mixer = model.mixer;
  ui.btnAnim.hidden = !mixer;
  applyFraming(model.framing);
  if (model.view) {
    tween = null;
    camera.position.copy(model.view.position);
    controls.target.copy(model.view.target);
    controls.update();
  } else {
    resetView();
  }

  ui.loader.classList.add('is-done');
  ui.loader.classList.remove('is-error');
  ui.toolbar.hidden = false;

  if (model.missing.size && !model.noticeDismissed) {
    const list = [...model.missing].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ');
    ui.noticeText.textContent = `Missing files: ${list}. Add files with these names (.tga, .png or .jpg for textures) to ${folderLabel(model.entry)}.`;
    ui.notice.hidden = false;
    ui.hint.hidden = true;
  } else if (!hintShown) {
    showHint();
  }
  dirty = true;
}

function select(index, { updateUrl = true } = {}) {
  const model = models[index];
  if (!model || model === current) return;

  // Remember where the camera was, so coming back to this model keeps the view.
  if (current?.status === 'ready') {
    current.view = { position: camera.position.clone(), target: controls.target.clone() };
  }
  current = model;

  models.forEach((m, i) => {
    if (!m.tab) return;
    const selected = i === index;
    m.tab.setAttribute('aria-selected', String(selected));
    m.tab.tabIndex = selected ? 0 : -1;
  });
  if (updateUrl && models.length > 1) history.replaceState(null, '', `#${model.slug}`);

  // Models load the first time they're opened, so the page starts fast.
  if (model.status === 'idle') load(model);
  show(model);
}

function buildTabs() {
  if (models.length < 2) return;
  document.body.classList.add('has-tabs');
  ui.tabs.hidden = false;
  models.forEach((model, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    tab.textContent = model.entry.title;
    tab.title = model.entry.title;
    tab.addEventListener('click', () => select(i));
    ui.tabs.append(tab);
    model.tab = tab;
  });

  // Arrow keys move between tabs.
  ui.tabs.addEventListener('keydown', (e) => {
    const i = models.indexOf(current);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    let next = step ? (i + step + models.length) % models.length : null;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = models.length - 1;
    if (next == null) return;
    e.preventDefault();
    select(next);
    models[next].tab.focus();
  });
}

function modelFromUrl() {
  const slug = decodeURIComponent(location.hash.slice(1));
  const i = models.findIndex((m) => m.slug === slug);
  return i === -1 ? 0 : i;
}

async function start() {
  const config = await loadConfig();

  if (config.background) document.body.style.background = config.background;
  bust = config.version ? `?v=${encodeURIComponent(config.version)}` : '';
  controls.autoRotate = config.autoRotate && !reducedMotion;
  ui.btnRotate.setAttribute('aria-pressed', String(controls.autoRotate));

  const used = new Set();
  models = config.models.map((e, i) => {
    const title = e.title || `Model ${i + 1}`;
    let slug = slugify(title);
    if (used.has(slug)) slug = `${slug}-${i + 1}`;
    used.add(slug);
    return {
      entry: {
        title,
        description: e.description || '',
        file: e.file ?? e.model ?? 'model.fbx',
        folder: String(e.folder ?? '').replace(/^\/+|\/+$/g, ''),
        mtl: e.mtl,
      },
      slug,
      alpha: normalizeAlpha(e.alpha),
      playAnimation: e.playAnimation ?? config.playAnimation,
      status: 'idle',
    };
  });

  buildTabs();
  select(modelFromUrl(), { updateUrl: false });
  window.addEventListener('hashchange', () => select(modelFromUrl(), { updateUrl: false }));
}

/* ---------- UI ---------- */

function showHint() {
  hintShown = true;
  ui.hint.textContent = coarsePointer
    ? 'Drag to rotate, pinch to zoom, double-tap to focus'
    : 'Drag to rotate, scroll to zoom, double-click to focus';
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

ui.noticeClose.addEventListener('click', () => {
  ui.notice.hidden = true;
  if (current) current.noticeDismissed = true;
});

// Double-click or double-tap: focus on that part of the model, or reset the view if you tap the background.
// (Detected from pointer events because phones don't reliably send "dblclick".)
let down = null;
let lastTap = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  tween = null; // dragging cancels a fly-to in progress
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const isTap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && e.timeStamp - down.t < 350;
  down = null;
  if (!isTap) return;
  if (lastTap && e.timeStamp - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    if (!focusAt(e.clientX, e.clientY)) resetView();
  } else {
    lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  }
});

start();