import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
	return {
		plugins: [
			// WASM/Top-level await：用于 CanvasKit 与 react-skia-lite
			wasm(),
			topLevelAwait(),
			tsconfigPaths(),
			tailwindcss(),
			react(),
		],
		resolve: {
			alias: {
				// react-skia-lite 目前 dist 不完整，desktop 先始终走源码
				"react-skia-lite": path.resolve(__dirname, "../react-skia-lite/src"),
			},
		},
		server: {
			port: 3001,
		},
		optimizeDeps: {
			esbuildOptions: {
				target: "esnext",
			},
		},
		assetsInclude: ["**/*.wasm"],
		build: {
			outDir: "dist/renderer",
			emptyOutDir: true,
			commonjsOptions: {
				include: [/node_modules/, /events/, /canvaskit-wasm/],
				transformMixedEsModules: true,
			},
		},
	};
});
