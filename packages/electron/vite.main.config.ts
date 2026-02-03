import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const builtins = new Set(builtinModules);
for (const mod of builtinModules) {
	builtins.add(`node:${mod}`);
}

export default defineConfig({
	plugins: [tsconfigPaths()],
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
		rollupOptions: {
			external: ["electron", ...builtins],
		},
	},
});
