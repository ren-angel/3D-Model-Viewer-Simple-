import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
// File names found in public/assets/ when the site was built (see vite.config.js).
import assetFiles from 'virtual:asset-list';

const IMAGE_EXTS = ['jpg', 'jpeg', 'webp', 'png', 'tga', 'bmp', 'gif']; // order = preference
const splitName = (name) => {
  const m = /^(.*)\.([^.]+)$/.exec(name);
  return m ? { stem: m[1], ext: m[2].toLowerCase() } : { stem: name, ext: '' };
};

const byStem = new Map();
for (const name of assetFiles) {
  const { stem, ext } = splitName(name);
  if (!IMAGE_EXTS.includes(ext)) continue;
  const key = stem.toLowerCase();
  if (!byStem.has(key)) byStem.set(key, []);
  byStem.get(key).push({ name, ext });
}

/** Stems (e.g. "14") the model asked for that aren't in assets/. */
export const missing = new Set();

/**
 * The FBX stores texture paths from the artist's computer, often with an
 * extension that doesn't match what you upload (Noesis writes ".dds").
 * So: ignore the folders, match by file name without extension, ignore
 * upper/lower case, and use whichever of tga/png/jpg/webp exists.
 */
export function createTextureSupport(manager, { assetsBase, bust }) {
  function resolve(url) {
    let base = url.split('?')[0].split(/[\\/]/).pop();
    try {
      base = decodeURIComponent(base);
    } catch {
      /* keep as is */
    }
    const { stem, ext } = splitName(base);
    const options = byStem.get(stem.toLowerCase());
    if (!options) return { stem, found: null };
    const pick = options.find((o) => o.ext === ext) ?? [...options].sort(
      (a, b) => IMAGE_EXTS.indexOf(a.ext) - IMAGE_EXTS.indexOf(b.ext),
    )[0];
    return {
      stem,
      found: { ext: pick.ext, url: `${assetsBase}${encodeURIComponent(pick.name)}${bust()}` },
    };
  }

  // Keeps requests for already-resolved URLs pointing at the right file.
  manager.setURLModifier((url) => {
    if (/^(blob|data):/.test(url)) return url;
    const base = url.split('?')[0].split(/[\\/]/).pop();
    if (!IMAGE_EXTS.includes(splitName(base).ext) && !base.toLowerCase().endsWith('.dds')) return url;
    return resolve(url).found?.url ?? url;
  });

  const tga = new TGALoader(manager);
  const image = new THREE.TextureLoader(manager);
  const cache = new Map(); // file url -> { master, done, failed, waiting[] }

  const share = (t, m) => {
    // Textures that use the same file share one decoded image and one GPU upload.
    t.source = m.source;
    t.format = m.format;
    t.type = m.type;
    t.internalFormat = m.internalFormat;
    t.generateMipmaps = m.generateMipmaps;
    t.minFilter = m.minFilter;
    t.magFilter = m.magFilter;
    t.flipY = m.flipY;
    t.unpackAlignment = m.unpackAlignment;
    t.needsUpdate = true;
  };

  const fail = (stem) => {
    missing.add(stem);
    const t = new THREE.Texture();
    t.userData.failed = true;
    return t;
  };

  // An FBX with 66 materials can point at the same 16 MB texture 36 times.
  // Without this, every one of those would be downloaded, decoded and uploaded separately.
  class SmartTextureLoader extends THREE.Loader {
    constructor(embeddedLoader) {
      super(manager);
      this.embeddedLoader = embeddedLoader;
    }

    load(url, onLoad) {
      if (/^(blob|data):/.test(url)) return this.embeddedLoader.load(url, onLoad);

      const { stem, found } = resolve(url);
      if (!found) return fail(stem);

      let entry = cache.get(found.url);
      if (!entry) {
        entry = { done: false, failed: false, waiting: [] };
        cache.set(found.url, entry);
        const e = entry;
        const loader = found.ext === 'tga' ? tga : image;
        e.master = loader.load(
          found.url,
          () => {
            e.done = true;
            e.waiting.forEach((t) => share(t, e.master));
            e.waiting.length = 0;
            if (onLoad) onLoad(e.master);
          },
          undefined,
          (err) => {
            e.failed = true;
            e.master.userData.failed = true;
            e.waiting.forEach((t) => (t.userData.failed = true));
            missing.add(stem);
            console.warn(`Couldn't load texture ${found.url}`, err);
          },
        );
        return e.master;
      }

      const t = entry.master.isDataTexture ? new THREE.DataTexture() : new THREE.Texture();
      if (entry.failed) t.userData.failed = true;
      else if (entry.done) share(t, entry.master);
      else entry.waiting.push(t);
      return t;
    }
  }

  manager.addHandler(/\.tga$/i, new SmartTextureLoader(tga));
  manager.addHandler(/\.(dds|png|jpe?g|webp|bmp|gif)$/i, new SmartTextureLoader(image));
}
