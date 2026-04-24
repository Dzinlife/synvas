import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
	return {
		plugins: [
			// CanvasKit WebGPU bundle 仍包含 top-level await。
			topLevelAwait(),
			tailwindcss(),
			react(),
		],
		resolve: {
			tsconfigPaths: true,
			alias: {
				// react-skia-lite 目前 dist 不完整，desktop 先始终走源码
				"react-skia-lite": path.resolve(__dirname, "../react-skia-lite/src"),
			},
		},
		server: {
			port: 3001,
		},
		build: {
			outDir: "dist/renderer",
			emptyOutDir: true,
		},
	};
});
