import type { TimelineSource } from "core/dsl/types";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";

const OPFS_PREFIX = "opfs://";
const FILE_PREFIX = "file://";

export const isSupportedSourceMediaUri = (uri: string): boolean => {
	return (
		uri.startsWith(OPFS_PREFIX) ||
		uri.startsWith(FILE_PREFIX) ||
		uri.startsWith("http://") ||
		uri.startsWith("https://") ||
		uri.startsWith("blob:")
	);
};

const resolveFilePathFromUri = (uri: string): string | null => {
	if (!uri.startsWith(FILE_PREFIX)) return null;
	try {
		const url = new URL(uri);
		let pathname = decodeURIComponent(url.pathname);
		if (url.hostname) {
			pathname = `//${url.hostname}${pathname}`;
		}
		if (/^\/[a-zA-Z]:\//.test(pathname)) {
			pathname = pathname.slice(1);
		}
		return pathname;
	} catch {
		return null;
	}
};

const getElectronFileBridge = (): {
	stat: (filePath: string) => Promise<{ size: number }>;
	read: (
		filePath: string,
		start: number,
		end: number,
	) => Promise<Uint8Array | ArrayBuffer>;
} | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				file?: {
					stat: (filePath: string) => Promise<{ size: number }>;
					read: (
						filePath: string,
						start: number,
						end: number,
					) => Promise<Uint8Array | ArrayBuffer>;
				};
			};
		}
	).aiNleElectron?.file;
	if (!bridge?.stat || !bridge.read) return null;
	return bridge;
};

const inferMimeType = (kind: TimelineSource["kind"]): string => {
	if (kind === "audio") return "audio/*";
	if (kind === "video") return "video/*";
	return "application/octet-stream";
};

const extractFileNameFromUri = (uri: string): string | null => {
	try {
		const url = new URL(uri);
		const pathname = decodeURIComponent(url.pathname);
		const parts = pathname.split("/").filter(Boolean);
		const last = parts[parts.length - 1];
		if (!last) return null;
		return last;
	} catch {
		const cleaned = uri.split("?")[0]?.split("#")[0] ?? "";
		const parts = cleaned.split("/").filter(Boolean);
		return parts[parts.length - 1] ?? null;
	}
};

const resolveFileName = (source: TimelineSource): string => {
	const preferred = source.name?.trim();
	if (preferred) return preferred;
	const fromUri = extractFileNameFromUri(source.uri);
	if (fromUri) return fromUri;
	if (source.kind === "audio") return "audio-source";
	if (source.kind === "video") return "video-source";
	return "source";
};

export interface ResolvedSourceMediaFile {
	file: File;
	fileName: string;
}

export const resolveSourceMediaFile = async (
	source: TimelineSource,
): Promise<ResolvedSourceMediaFile> => {
	if (source.kind !== "audio" && source.kind !== "video") {
		throw new Error(`当前 source kind 不支持转写: ${source.kind}`);
	}

	const fileName = resolveFileName(source);
	if (source.uri.startsWith(OPFS_PREFIX)) {
		const file = await resolveProjectOpfsFile(source.uri);
		if (file.name === fileName) {
			return { file, fileName };
		}
		return {
			file: new File([file], fileName, {
				type: file.type || inferMimeType(source.kind),
			}),
			fileName,
		};
	}

	if (source.uri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromUri(source.uri);
		const bridge = getElectronFileBridge();
		if (!filePath || !bridge) {
			throw new Error("当前环境无法读取 file:// 资源");
		}
		const { size } = await bridge.stat(filePath);
		const raw = await bridge.read(filePath, 0, size);
		const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
		// 强制拷贝到标准 ArrayBuffer，避免 SharedArrayBuffer 类型导致 File 构造报错。
		const copied = new Uint8Array(bytes.byteLength);
		copied.set(bytes);
		return {
			file: new File([copied.buffer], fileName, {
				type: inferMimeType(source.kind),
			}),
			fileName,
		};
	}

	const isWebFetchUri =
		source.uri.startsWith("http://") ||
		source.uri.startsWith("https://") ||
		source.uri.startsWith("blob:");
	if (isWebFetchUri) {
		const response = await fetch(source.uri);
		if (!response.ok) {
			throw new Error(`下载 source 失败: ${response.status}`);
		}
		const blob = await response.blob();
		return {
			file: new File([blob], fileName, {
				type: blob.type || inferMimeType(source.kind),
			}),
			fileName,
		};
	}

	throw new Error(`当前 source URI 不支持转写: ${source.uri}`);
};
