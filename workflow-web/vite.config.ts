import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/modeler/",
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
