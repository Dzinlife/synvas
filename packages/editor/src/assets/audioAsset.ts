import {
	ALL_FORMATS,
	AudioBufferSink,
	Input,
	StreamSource,
	UrlSource,
} from "mediabunny";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";
import { type AssetHandle, assetStore } from "./AssetStore";

const DEFAULT_MAX_CACHE_SIZE = 200;

type AudioBufferCacheEntry = {
	buffer: AudioBuffer;
	timestamp: number;
};

export type AudioAsset = {
	uri: string;
	input: Input;
	duration: number;
	createAudioSink: () => AudioBufferSink;
	bufferCache: Map<number, AudioBufferCacheEntry>;
	cacheAccessOrder: number[];
	maxCacheSize: number;
	getCachedBuffer: (timestamp: number) => AudioBufferCacheEntry | undefined;
	storeBuffer: (timestamp: number, buffer: AudioBuffer) => void;
	clearCache: () => void;
	releaseSource?: () => void;
};

export const acquireAudioAsset = (
	uri: string,
): Promise<AssetHandle<AudioAsset>> => {
	return assetStore.acquire(
		"audio",
		uri,
		() => createAudioAsset(uri),
		(asset) => {
			asset.clearCache();
			asset.releaseSource?.();
		},
	);
};

const OPFS_PREFIX = "opfs://";
const FILE_PREFIX = "file://";

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "synvasElectron" in window;
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

const resolveCacheKey = (timestamp: number): number => {
	if (!Number.isFinite(timestamp)) return 0;
	return Math.max(0, Math.round(timestamp * 1000));
};

const createAudioAsset = async (uri: string): Promise<AudioAsset> => {
	let releaseSource: (() => void) | undefined;
	let source: UrlSource | StreamSource;

	if (isElectronEnv() && uri.startsWith(FILE_PREFIX)) {
		const filePath = resolveFilePathFromUri(uri);
		const bridge = getElectronFileBridge();
		if (!filePath || !bridge) {
			throw new Error("无法读取本地音频文件");
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
	let audioTrack = await input.getPrimaryAudioTrack();

	if (audioTrack) {
		if (audioTrack.codec === null) {
			audioTrack = null;
		} else if (!(await audioTrack.canDecode())) {
			audioTrack = null;
		}
	}

	if (!audioTrack) {
		throw new Error("No valid audio track found");
	}

	const buildAudioSink = () => new AudioBufferSink(audioTrack);

	const bufferCache = new Map<number, AudioBufferCacheEntry>();
	const cacheAccessOrder: number[] = [];

	const updateCacheAccess = (key: number) => {
		const index = cacheAccessOrder.indexOf(key);
		if (index > -1) {
			cacheAccessOrder.splice(index, 1);
		}
		cacheAccessOrder.push(key);
	};

	const cleanupCache = () => {
		if (bufferCache.size <= DEFAULT_MAX_CACHE_SIZE) return;
		let guard = cacheAccessOrder.length;
		while (
			bufferCache.size > DEFAULT_MAX_CACHE_SIZE &&
			cacheAccessOrder.length > 0 &&
			guard > 0
		) {
			const oldestKey = cacheAccessOrder.shift();
			guard -= 1;
			if (oldestKey === undefined) continue;
			bufferCache.delete(oldestKey);
		}
	};

	const resolveCacheEntry = (
		timestamp: number,
	): AudioBufferCacheEntry | undefined => {
		const key = resolveCacheKey(timestamp);
		let entry = bufferCache.get(key);
		if (!entry) {
			let bestKey: number | null = null;
			for (const cachedKey of bufferCache.keys()) {
				if (cachedKey <= key && (bestKey === null || cachedKey > bestKey)) {
					bestKey = cachedKey;
				}
			}
			if (bestKey !== null) {
				entry = bufferCache.get(bestKey);
				if (entry) {
					const start = entry.timestamp;
					const end = start + entry.buffer.duration;
					if (timestamp < start || timestamp > end) {
						entry = undefined;
					}
				}
			}
		}
		if (entry) {
			const accessKey = resolveCacheKey(entry.timestamp);
			updateCacheAccess(accessKey);
		}
		return entry;
	};

	return {
		uri,
		input,
		duration,
		createAudioSink: buildAudioSink,
		bufferCache,
		cacheAccessOrder,
		maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
		getCachedBuffer: (timestamp) => resolveCacheEntry(timestamp),
		storeBuffer: (timestamp, buffer) => {
			const key = resolveCacheKey(timestamp);
			if (!bufferCache.has(key)) {
				bufferCache.set(key, { buffer, timestamp });
				updateCacheAccess(key);
				cleanupCache();
			}
		},
		clearCache: () => {
			bufferCache.clear();
			cacheAccessOrder.length = 0;
		},
		releaseSource,
	};
};
