import { type SkImage, Skia } from "react-skia-lite";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";
import { type AssetHandle, assetStore } from "./AssetStore";

const OPFS_PREFIX = "opfs://";
const FILE_PREFIX = "file://";

export type ImageAsset = {
	uri: string;
	image: SkImage;
	width: number;
	height: number;
	releaseSource?: () => void;
};

export const acquireImageAsset = (
	uri: string,
): Promise<AssetHandle<ImageAsset>> => {
	return assetStore.acquire(
		"image",
		uri,
		() => createImageAsset(uri),
		(asset) => {
			asset.image.dispose();
			asset.releaseSource?.();
		},
	);
};

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
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

const resolveImageBytes = async (uri: string): Promise<Uint8Array> => {
	if (uri.startsWith(OPFS_PREFIX)) {
		const file = await resolveProjectOpfsFile(uri);
		const data = await file.arrayBuffer();
		return new Uint8Array(data);
	}

	if (isElectronEnv() && uri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromUri(uri);
		const bridge = getElectronFileBridge();
		if (!filePath || !bridge) {
			throw new Error("无法读取本地图片文件");
		}
		const { size } = await bridge.stat(filePath);
		const raw = await bridge.read(filePath, 0, size);
		return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	}

	const response = await fetch(uri);
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.status}`);
	}
	const data = await response.arrayBuffer();
	return new Uint8Array(data);
};

const createImageAsset = async (uri: string): Promise<ImageAsset> => {
	const bytes = await resolveImageBytes(uri);
	const imageData = Skia.Data.fromBytes(bytes);
	const image = Skia.Image.MakeImageFromEncoded(imageData);
	if (!image) {
		throw new Error(`Failed to decode image from ${uri}`);
	}

	return {
		uri,
		image,
		width: image.width(),
		height: image.height(),
	};
};
