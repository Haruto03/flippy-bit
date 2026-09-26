import pluginChecker from "vite-plugin-checker";
import { defineConfig } from "vite";

export default defineConfig({
    // Relative asset paths, so the build works when served from a
    // sub-path such as GitHub Pages (https://<user>.github.io/flippy-bit/)
    base: "./",
    plugins: [pluginChecker({ typescript: true, overlay: false })],
});
