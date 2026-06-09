import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ jsxImportSource: 'react' })],
  root: ".",
  base: "/modeler/",
  // form-js-editor pins preact <=10.15.1, our root has a newer preact, and
  // npm ends up installing two copies. Two preact instances mean two hook
  // registries — the editor's internal renderer schedules setState against
  // a registry the React tree never reads, so the canvas stays blank and
  // PropertiesPanelRenderer.attachTo trips on a null ref. Dedupe forces
  // Vite to bind every "preact" import in the bundle to a single module.
  resolve: {
    dedupe: ["preact", "preact/hooks", "preact/jsx-runtime"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/definitions": "http://localhost:3000",
      "/instances": "http://localhost:3000",
      "/incidents": "http://localhost:3000",
      "/user-tasks": "http://localhost:3000",
      "/forms": "http://localhost:3000",
      "/browse": "http://localhost:3000",
      "/folders": "http://localhost:3000",
      "/projects": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  // SPA fallback: serve index.html for all /modeler/* routes
  appType: "spa",
});
