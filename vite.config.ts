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
      },
    },
  },
}));
