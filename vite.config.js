import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the site works at https://<user>.github.io/<repo>/
  // without having to hardcode the repository name.
  base: './',
  build: {
    target: 'es2020',
    // Keep built JS/CSS out of assets/, which is reserved for your model files.
    assetsDir: 'static',
    chunkSizeWarningLimit: 1000,
  },
});
