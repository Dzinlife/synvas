import type { Input } from "mediabunny";
import { EncodedPacketSink } from "mediabunny";

const KEYFRAME_TIME_CACHE_LIMIT = 2000;

type KeyframeTimeCache = {
	input: Input;
	packetSink: EncodedPacketSink | null;
	trackPromise: ReturnType<Input["getPrimaryVideoTrack"]> | null;
	times: Map<number, number>;
	accessOrder: number[];
	inflight: Map<number, Promise<number | null>>;
};

const keyframeTimeCache = new Map<string, KeyframeTimeCache>();

const touchKeyframeTimeKey = (cache: KeyframeTimeCache, key: number) => {
	const index = cache.accessOrder.indexOf(key);
	if (index >= 0) {
		cache.accessOrder.splice(index, 1);
	}
	cache.accessOrder.push(key);
};

const evictKeyframeTimesIfNeeded = (cache: KeyframeTimeCache) => {
	while (cache.times.size > KEYFRAME_TIME_CACHE_LIMIT) {
		const oldestKey = cache.accessOrder.shift();
		if (oldestKey === undefined) break;
		cache.times.delete(oldestKey);
	}
};

const getKeyframeCache = (uri: string, input: Input): KeyframeTimeCache => {
	const existing = keyframeTimeCache.get(uri);
	if (existing && existing.input === input) return existing;
	const cache: KeyframeTimeCache = {
		input,
		packetSink: null,
		trackPromise: null,
		times: new Map(),
		accessOrder: [],
		inflight: new Map(),
	};
	keyframeTimeCache.set(uri, cache);
	return cache;
};

export const resolveVideoKeyframeTime = async (options: {
	uri: string;
	input: Input | null | undefined;
	time: number;
	timeKey: number;
}): Promise<number | null> => {
	const { uri, input, time, timeKey } = options;
	if (!input) return null;
	const cache = getKeyframeCache(uri, input);
	const cached = cache.times.get(timeKey);
	if (cached !== undefined) {
		touchKeyframeTimeKey(cache, timeKey);
		return cached;
	}
	const inflight = cache.inflight.get(timeKey);
	if (inflight) return inflight;
	const promise = (async () => {
		try {
			if (!cache.packetSink) {
				if (!cache.trackPromise) {
					cache.trackPromise = cache.input.getPrimaryVideoTrack();
				}
				const track = await cache.trackPromise;
				if (!track) return null;
				cache.packetSink = new EncodedPacketSink(track);
			}
			const packet = await cache.packetSink.getKeyPacket(time);
			if (!packet) return null;
			const keyTime = packet.timestamp;
			if (!Number.isFinite(keyTime)) return null;
			cache.times.set(timeKey, keyTime);
			touchKeyframeTimeKey(cache, timeKey);
			evictKeyframeTimesIfNeeded(cache);
			return keyTime;
		} catch (err) {
			console.warn("解析关键帧时间失败:", err);
			return null;
		}
	})();
	cache.inflight.set(timeKey, promise);
	try {
		return await promise;
	} finally {
		cache.inflight.delete(timeKey);
	}
};

export const __resetVideoKeyframeTimeCacheForTests = () => {
	keyframeTimeCache.clear();
};
