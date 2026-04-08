type LocalStorageLike = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
};

type DisposableLike = {
	__typename__?: string;
	ref?: unknown;
};

type TrackedIdCarrier = {
	__skiaTrackedResourceId__?: number;
};

export interface SkiaResourceTrackerConfig {
	enabled: boolean;
	captureStacks: boolean;
	autoProjectSwitchSnapshot: boolean;
	sampleLimitPerType: number;
}

export interface TrackedSkiaHostObjectStats {
	total: number;
	byType: Record<string, number>;
}

export interface TrackedSkiaHostObjectSample {
	id: number;
	type: string;
	createdAtMs: number;
	ageMs: number;
	refType: string;
	creationStack?: string;
}

export interface TrackedSkiaHostObjectSnapshot {
	capturedAtMs: number;
	total: number;
	byType: Record<string, number>;
	samplesByType?: Record<string, TrackedSkiaHostObjectSample[]>;
}

export interface CaptureTrackedSkiaHostObjectSnapshotOptions {
	includeSamples?: boolean;
	sampleLimitPerType?: number;
}

export interface TrackedSkiaHostObjectSnapshotDiff {
	totalDelta: number;
	byTypeDelta: Record<string, number>;
	increasedTypes: Array<{ type: string; delta: number }>;
	decreasedTypes: Array<{ type: string; delta: number }>;
}

type TrackedSkiaHostObjectRecord = {
	id: number;
	type: string;
	createdAtMs: number;
	refType: string;
	creationStack?: string;
};

const TRACKER_CONFIG_STORAGE_KEY = "synvas:skia-resource-tracker:v1";
const DEFAULT_SAMPLE_LIMIT_PER_TYPE = 3;
const MIN_SAMPLE_LIMIT_PER_TYPE = 1;
const MAX_SAMPLE_LIMIT_PER_TYPE = 200;

const DEFAULT_TRACKER_CONFIG: SkiaResourceTrackerConfig = {
	enabled: false,
	captureStacks: false,
	autoProjectSwitchSnapshot: false,
	sampleLimitPerType: DEFAULT_SAMPLE_LIMIT_PER_TYPE,
};

const trackedSkiaHostObjects = new Set<DisposableLike>();
const trackedSkiaHostObjectTypeCount = new Map<string, number>();
const trackedSkiaHostObjectsById = new Map<number, TrackedSkiaHostObjectRecord>();
let nextTrackedSkiaHostObjectId = 1;

let cachedConfig: SkiaResourceTrackerConfig | null = null;
let hasInitializedConfig = false;

const hasWindow = () => typeof window !== "undefined";

const resolveStorage = (): LocalStorageLike | null => {
	if (!hasWindow()) return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
};

const clampSampleLimitPerType = (value: unknown): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_SAMPLE_LIMIT_PER_TYPE;
	}
	return Math.max(
		MIN_SAMPLE_LIMIT_PER_TYPE,
		Math.min(MAX_SAMPLE_LIMIT_PER_TYPE, Math.floor(value)),
	);
};

const normalizeTrackerConfig = (
	value: Partial<SkiaResourceTrackerConfig> | null | undefined,
): SkiaResourceTrackerConfig => {
	return {
		enabled: value?.enabled === true,
		captureStacks: value?.captureStacks === true,
		autoProjectSwitchSnapshot: value?.autoProjectSwitchSnapshot === true,
		sampleLimitPerType: clampSampleLimitPerType(value?.sampleLimitPerType),
	};
};

const readTrackerConfigFromStorage = (): SkiaResourceTrackerConfig => {
	const storage = resolveStorage();
	if (!storage) {
		return { ...DEFAULT_TRACKER_CONFIG };
	}
	try {
		const raw = storage.getItem(TRACKER_CONFIG_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_TRACKER_CONFIG };
		const parsed = JSON.parse(raw) as Partial<SkiaResourceTrackerConfig>;
		return normalizeTrackerConfig(parsed);
	} catch {
		return { ...DEFAULT_TRACKER_CONFIG };
	}
};

const writeTrackerConfigToStorage = (config: SkiaResourceTrackerConfig) => {
	const storage = resolveStorage();
	if (!storage) return;
	try {
		storage.setItem(TRACKER_CONFIG_STORAGE_KEY, JSON.stringify(config));
	} catch {}
};

const ensureConfigInitialized = () => {
	if (hasInitializedConfig && cachedConfig) return cachedConfig;
	cachedConfig = readTrackerConfigFromStorage();
	hasInitializedConfig = true;
	return cachedConfig;
};

const getTrackerConfigInternal = () => {
	return ensureConfigInitialized();
};

