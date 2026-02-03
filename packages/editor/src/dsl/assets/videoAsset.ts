import {
	ALL_FORMATS,
	CanvasSink,
	Input,
	StreamSource,
	UrlSource,
} from "mediabunny";
import type { SkImage } from "react-skia-lite";
import { type AssetHandle, assetStore } from "./AssetStore";

const DEFAULT_MAX_CACHE_SIZE = 500;

export type VideoAsset = {
	uri: string;
	input: Input;
	videoSink: CanvasSink;
	duration: number;
	createVideoSink: () => CanvasSink;
	frameCache: Map<number, SkImage>;
	cacheAccessOrder: number[];
	maxCacheSize: number;
	getCachedFrame: (timestamp: number) => SkImage | undefined;
	storeFrame: (timestamp: number, image: SkImage) => void;
	clearCache: () => void;
	releaseSource?: () => void;
};

export const acquireVideoAsset = (
	uri: string,
): Promise<AssetHandle<VideoAsset>> => {
	return assetStore.acquire(
		"video",
		uri,
		() => createVideoAsset(uri),
		(asset) => {
			asset.clearCache();
			asset.releaseSource?.();
		},
	);
};

const OPFS_PREFIX = "opfs://";
const FILE_PREFIX = "file://";

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
};

const resolveOpfsFile = async (uri: string): Promise<File> => {
	const rawPath = uri.slice(OPFS_PREFIX.length);
	const parts = rawPath.split("/").filter(Boolean);
	if (parts.length === 0) {
		throw new Error("OPFS 路径为空");
	}
	const root = await navigator.storage.getDirectory();
	let current: FileSystemDirectoryHandle = root;
	for (let i = 0; i < parts.length - 1; i += 1) {
		current = await current.getDirectoryHandle(parts[i]);
	}
	const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
	return fileHandle.getFile();
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

const createVideoAsset = async (uri: string): Promise<VideoAsset> => {
	let releaseSource: (() => void) | undefined;
	let source: UrlSource | StreamSource;

	if (isElectronEnv() && uri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromUri(uri);
		const bridge = getElectronFileBridge();
		if (!filePath || !bridge) {
			throw new Error("无法读取本地视频文件");
		}
		source = new StreamSource({
			getSize: async () => {
				const { size } = await bridge.stat(filePath);
				return size;
			},
			read: async (start, end) => {
				const data = await bridge.read(filePath, start, end);
				if (data instanceof Uint8Array) return data;
				return new Uint8Array(data);
			},
			prefetchProfile: "fileSystem",
		});
	} else if (uri.startsWith(OPFS_PREFIX)) {
		// OPFS 文件需要转成 objectURL 供解码器读取
		const file = await resolveOpfsFile(uri);
		const sourceUrl = URL.createObjectURL(file);
		source = new UrlSource(sourceUrl);
		releaseSource = () => {
			URL.revokeObjectURL(sourceUrl);
		};
	} else {
		source = new UrlSource(uri);
	}

	const input = new Input({
		source,
		formats: ALL_FORMATS,
	});

	const duration = await input.computeDuration();

	let videoTrack = await input.getPrimaryVideoTrack();

	if (videoTrack) {
		if (videoTrack.codec === null) {
			videoTrack = null;
		} else if (!(await videoTrack.canDecode())) {
			videoTrack = null;
		}
	}

	if (!videoTrack) {
		throw new Error("No valid video track found");
	}

	const videoCanBeTransparent = await videoTrack.canBeTransparent();
	const buildVideoSink = () =>
		new CanvasSink(videoTrack, {
			poolSize: 2,
			fit: "contain",
			alpha: videoCanBeTransparent,
		});
	const videoSink = buildVideoSink();

	const frameCache = new Map<number, SkImage>();
	const cacheAccessOrder: number[] = [];

	const updateCacheAccess = (key: number) => {
		const index = cacheAccessOrder.indexOf(key);
		if (index > -1) {
			cacheAccessOrder.splice(index, 1);
		}
		cacheAccessOrder.push(key);
	};

	const cleanupCache = () => {
		while (
			frameCache.size > DEFAULT_MAX_CACHE_SIZE &&
			cacheAccessOrder.length > 0
		) {
			const oldestKey = cacheAccessOrder.shift();
			if (oldestKey !== undefined) {
				frameCache.delete(oldestKey);
			}
		}
	};

	return {
		uri,
		input,
		videoSink,
		duration,
		createVideoSink: buildVideoSink,
		frameCache,
		cacheAccessOrder,
		maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
		getCachedFrame: (timestamp) => {
			const cached = frameCache.get(timestamp);
			if (cached) {
				updateCacheAccess(timestamp);
			}
			return cached;
		},
		storeFrame: (timestamp, image) => {
			if (!frameCache.has(timestamp)) {
				frameCache.set(timestamp, image);
				updateCacheAccess(timestamp);
				cleanupCache();
			}
		},
		clearCache: () => {
			frameCache.clear();
			cacheAccessOrder.length = 0;
		},
		releaseSource,
	};
};
