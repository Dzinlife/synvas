import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@\/(.*)$/,
				replacement: path.resolve(__dirname, "src/$1"),
			},
			{
				find: /^core$/,
				replacement: path.resolve(__dirname, "../core/src/index.ts"),
			},
			{
				find: /^core\/(.*)$/,
				replacement: path.resolve(__dirname, "../core/src/$1"),
			},
			{
				find: /^react-skia-lite$/,
				replacement: path.resolve(__dirname, "../react-skia-lite/src/index.ts"),
			},
			{
				find: /^react-skia-lite\/(.*)$/,
				replacement: path.resolve(__dirname, "../react-skia-lite/src/$1"),
			},
		],
	},
});
