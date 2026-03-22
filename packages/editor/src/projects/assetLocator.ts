import type {
	TimelineAsset,
	TimelineAssetLocator,
} from "core/element/types";
import {
	buildProjectOpfsUri,
	OPFS_PREFIX,
	parseProjectOpfsUri,
	type ProjectOpfsKind,
} from "@/lib/projectOpfsStorage";

const FILE_PREFIX = "file://";

type FileWithPath = File & { path?: string };

export type AssetRuntimeEnvironment = "electron" | "browser";

const trimToNull = (value: string | null | undefined): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

export const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
};

export const detectAssetRuntimeEnvironment = (): AssetRuntimeEnvironment => {
	return isElectronEnv() ? "electron" : "browser";
};

export const resolveProjectOpfsKind = (
	kind: TimelineAsset["kind"],
): ProjectOpfsKind | null => {
	if (kind === "audio") return "audios";
	if (kind === "video") return "videos";
	if (kind === "image") return "images";
	return null;
};

export const buildFileUrlFromPath = (rawPath: string): string => {
	if (rawPath.startsWith(FILE_PREFIX)) return rawPath;
	const normalized = rawPath.replace(/\\/g, "/");
	let pathPart = normalized;
	let isUnc = false;
	if (pathPart.startsWith("//")) {
		isUnc = true;
		pathPart = pathPart.slice(2);
	} else if (/^[a-zA-Z]:\//.test(pathPart)) {
		pathPart = `/${pathPart}`;
	} else if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}
	const encoded = pathPart
		.split("/")
		.map((segment) => {
			if (!segment) return "";
			if (!isUnc && /^[a-zA-Z]:$/.test(segment)) return segment;
			return encodeURIComponent(segment);
		})
		.join("/");
	return `${FILE_PREFIX}${encoded}`;
};

export const resolveFilePathFromFileUri = (uri: string): string | null => {
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
		return trimToNull(pathname);
	} catch {
		return null;
	}
};

const getElectronFilePath = (file: File): string | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				webUtils?: {
					getPathForFile?: (file: File) => string | null | undefined;
				};
			};
		}
	).aiNleElectron;
	const resolved = bridge?.webUtils?.getPathForFile?.(file);
	return trimToNull(resolved ?? null);
};

const getFilePath = (file: File): string | null => {
	const rawPath = (file as FileWithPath).path;
	return trimToNull(rawPath ?? null);
};

export const resolveExternalFilePath = (file: File): string | null => {
	return getFilePath(file) ?? getElectronFilePath(file);
};

const isRemoteUri = (uri: string): boolean => {
	return (
		uri.startsWith("http://") ||
		uri.startsWith("https://") ||
		uri.startsWith("blob:")
	);
};

const resolveWebLocatorUri = (uri: string): string | null => {
	if (isRemoteUri(uri)) return uri;
	try {
		if (typeof window === "undefined") return null;
		const resolved = new URL(uri, window.location.href).toString();
		if (isRemoteUri(resolved)) {
			return resolved;
		}
		return null;
	} catch {
		return null;
	}
};

const normalizeFilePath = (filePath: string): string => {
	return filePath.replace(/\\/g, "/").trim();
};

const normalizeFileName = (fileName: string): string => {
	return fileName.trim();
};

const normalizeUri = (uri: string): string => {
	return uri.trim();
};

export const normalizeAssetLocator = (
	locator: TimelineAssetLocator,
): TimelineAssetLocator => {
	if (locator.type === "linked-file") {
		return {
			type: "linked-file",
			filePath: normalizeFilePath(locator.filePath),
		};
	}
	if (locator.type === "linked-remote") {
		return {
			type: "linked-remote",
			uri: normalizeUri(locator.uri),
		};
	}
	return {
		type: "managed",
		fileName: normalizeFileName(locator.fileName),
	};
};

