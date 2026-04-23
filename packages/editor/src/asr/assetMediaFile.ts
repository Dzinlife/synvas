import type { TimelineAsset } from "core/timeline-system/types";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";
import {
	resolveAssetPlayableUri,
	resolveFileNameFromLocator,
} from "@/projects/assetLocator";

const OPFS_PREFIX = "opfs://";
const FILE_PREFIX = "file://";

export const isSupportedAssetMediaUri = (uri: string): boolean => {
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
			synvasElectron?: {
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
	).synvasElectron?.file;
	if (!bridge?.stat || !bridge.read) return null;
	return bridge;
};

const inferMimeType = (kind: TimelineAsset["kind"]): string => {
	if (kind === "audio") return "audio/*";
	if (kind === "video") return "video/*";
	return "application/octet-stream";
};

const resolveFileName = (asset: TimelineAsset): string => {
	const fromMeta = asset.meta?.fileName?.trim();
	if (fromMeta) return fromMeta;
	const preferred = asset.name?.trim();
	if (preferred) return preferred;
	const fromLocator = resolveFileNameFromLocator(asset.locator);
	if (fromLocator) return fromLocator;
	if (asset.kind === "audio") return "audio-asset";
	if (asset.kind === "video") return "video-asset";
	return "asset";
};

export interface ResolvedAssetMediaFile {
	file: File;
	fileName: string;
}

export interface ResolveAssetMediaFileOptions {
	projectId?: string | null;
}

export const resolveAssetMediaFile = async (
	asset: TimelineAsset,
	options: ResolveAssetMediaFileOptions = {},
): Promise<ResolvedAssetMediaFile> => {
	if (asset.kind !== "audio" && asset.kind !== "video") {
		throw new Error(`当前 asset kind 不支持转写: ${asset.kind}`);
	}

	const fileName = resolveFileName(asset);
	const resolvedUri = resolveAssetPlayableUri(asset, {
		projectId: options.projectId,
	});
	if (!resolvedUri) {
		throw new Error(`当前 asset 无法解析为可读取地址: ${asset.id}`);
	}

	if (resolvedUri.startsWith(OPFS_PREFIX)) {
		const file = await resolveProjectOpfsFile(resolvedUri);
		if (file.name === fileName) {
			return { file, fileName };
		}
		return {
			file: new File([file], fileName, {
				type: file.type || inferMimeType(asset.kind),
			}),
			fileName,
		};
	}

	if (resolvedUri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromUri(resolvedUri);
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
				type: inferMimeType(asset.kind),
			}),
			fileName,
		};
	}

	const isWebFetchUri =
		resolvedUri.startsWith("http://") ||
		resolvedUri.startsWith("https://") ||
		resolvedUri.startsWith("blob:");
	if (isWebFetchUri) {
		const response = await fetch(resolvedUri);
		if (!response.ok) {
			throw new Error(`下载 asset 失败: ${response.status}`);
		}
		const blob = await response.blob();
		return {
			file: new File([blob], fileName, {
				type: blob.type || inferMimeType(asset.kind),
			}),
			fileName,
		};
	}

	throw new Error(`当前 asset URI 不支持转写: ${resolvedUri}`);
};