const setTrackerConfigInternal = (config: SkiaResourceTrackerConfig) => {
	cachedConfig = config;
	hasInitializedConfig = true;
	writeTrackerConfigToStorage(config);
};

const resolveTrackedType = (target: DisposableLike): string => {
	const typename = target.__typename__;
	if (typeof typename !== "string") return "unknown";
	const normalized = typename.trim();
	return normalized.length > 0 ? normalized : "unknown";
};

const resolveTrackedRefType = (target: DisposableLike): string => {
	const ref = target.ref;
	if (ref === null || ref === undefined) {
		return "null";
	}
	if (typeof ref !== "object") {
		return typeof ref;
	}
	const constructorName = (ref as { constructor?: { name?: unknown } })
		.constructor?.name;
	if (
		typeof constructorName === "string" &&
		constructorName.trim().length > 0
	) {
		return constructorName;
	}
	return Object.prototype.toString.call(ref);
};

const canTrackRef = (ref: unknown): boolean => {
	if (!ref || typeof ref !== "object") return false;
	const disposableRef = ref as {
		delete?: unknown;
		dispose?: unknown;
	};
	return (
		typeof disposableRef.delete === "function" ||
		typeof disposableRef.dispose === "function"
	);
};

const canTrackTarget = (target: DisposableLike): boolean => {
	return canTrackRef(target.ref);
};

const ensureTrackedId = (target: DisposableLike): number => {
	const carrier = target as TrackedIdCarrier;
	const existingId = carrier.__skiaTrackedResourceId__;
	if (
		typeof existingId === "number" &&
		Number.isFinite(existingId) &&
		existingId > 0
	) {
		return existingId;
	}
	const nextId = nextTrackedSkiaHostObjectId;
	nextTrackedSkiaHostObjectId += 1;
	carrier.__skiaTrackedResourceId__ = nextId;
	return nextId;
};

const getTrackedId = (target: DisposableLike): number | null => {
	const carrier = target as TrackedIdCarrier;
	const trackedId = carrier.__skiaTrackedResourceId__;
	if (
		typeof trackedId === "number" &&
		Number.isFinite(trackedId) &&
		trackedId > 0
	) {
		return trackedId;
	}
	return null;
};

const updateTypeCount = (type: string, delta: number) => {
	if (delta === 0) return;
	const next = (trackedSkiaHostObjectTypeCount.get(type) ?? 0) + delta;
	if (next <= 0) {
		trackedSkiaHostObjectTypeCount.delete(type);
		return;
	}
	trackedSkiaHostObjectTypeCount.set(type, next);
};

const maybeCaptureCreationStack = (): string | undefined => {
	if (!getTrackerConfigInternal().captureStacks) return undefined;
	const stack = new Error().stack;
	if (!stack) return undefined;
	const lines = stack
		.split("\n")
		.slice(2, 14)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length <= 0) return undefined;
	return lines.join("\n");
};

export const getSkiaResourceTrackerStorageKey = () => {
	return TRACKER_CONFIG_STORAGE_KEY;
};

export const getSkiaResourceTrackerConfig = (): SkiaResourceTrackerConfig => {
	const next = readTrackerConfigFromStorage();
	cachedConfig = next;
	hasInitializedConfig = true;
	return { ...next };
};

export const setSkiaResourceTrackerConfig = (
	patch: Partial<SkiaResourceTrackerConfig>,
): SkiaResourceTrackerConfig => {
	const current = getTrackerConfigInternal();
	const next = normalizeTrackerConfig({
		...current,
		...patch,
	});
	setTrackerConfigInternal(next);
	return { ...next };
};

export const getTrackedSkiaHostObjectCount = (): number => {
	return trackedSkiaHostObjects.size;
};

