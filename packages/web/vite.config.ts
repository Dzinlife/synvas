import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canvaskitPackageDir = path.resolve(__dirname, "../canvaskit-wasm");
const canvaskitBrokenWorkspaceDir = path.resolve(__dirname, "../../canvaskit-wasm");

export default defineConfig(() => {
	return {
		plugins: [
			// CanvasKit WebGPU bundle 仍包含 top-level await。
			topLevelAwait(),
			devtools(),
			cloudflare({ viteEnvironment: { name: "ssr" } }),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],

		resolve: {
			tsconfigPaths: true,
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
		},
		ssr: {
			noExternal: ["@shopify/react-native-skia", "events"],
			resolve: {
				conditions: ["workerd", "worker", "browser"],
			},
		},
	};
});
