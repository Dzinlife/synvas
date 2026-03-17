import {
	ALL_FORMATS,
	CanvasSink,
	Input,
	StreamSource,
	UrlSource,
} from "mediabunny";
import { type SkImage } from "react-skia-lite";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";
import { type AssetHandle, assetStore } from "./AssetStore";

const DEFAULT_MAX_CACHE_BYTES = 384 * 1024 * 1024;
const ESTIMATED_FRAME_BYTES_PER_PIXEL = 4;

const estimateFrameCacheBytes = (image: SkImage) => {
	// 视频帧当前统一按 RGBA 纹理估算缓存占用，避免高分辨率素材按帧数缓存时挤爆显存。
	const width = Math.max(1, Math.ceil(image.width()));
	const height = Math.max(1, Math.ceil(image.height()));
	return width * height * ESTIMATED_FRAME_BYTES_PER_PIXEL;
};

export type VideoAsset = {
	uri: string;
	input: Input;
	videoSink: CanvasSink;
	duration: number;
	createVideoSink: () => CanvasSink;
	frameCache: Map<number, SkImage>;
	cacheAccessOrder: number[];
	maxCacheBytes: number;
	getCachedFrame: (timestamp: number) => SkImage | undefined;
	storeFrame: (timestamp: number, image: SkImage) => void;
	clearCache: () => void;
	pinFrame: (image: SkImage) => void;
	unpinFrame: (image: SkImage) => void;
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
		const file = await resolveProjectOpfsFile(uri);
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
	const frameCacheBytes = new Map<number, number>();
	const cacheAccessOrder: number[] = [];
	// 记录仍在使用的帧，避免缓存回收时误释放
	const pinnedFrames = new Map<SkImage, number>();
	let currentCacheBytes = 0;

	const updateCacheAccess = (key: number) => {
		const index = cacheAccessOrder.indexOf(key);
		if (index > -1) {
			cacheAccessOrder.splice(index, 1);
		}
		cacheAccessOrder.push(key);
	};

	const maxCacheBytes = DEFAULT_MAX_CACHE_BYTES;

	const cleanupCache = () => {
		if (currentCacheBytes <= maxCacheBytes) return;
		let guard = cacheAccessOrder.length;
		while (
			currentCacheBytes > maxCacheBytes &&
			cacheAccessOrder.length > 0 &&
			guard > 0
		) {
			const oldestKey = cacheAccessOrder.shift();
			guard -= 1;
			if (oldestKey === undefined) continue;
			const image = frameCache.get(oldestKey);
			if (!image) continue;
			if (pinnedFrames.has(image)) {
				cacheAccessOrder.push(oldestKey);
				continue;
			}
			frameCache.delete(oldestKey);
			currentCacheBytes -= frameCacheBytes.get(oldestKey) ?? 0;
			frameCacheBytes.delete(oldestKey);
			image.dispose();
		}
	};

	const pinFrame = (image: SkImage) => {
		const count = pinnedFrames.get(image) ?? 0;
		pinnedFrames.set(image, count + 1);
	};

	const unpinFrame = (image: SkImage) => {
		const count = pinnedFrames.get(image);
		if (!count) return;
		if (count <= 1) {
			pinnedFrames.delete(image);
			return;
		}
		pinnedFrames.set(image, count - 1);
	};

	return {
		uri,
		input,
		videoSink,
		duration,
		createVideoSink: buildVideoSink,
		frameCache,
		cacheAccessOrder,
		maxCacheBytes,
		getCachedFrame: (timestamp) => {
			const cached = frameCache.get(timestamp);
			if (cached) {
				updateCacheAccess(timestamp);
			}
			return cached;
		},
		storeFrame: (timestamp, image) => {
			if (!frameCache.has(timestamp)) {
				const cacheBytes = estimateFrameCacheBytes(image);
				frameCache.set(timestamp, image);
				frameCacheBytes.set(timestamp, cacheBytes);
				currentCacheBytes += cacheBytes;
				updateCacheAccess(timestamp);
				cleanupCache();
			}
		},
		clearCache: () => {
			for (const image of frameCache.values()) {
				image.dispose();
			}
			frameCache.clear();
			frameCacheBytes.clear();
			currentCacheBytes = 0;
			cacheAccessOrder.length = 0;
			pinnedFrames.clear();
		},
		pinFrame,
		unpinFrame,
		releaseSource,
	};
};
