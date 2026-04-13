import { defineConfig } from 'vite';

// VITE_ASSET_BASE_URL and VITE_COLYSEUS_URL are loaded from .env.development /
// .env.production automatically. They are exposed to client code as
// import.meta.env.VITE_ASSET_BASE_URL and import.meta.env.VITE_COLYSEUS_URL.
export default defineConfig({
  server: {
    port: 5173,
    // Allow Vite to serve files from the monorepo root so client scenes can
    // import from shared/ via relative paths (e.g. '../../../shared/data/...').
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
