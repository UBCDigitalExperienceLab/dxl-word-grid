import { defineConfig } from "vite";

// `public/.nojekyll` is copied to the dist root automatically by Vite, which
// stops GitHub Pages from running the output through Jekyll.
// `dist/404.html` is produced after the build by scripts/postbuild.mjs, because
// it has to be a copy of the *built* index.html (hashed asset URLs and all).
export default defineConfig({
  // Set at build time. GitHub Pages project sites live under /<repo>/.
  base: process.env.BASE_PATH || "/",
  server: {
    port: 5173,
  },
});
