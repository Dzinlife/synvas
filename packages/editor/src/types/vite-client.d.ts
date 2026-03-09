// 为非 Vite 直接依赖的包提供最小的 import.meta.env 类型定义
interface ImportMetaEnv {
	readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module "*.wasm?url" {
	const url: string;
	export default url;
}
