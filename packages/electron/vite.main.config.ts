import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const builtins = new Set(builtinModules);
for (const mod of builtinModules) {
	builtins.add(`node:${mod}`);
}

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	build: {
		target: "es2022",
		sourcemap: true,
		minify: false,
		outDir: "dist/main",
		emptyOutDir: true,
		lib: {
			entry: path.resolve(__dirname, "src/main/main.ts"),
			formats: ["es"],
			fileName: () => "main.js",
		},
		rolldownOptions: {
			external: ["electron", ...builtins],
		},
	},
});