export const isSameAssetLocator = (
	left: TimelineAssetLocator,
	right: TimelineAssetLocator,
): boolean => {
	if (left.type !== right.type) return false;
	const normalizedLeft = normalizeAssetLocator(left);
	const normalizedRight = normalizeAssetLocator(right);
	if (normalizedLeft.type === "linked-file") {
		return (
			normalizedRight.type === "linked-file" &&
			normalizedLeft.filePath === normalizedRight.filePath
		);
	}
	if (normalizedLeft.type === "linked-remote") {
		return (
			normalizedRight.type === "linked-remote" &&
			normalizedLeft.uri === normalizedRight.uri
		);
	}
	return (
		normalizedRight.type === "managed" &&
		normalizedLeft.fileName === normalizedRight.fileName
	);
};

export interface ResolveAssetPlayableUriContext {
	projectId?: string | null;
	environment?: AssetRuntimeEnvironment;
}

export const resolveAssetPlayableUri = (
	asset: TimelineAsset,
	context: ResolveAssetPlayableUriContext = {},
): string | null => {
	const environment = context.environment ?? detectAssetRuntimeEnvironment();
	const locator = normalizeAssetLocator(asset.locator);
	if (locator.type === "linked-remote") {
		return locator.uri;
	}
	if (locator.type === "linked-file") {
		if (environment !== "electron") return null;
		return buildFileUrlFromPath(locator.filePath);
	}
	const projectId = trimToNull(context.projectId ?? null);
	if (!projectId) return null;
	const opfsKind = resolveProjectOpfsKind(asset.kind);
	if (!opfsKind) return null;
	return buildProjectOpfsUri(projectId, opfsKind, locator.fileName);
};

const extractFileNameFromPath = (value: string): string | null => {
	const normalized = value.replace(/\\/g, "/");
	const chunks = normalized.split("/").filter(Boolean);
	const last = chunks[chunks.length - 1];
	return trimToNull(last ?? null);
};

export const extractFileNameFromUri = (uri: string): string | null => {
	try {
		const url = new URL(uri);
		const pathname = decodeURIComponent(url.pathname);
		return extractFileNameFromPath(pathname);
	} catch {
		return extractFileNameFromPath(uri.split("?")[0]?.split("#")[0] ?? "");
	}
};

export const resolveAssetDisplayLabel = (
	asset: TimelineAsset | null | undefined,
	context: ResolveAssetPlayableUriContext = {},
): string | null => {
	if (!asset) return null;
	if (asset.locator.type === "linked-file") {
		return asset.locator.filePath;
	}
	if (asset.locator.type === "managed") {
		return resolveAssetPlayableUri(asset, context) ?? asset.locator.fileName;
	}
	return asset.locator.uri;
};

export const resolveAssetLocatorFromUri = (
	uri: string,
	kind?: TimelineAsset["kind"],
): TimelineAssetLocator | null => {
	const trimmedUri = normalizeUri(uri);
	if (!trimmedUri) return null;
	if (trimmedUri.startsWith(OPFS_PREFIX)) {
		const parsed = parseProjectOpfsUri(trimmedUri);
		if (kind) {
			const expectedKind = resolveProjectOpfsKind(kind);
			if (expectedKind && expectedKind !== parsed.kind) {
				throw new Error("OPFS 资源类型与素材类型不匹配");
			}
		}
		return {
			type: "managed",
			fileName: parsed.fileName,
		};
	}
	if (trimmedUri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromFileUri(trimmedUri);
		if (!filePath) return null;
		return {
			type: "linked-file",
			filePath,
		};
	}
	const remoteUri = resolveWebLocatorUri(trimmedUri);
	if (!remoteUri) return null;
	return {
		type: "linked-remote",
		uri: remoteUri,
	};
};

export const resolveFileNameFromLocator = (
	locator: TimelineAssetLocator,
): string | null => {
	if (locator.type === "managed") {
		return locator.fileName;
	}
	if (locator.type === "linked-file") {
		return extractFileNameFromPath(locator.filePath);
	}
	return extractFileNameFromUri(locator.uri);
};
