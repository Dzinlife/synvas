import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import viteTsConfigPaths from "vite-tsconfig-paths";

// import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode }) => {
	const isDev = command === "serve" || mode === "development";

	return {
		plugins: [
			// WASM 支持插件必须在最前面（用于 canvaskit-wasm）
			wasm(),
			topLevelAwait(),
			// canvaskit ESM 插件必须在最前面
			// nodePolyfills({
			//   include: ['events'],
			//   globals: {
			//     global: true,
			//     process: true,
			//   },
			// }),
			devtools(),
			cloudflare({ viteEnvironment: { name: "ssr" } }),
			// this is the plugin that enables path aliases
			viteTsConfigPaths({
				projects: ["./tsconfig.json"],
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],

		resolve: {
			alias: {
				"@nle": path.resolve(__dirname, "../ai-nle-editor/src"),
				// react-skia-lite 的 dist 目前不完整，这里先统一走源码。
				"react-skia-lite": path.resolve(__dirname, "../react-skia-lite/src"),
			},
		},

		optimizeDeps: {
			include: ["canvaskit-wasm/bin/full/canvaskit"],
			esbuildOptions: {
				target: "esnext",
			},
		},
		build: {
			commonjsOptions: {
				include: [/node_modules/, /events/, /canvaskit-wasm/],
				transformMixedEsModules: true,
			},
		},
		ssr: {
			noExternal: ["@shopify/react-native-skia", "events"],
			resolve: {
				conditions: ["workerd", "worker", "browser"],
			},
		},
		assetsInclude: ["**/*.wasm"],
	};
});
