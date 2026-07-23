import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  server: { port: 5173 },
  // Keep development readable. These transforms are deliberately restricted
  // to production builds so debugging the renderer and imported assets stays
  // practical locally.
  esbuild: command === "build"
    ? {
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      legalComments: "none",
      drop: ["debugger"],
      pure: ["console.debug"],
    }
    : undefined,
  build: {
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[hash].js",
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[hash][extname]",
        manualChunks(id) {
          // Three.js changes independently from the recovered game runtime.
          // Keeping it in a stable vendor chunk improves repeat-visit caching
          // and makes the application budget visible instead of hiding both
          // behind one near-megabyte entry file.
          if (id.includes("/node_modules/three/")) return "vendor-three";
          return undefined;
        },
      },
    },
  },
}));
