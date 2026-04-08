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
const canvaskitPackageDir = path.resolve(__dirname, "../canvaskit-wasm");
const canvaskitBrokenWorkspaceDir = path.resolve(__dirname, "../../canvaskit-wasm");

export default defineConfig(() => {
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
				projectDiscovery: "lazy",
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],

		resolve: {
			alias: [
				{
					find: "@synvas/editor",
					replacement: path.resolve(__dirname, "../editor/src"),
				},
				// react-skia-lite 的 dist 目前不完整，这里先统一走源码。
				{
					find: "react-skia-lite",
					replacement: path.resolve(__dirname, "../react-skia-lite/src"),
				},
				// SSR 有时会把 workspace 包子路径误解析到仓库根目录，统一拉回真实包目录。
				{
					find: canvaskitBrokenWorkspaceDir,
					replacement: canvaskitPackageDir,
				},
				{
					find: "canvaskit-wasm/bin/full/canvaskit.wasm",
					replacement: path.resolve(
						canvaskitPackageDir,
						"bin/full/canvaskit.wasm",
					),
				},
				{
					find: "canvaskit-wasm/bin/full-webgl/canvaskit.wasm",
					replacement: path.resolve(
						canvaskitPackageDir,
						"bin/full-webgl/canvaskit.wasm",
					),
				},
				{
					find: "canvaskit-wasm/bin/full-webgpu/canvaskit.wasm",
					replacement: path.resolve(
						canvaskitPackageDir,
						"bin/full-webgpu/canvaskit.wasm",
					),
				},
				{
					find: "core",
					replacement: path.resolve(__dirname, "../core/src"),
				},
			],
		},

		optimizeDeps: {
			include: [
				"canvaskit-wasm/bin/full/canvaskit",
				"canvaskit-wasm/bin/full-webgl/canvaskit",
				"canvaskit-wasm/bin/full-webgpu/canvaskit",
			],
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
