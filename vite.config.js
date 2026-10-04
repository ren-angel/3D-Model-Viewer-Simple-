import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// Gives the viewer the list of files in public/assets/ (and its subfolders) so it
// can find models and match textures by name whatever their extension is.
function assetList() {
  const id = 'virtual:asset-list';
  const resolved = `\0${id}`;
  const dir = path.resolve(process.cwd(), 'public/assets');
  return {
    name: 'asset-list',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return undefined;
      // Relative paths with "/" separators, including files in subfolders (one folder per model).
      const files = fs.existsSync(dir)
        ? fs
            .readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((d) => d.isFile() && !d.name.startsWith('.'))
            .map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name)).split(path.sep).join('/'))
        : [];
      return `export default ${JSON.stringify(files)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const reload = (file) => {
        if (!path.resolve(file).startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

export default defineConfig({
  // Relative base so the site works at https://<user>.github.io/<repo>/
  // without having to hardcode the repository name.
  base: './',
  plugins: [assetList()],
  build: {
    target: 'es2020',
    // Keep built JS/CSS out of assets/, which is reserved for your model files.
    assetsDir: 'static',
    chunkSizeWarningLimit: 1000,
  },
});