export const getTrackedSkiaHostObjectStats = (): TrackedSkiaHostObjectStats => {
	return {
		total: trackedSkiaHostObjects.size,
		byType: Object.fromEntries(
			[...trackedSkiaHostObjectTypeCount.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	};
};

export const captureTrackedSkiaHostObjectsSnapshot = (
	options?: CaptureTrackedSkiaHostObjectSnapshotOptions,
): TrackedSkiaHostObjectSnapshot => {
	const capturedAtMs = Date.now();
	const snapshot: TrackedSkiaHostObjectSnapshot = {
		capturedAtMs,
		total: trackedSkiaHostObjects.size,
		byType: Object.fromEntries(
			[...trackedSkiaHostObjectTypeCount.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	};
	if (!options?.includeSamples) {
		return snapshot;
	}
	const sampleLimitPerType = clampSampleLimitPerType(
		options.sampleLimitPerType ?? getTrackerConfigInternal().sampleLimitPerType,
	);
	const recordsByType = new Map<string, TrackedSkiaHostObjectRecord[]>();
	for (const record of trackedSkiaHostObjectsById.values()) {
		const bucket = recordsByType.get(record.type) ?? [];
		bucket.push(record);
		recordsByType.set(record.type, bucket);
	}
	const samplesByType: Record<string, TrackedSkiaHostObjectSample[]> = {};
	for (const [type, records] of [...recordsByType.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	)) {
		const samples = records
			.sort((left, right) => left.createdAtMs - right.createdAtMs)
			.slice(0, sampleLimitPerType)
			.map((record) => ({
				id: record.id,
				type: record.type,
				createdAtMs: record.createdAtMs,
				ageMs: Math.max(0, capturedAtMs - record.createdAtMs),
				refType: record.refType,
				creationStack: record.creationStack,
			}));
		if (samples.length > 0) {
			samplesByType[type] = samples;
		}
	}
	if (Object.keys(samplesByType).length > 0) {
		snapshot.samplesByType = samplesByType;
	}
	return snapshot;
};

export const diffTrackedSkiaHostObjectSnapshots = (
	before: TrackedSkiaHostObjectSnapshot,
	after: TrackedSkiaHostObjectSnapshot,
): TrackedSkiaHostObjectSnapshotDiff => {
	const keys = new Set<string>([
		...Object.keys(before.byType),
		...Object.keys(after.byType),
	]);
	const byTypeDelta: Record<string, number> = {};
	const increasedTypes: Array<{ type: string; delta: number }> = [];
	const decreasedTypes: Array<{ type: string; delta: number }> = [];
	for (const key of [...keys].sort((left, right) =>
		left.localeCompare(right),
	)) {
		const beforeCount = before.byType[key] ?? 0;
		const afterCount = after.byType[key] ?? 0;
		const delta = afterCount - beforeCount;
		if (delta === 0) continue;
		byTypeDelta[key] = delta;
		if (delta > 0) {
			increasedTypes.push({ type: key, delta });
			continue;
		}
		decreasedTypes.push({ type: key, delta });
	}
	return {
		totalDelta: after.total - before.total,
		byTypeDelta,
		increasedTypes,
		decreasedTypes,
	};
};

export const registerTrackedSkiaHostObject = (target: DisposableLike) => {
	if (!getTrackerConfigInternal().enabled) return;
	if (!canTrackTarget(target)) return;
	if (trackedSkiaHostObjects.has(target)) return;
	const type = resolveTrackedType(target);
	const id = ensureTrackedId(target);
	trackedSkiaHostObjects.add(target);
	updateTypeCount(type, 1);
	trackedSkiaHostObjectsById.set(id, {
		id,
		type,
		createdAtMs: Date.now(),
		refType: resolveTrackedRefType(target),
		creationStack: maybeCaptureCreationStack(),
	});
};

export const unregisterTrackedSkiaHostObject = (target: DisposableLike) => {
	if (!trackedSkiaHostObjects.delete(target)) return;
	const type = resolveTrackedType(target);
	updateTypeCount(type, -1);
	const id = getTrackedId(target);
	if (id !== null) {
		trackedSkiaHostObjectsById.delete(id);
	}
};

type TrackerWindowApi = {
	getConfig: () => SkiaResourceTrackerConfig;
	setConfig: (patch: Partial<SkiaResourceTrackerConfig>) => SkiaResourceTrackerConfig;
	getCount: () => number;
	getStats: () => TrackedSkiaHostObjectStats;
	capture: (
		options?: CaptureTrackedSkiaHostObjectSnapshotOptions,
	) => TrackedSkiaHostObjectSnapshot;
	diff: (
		before: TrackedSkiaHostObjectSnapshot,
		after: TrackedSkiaHostObjectSnapshot,
	) => TrackedSkiaHostObjectSnapshotDiff;
};

const installWindowTrackerApi = () => {
	if (!hasWindow()) return;
	const win = window as Window & {
		__SYNVAS_SKIA_RESOURCE_TRACKER__?: TrackerWindowApi;
	};
	if (win.__SYNVAS_SKIA_RESOURCE_TRACKER__) return;
	win.__SYNVAS_SKIA_RESOURCE_TRACKER__ = {
		getConfig: () => getSkiaResourceTrackerConfig(),
		setConfig: (patch) => setSkiaResourceTrackerConfig(patch),
		getCount: () => getTrackedSkiaHostObjectCount(),
		getStats: () => getTrackedSkiaHostObjectStats(),
		capture: (options) => captureTrackedSkiaHostObjectsSnapshot(options),
		diff: (before, after) => diffTrackedSkiaHostObjectSnapshots(before, after),
	};
};

installWindowTrackerApi();
