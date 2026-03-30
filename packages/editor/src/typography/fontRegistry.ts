import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import {
	type SkFont,
	Skia,
	type SkTypeface,
	type SkTypefaceFontProvider,
} from "react-skia-lite";

const PRIMARY_FONT_FAMILY = "Inter";
const PRIMARY_FONT_WEIGHT = 400;
const PRIMARY_LOCAL_SUBSET_URI = "/fonts/Inter-Latin-wght-normal.woff2";
const SECONDARY_FONT_FAMILY = "Noto Sans SC";
const SECONDARY_FONT_WEIGHT = 400;
const SECONDARY_LOCAL_SUBSET_URI = "/fonts/NotoSansSC-Base-400.woff2";
const APPLE_EMOJI_FAMILY = "Apple Color Emoji";
const APPLE_EMOJI_LOCAL_URI = "/fonts/AppleColorEmoji-Linux.ttf";
const COVERAGE_DEBOUNCE_MS = 120;
const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_FAILURE_COOLDOWN_MS = 10_000;
const MAX_TEXT_CHUNK_CODE_POINTS = 64;
const EMOJI_LIKE_CHAR_PATTERN = /\p{Extended_Pictographic}/u;

const FONT_CACHE_DB_NAME = "ai-nle-font-cache";
const FONT_CACHE_DB_VERSION = 1;
const FONT_CACHE_STORE = "fontSubset";

interface FontFamilyDescriptor {
	family: string;
	weight: number | null;
}

const PRIMARY_FONT_DESCRIPTOR: FontFamilyDescriptor = {
	family: PRIMARY_FONT_FAMILY,
	weight: PRIMARY_FONT_WEIGHT,
};

const SECONDARY_FONT_DESCRIPTOR: FontFamilyDescriptor = {
	family: SECONDARY_FONT_FAMILY,
	weight: SECONDARY_FONT_WEIGHT,
};

const APPLE_EMOJI_DESCRIPTOR: FontFamilyDescriptor = {
	family: APPLE_EMOJI_FAMILY,
	weight: null,
};

const FALLBACK_FONT_DESCRIPTORS: readonly FontFamilyDescriptor[] = [
	APPLE_EMOJI_DESCRIPTOR,
	{ family: SECONDARY_FONT_FAMILY, weight: 400 },
	{ family: "Noto Sans", weight: 400 },
	{ family: "Noto Sans JP", weight: 400 },
	{ family: "Noto Sans KR", weight: 400 },
	{ family: "Noto Color Emoji", weight: null },
];

export interface FontRegistryEnsureCoverageParams {
	text: string;
}

export interface RunPlan {
	text: string;
	fontFamilies: string[];
	status: "primary" | "fallback";
}

interface FontSubsetCacheRecord {
	key: string;
	family: string;
	weight: number | null;
	textHash: string;
	text: string;
	codePoints: number[];
	bytes: ArrayBuffer;
	updatedAt: number;
}

interface FontSubsetDbSchema extends DBSchema {
	fontSubset: {
		key: string;
		value: FontSubsetCacheRecord;
	};
}

interface LoadedSubsetResult {
	key: string;
	descriptorFamily: string;
	registeredFamily: string;
	codePoints: number[];
}

interface LoadedTypefaceEntry {
	typeface: SkTypeface;
	familyName: string;
}

const toSortedUniqueCodePoints = (text: string): number[] => {
	const unique = new Set<number>();
	for (const char of Array.from(text)) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) continue;
		// 控制字符不需要字体覆盖，且会导致远程子集请求返回 400。
		if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
			continue;
		}
		unique.add(codePoint);
	}
	return [...unique].sort((left, right) => left - right);
};

const codePointsToText = (codePoints: number[]): string => {
	let result = "";
	for (const codePoint of codePoints) {
		result += String.fromCodePoint(codePoint);
	}
	return result;
};

const hashText = (text: string): string => {
	let hash = 0x811c9dc5;
	for (const char of Array.from(text)) {
		const codePoint = char.codePointAt(0) ?? 0;
		hash ^= codePoint;
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
};

const buildSubsetKey = (
	descriptor: FontFamilyDescriptor,
	normalizedText: string,
): string => {
	const weightToken =
		descriptor.weight === null ? "default" : `${descriptor.weight}`;
	return `${descriptor.family}|${weightToken}|${hashText(normalizedText)}`;
};

const buildRegisteredFamilyName = (
	descriptor: FontFamilyDescriptor,
	key: string,
	isLocalBootstrap: boolean,
): string => {
	if (isLocalBootstrap) {
		return descriptor.family;
	}
	return `${descriptor.family}__${hashText(key)}`;
};

const chunkCodePoints = (
	codePoints: number[],
	chunkSize: number,
): number[][] => {
	if (codePoints.length <= chunkSize) {
		return [codePoints];
	}
	const chunks: number[][] = [];
	for (let index = 0; index < codePoints.length; index += chunkSize) {
		chunks.push(codePoints.slice(index, index + chunkSize));
	}
	return chunks;
};

const buildGoogleFontsCssUrl = (
	descriptor: FontFamilyDescriptor,
	text: string,
): string => {
	const familyToken = descriptor.family.trim().replace(/\s+/g, "+");
	const familySpec =
		descriptor.weight === null
			? familyToken
			: `${familyToken}:wght@${descriptor.weight}`;
	return `https://fonts.googleapis.com/css2?family=${familySpec}&display=swap&text=${encodeURIComponent(text)}`;
};

const parseFontSrcUrl = (cssText: string): string | null => {
	const matched = cssText.match(/src:\s*url\((['"]?)([^'")]+)\1\)/i);
	if (!matched) return null;
	return matched[2]?.trim() ?? null;
};

const fetchWithTimeout = async (
	url: string,
	timeoutMs: number,
): Promise<Response> => {
	if (typeof fetch !== "function") {
		throw new Error("fetch is not available");
	}
	const abortController =
		typeof AbortController === "function" ? new AbortController() : null;
	const timeoutId =
		abortController !== null
			? setTimeout(() => {
					abortController.abort();
				}, timeoutMs)
			: null;
	try {
		return await fetch(url, {
			signal: abortController?.signal,
		});
	} finally {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}
	}
};

const resolveNowMs = (): number => {
	if (
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
	) {
		return performance.now();
	}
	return Date.now();
};

const hasSameFontFamilies = (left: string[], right: string[]): boolean => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
};

const isRegionalIndicatorCodePoint = (codePoint: number): boolean => {
	return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
};

const isEmojiLikeCodePoint = (char: string, codePoint: number): boolean => {
	if (EMOJI_LIKE_CHAR_PATTERN.test(char)) {
		return true;
	}
	if (codePoint === 0xfe0f || codePoint === 0x200d || codePoint === 0x20e3) {
		return true;
	}
	return isRegionalIndicatorCodePoint(codePoint);
};

class FontRegistry {
	private listeners = new Set<() => void>();
	private provider: SkTypefaceFontProvider | null = null;
	private providerPromise: Promise<SkTypefaceFontProvider | null> | null = null;
	private bootstrapPromise: Promise<void> | null = null;
	private localSubsetLoaded = false;
	private localSecondarySubsetLoaded = false;
	private localAppleEmojiLoaded = false;

	private readonly primaryTypefaces: LoadedTypefaceEntry[] = [];
	private readonly fallbackTypefacesByFamily = new Map<
		string,
		LoadedTypefaceEntry[]
	>();
	private readonly unsupportedByFallbackFamily = new Map<string, Set<number>>();

	private readonly probeFontByTypeface = new WeakMap<SkTypeface, SkFont>();

	private readonly supportedByPrimary = new Set<number>();
	private readonly unsupportedByPrimary = new Set<number>();
	private readonly resolvedPrimaryFamilyByCodePoint = new Map<number, string>();
	private readonly resolvedFallbackFamilyByCodePoint = new Map<
		number,
		string
	>();

	private readonly pendingPrimaryCodePoints = new Set<number>();
	private coverageDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly flushResolvers: Array<() => void> = [];
	private isFlushingCoverage = false;

	private readonly requestInflightByKey = new Map<
		string,
		Promise<LoadedSubsetResult | null>
	>();
	private readonly requestFailedUntilByKey = new Map<string, number>();
	private readonly subsetMemoryCache = new Map<string, FontSubsetCacheRecord>();
	private readonly appliedSubsetKeys = new Set<string>();

	private fontCacheDbPromise: Promise<IDBPDatabase<FontSubsetDbSchema> | null> | null =
		null;

	private async ensureProvider(): Promise<SkTypefaceFontProvider | null> {
		if (this.provider) return this.provider;
		if (!this.providerPromise) {
			this.providerPromise = (async () => {
				const providerFactory = (
					Skia as {
						TypefaceFontProvider?: {
							Make?: () => SkTypefaceFontProvider;
						};
					}
				).TypefaceFontProvider;
				if (typeof providerFactory?.Make !== "function") {
					return null;
				}
				return providerFactory.Make();
			})();
		}
		const provider = await this.providerPromise;
		if (provider) {
			this.provider = provider;
		}
		return provider;
	}

	private rebindResolvedFallbackToAppleEmoji(): boolean {
		const loadedAppleFamily = buildRegisteredFamilyName(
			APPLE_EMOJI_DESCRIPTOR,
			"local-bootstrap",
			true,
		);
		const appleEntries =
			this.fallbackTypefacesByFamily.get(APPLE_EMOJI_FAMILY) ?? [];
		if (appleEntries.length === 0) {
			return false;
		}
		let changed = false;
		for (const [codePoint, resolvedFamily] of this
			.resolvedFallbackFamilyByCodePoint) {
			const char = String.fromCodePoint(codePoint);
			const matchedAppleFamily = this.findFallbackFamilyForChar(
				APPLE_EMOJI_FAMILY,
				char,
			);
			if (!matchedAppleFamily) {
				continue;
			}
			if (resolvedFamily !== loadedAppleFamily) {
				this.resolvedFallbackFamilyByCodePoint.set(
					codePoint,
					loadedAppleFamily,
				);
				changed = true;
			}
		}
		return changed;
	}

	private async ensureBootstrap(): Promise<void> {
		if (this.bootstrapPromise) {
			await this.bootstrapPromise;
			return;
		}
		this.bootstrapPromise = (async () => {
			const provider = await this.ensureProvider();
			if (!provider) {
				return;
			}
			let hasStateChanged = false;
			if (!this.localSubsetLoaded) {
				const typeface = await this.loadTypefaceFromUri(
					PRIMARY_LOCAL_SUBSET_URI,
				);
				if (typeface) {
					const registeredFamily = buildRegisteredFamilyName(
						PRIMARY_FONT_DESCRIPTOR,
						"local-bootstrap",
						true,
					);
					provider.registerFont(typeface, registeredFamily);
					this.primaryTypefaces.push({
						typeface,
						familyName: registeredFamily,
					});
					this.localSubsetLoaded = true;
					hasStateChanged = true;
				}
			}
			if (!this.localSecondarySubsetLoaded) {
				const typeface = await this.loadTypefaceFromUri(
					SECONDARY_LOCAL_SUBSET_URI,
				);
				if (typeface) {
					const registeredFamily = buildRegisteredFamilyName(
						SECONDARY_FONT_DESCRIPTOR,
						"local-bootstrap",
						true,
					);
					provider.registerFont(typeface, registeredFamily);
					const familyTypefaces =
						this.fallbackTypefacesByFamily.get(SECONDARY_FONT_FAMILY) ?? [];
					familyTypefaces.push({
						typeface,
						familyName: registeredFamily,
					});
					this.fallbackTypefacesByFamily.set(
						SECONDARY_FONT_FAMILY,
						familyTypefaces,
					);
					this.getUnsupportedSetForFallbackFamily(SECONDARY_FONT_FAMILY).clear();
					this.localSecondarySubsetLoaded = true;
					hasStateChanged = true;
				}
			}
			if (!this.localAppleEmojiLoaded) {
				const typeface = await this.loadTypefaceFromUri(APPLE_EMOJI_LOCAL_URI);
				if (typeface) {
					const registeredFamily = buildRegisteredFamilyName(
						APPLE_EMOJI_DESCRIPTOR,
						"local-bootstrap",
						true,
					);
					provider.registerFont(typeface, registeredFamily);
					const familyTypefaces =
						this.fallbackTypefacesByFamily.get(APPLE_EMOJI_FAMILY) ?? [];
					familyTypefaces.push({
						typeface,
						familyName: registeredFamily,
					});
					this.fallbackTypefacesByFamily.set(
						APPLE_EMOJI_FAMILY,
						familyTypefaces,
					);
					this.getUnsupportedSetForFallbackFamily(APPLE_EMOJI_FAMILY).clear();
					this.localAppleEmojiLoaded = true;
					hasStateChanged = true;
				}
			}
			if (this.rebindResolvedFallbackToAppleEmoji()) {
				hasStateChanged = true;
			}
			if (hasStateChanged) {
				this.notifySubscribers();
			}
		})();
		try {
			await this.bootstrapPromise;
		} finally {
			this.bootstrapPromise = null;
		}
	}

	private async loadTypefaceFromUri(uri: string): Promise<SkTypeface | null> {
		const dataFactory = (
			Skia as {
				Data?: {
					fromURI?: (value: string) => Promise<unknown>;
				};
			}
		).Data;
		const typefaceFactory = (
			Skia as {
				Typeface?: {
					MakeFreeTypeFaceFromData?: (data: unknown) => SkTypeface | null;
				};
			}
		).Typeface;
		if (
			typeof dataFactory?.fromURI !== "function" ||
			typeof typefaceFactory?.MakeFreeTypeFaceFromData !== "function"
		) {
			return null;
		}
		try {
			const data = await dataFactory.fromURI(uri);
			return typefaceFactory.MakeFreeTypeFaceFromData(data) ?? null;
		} catch (error) {
			console.warn("[FontRegistry] Failed to load local subset font:", error);
			return null;
		}
	}

	private createTypefaceFromBytes(bytes: ArrayBuffer): SkTypeface | null {
		const dataFactory = (
			Skia as {
				Data?: {
					fromBytes?: (value: Uint8Array) => unknown;
				};
			}
		).Data;
		const typefaceFactory = (
			Skia as {
				Typeface?: {
					MakeFreeTypeFaceFromData?: (data: unknown) => SkTypeface | null;
				};
			}
		).Typeface;
		if (typeof typefaceFactory?.MakeFreeTypeFaceFromData !== "function") {
			return null;
		}
		try {
			const fontData =
				typeof dataFactory?.fromBytes === "function"
					? dataFactory.fromBytes(new Uint8Array(bytes))
					: bytes;
			return typefaceFactory.MakeFreeTypeFaceFromData(fontData) ?? null;
		} catch (error) {
			console.warn(
				"[FontRegistry] Failed to create typeface from bytes:",
				error,
			);
			return null;
		}
	}

	private getProbeFont(typeface: SkTypeface): SkFont | null {
		const cached = this.probeFontByTypeface.get(typeface);
		if (cached) return cached;
		try {
			const font = Skia.Font(typeface, 16);
			font.setLinearMetrics(true);
			font.setSubpixel(true);
			this.probeFontByTypeface.set(typeface, font);
			return font;
		} catch (error) {
			console.warn("[FontRegistry] Failed to create probe font:", error);
			return null;
		}
	}

	private hasGlyphInTypeface(typeface: SkTypeface, char: string): boolean {
		const font = this.getProbeFont(typeface);
		if (!font) return false;
		try {
			const glyphIDs = font.getGlyphIDs(char);
			return (glyphIDs[0] ?? 0) > 0;
		} catch {
			return false;
		}
	}

	private findGlyphFamilyInTypefaceEntries(
		entries: LoadedTypefaceEntry[],
		char: string,
	): string | null {
		for (const entry of entries) {
			if (this.hasGlyphInTypeface(entry.typeface, char)) {
				return entry.familyName;
			}
		}
		return null;
	}

	private findPrimaryFamilyForChar(char: string): string | null {
		return this.findGlyphFamilyInTypefaceEntries(this.primaryTypefaces, char);
	}

	private findFallbackFamilyForChar(
		descriptorFamily: string,
		char: string,
	): string | null {
		const entries = this.fallbackTypefacesByFamily.get(descriptorFamily) ?? [];
		return this.findGlyphFamilyInTypefaceEntries(entries, char);
	}

	private findLoadedFallbackFamilyForChar(char: string): string | null {
		for (const descriptor of FALLBACK_FONT_DESCRIPTORS) {
			const matchedFamily = this.findFallbackFamilyForChar(
				descriptor.family,
				char,
			);
			if (matchedFamily) {
				return matchedFamily;
			}
		}
		return null;
	}

	private getUnsupportedSetForFallbackFamily(family: string): Set<number> {
		const existing = this.unsupportedByFallbackFamily.get(family);
		if (existing) return existing;
		const created = new Set<number>();
		this.unsupportedByFallbackFamily.set(family, created);
		return created;
	}

	private collectUnresolvedUnsupportedCodePoints(): number[] {
		const unresolved: number[] = [];
		for (const codePoint of this.unsupportedByPrimary) {
			if (this.resolvedFallbackFamilyByCodePoint.has(codePoint)) {
				continue;
			}
			unresolved.push(codePoint);
		}
		return unresolved;
	}

	private async getFontCacheDb(): Promise<IDBPDatabase<FontSubsetDbSchema> | null> {
		if (this.fontCacheDbPromise) {
			return this.fontCacheDbPromise;
		}
		if (typeof indexedDB === "undefined") {
			this.fontCacheDbPromise = Promise.resolve(null);
			return this.fontCacheDbPromise;
		}
		this.fontCacheDbPromise = openDB<FontSubsetDbSchema>(
			FONT_CACHE_DB_NAME,
			FONT_CACHE_DB_VERSION,
			{
				upgrade(db) {
					if (!db.objectStoreNames.contains(FONT_CACHE_STORE)) {
						db.createObjectStore(FONT_CACHE_STORE, { keyPath: "key" });
					}
				},
			},
		).catch((error) => {
			console.warn("[FontRegistry] Failed to open font cache db:", error);
			return null;
		});
		return this.fontCacheDbPromise;
	}

	private async readSubsetRecord(
		key: string,
	): Promise<FontSubsetCacheRecord | null> {
		const memoryRecord = this.subsetMemoryCache.get(key);
		if (memoryRecord) {
			return memoryRecord;
		}
		const db = await this.getFontCacheDb();
		if (!db) return null;
		try {
			const record = await db.get(FONT_CACHE_STORE, key);
			if (!record) return null;
			this.subsetMemoryCache.set(key, record);
			return record;
		} catch (error) {
			console.warn("[FontRegistry] Failed to read font cache record:", error);
			return null;
		}
	}

	private async writeSubsetRecord(
		record: FontSubsetCacheRecord,
	): Promise<void> {
		this.subsetMemoryCache.set(record.key, record);
		const db = await this.getFontCacheDb();
		if (!db) return;
		try {
			await db.put(FONT_CACHE_STORE, record);
		} catch (error) {
			console.warn("[FontRegistry] Failed to write font cache record:", error);
		}
	}

	private async fetchSubsetRecord(
		descriptor: FontFamilyDescriptor,
		normalizedText: string,
		codePoints: number[],
		key: string,
	): Promise<FontSubsetCacheRecord | null> {
		const cssUrl = buildGoogleFontsCssUrl(descriptor, normalizedText);
		const cssResponse = await fetchWithTimeout(cssUrl, REQUEST_TIMEOUT_MS);
		if (!cssResponse.ok) {
			throw new Error(
				`Font CSS request failed with status ${cssResponse.status}`,
			);
		}
		const cssText = await cssResponse.text();
		const fontUrl = parseFontSrcUrl(cssText);
		if (!fontUrl) {
			throw new Error("Font CSS response does not contain src url");
		}
		const fontResponse = await fetchWithTimeout(fontUrl, REQUEST_TIMEOUT_MS);
		if (!fontResponse.ok) {
			throw new Error(
				`Font file request failed with status ${fontResponse.status}`,
			);
		}
		const bytes = await fontResponse.arrayBuffer();
		const record: FontSubsetCacheRecord = {
			key,
			family: descriptor.family,
			weight: descriptor.weight,
			textHash: hashText(normalizedText),
			text: normalizedText,
			codePoints,
			bytes,
			updatedAt: Date.now(),
		};
		await this.writeSubsetRecord(record);
		return record;
	}

	private async loadSubsetForDescriptor(
		descriptor: FontFamilyDescriptor,
		text: string,
	): Promise<LoadedSubsetResult | null> {
		const codePoints = toSortedUniqueCodePoints(text);
		if (codePoints.length === 0) {
			return null;
		}
		const normalizedText = codePointsToText(codePoints);
		const key = buildSubsetKey(descriptor, normalizedText);
		if (this.appliedSubsetKeys.has(key)) {
			return {
				key,
				descriptorFamily: descriptor.family,
				registeredFamily: buildRegisteredFamilyName(descriptor, key, false),
				codePoints,
			};
		}

		const failedUntil = this.requestFailedUntilByKey.get(key) ?? 0;
		if (failedUntil > resolveNowMs()) {
			return null;
		}

		const inflight = this.requestInflightByKey.get(key);
		if (inflight) {
			return inflight;
		}

		const requestPromise = (async (): Promise<LoadedSubsetResult | null> => {
			try {
				let subsetRecord = await this.readSubsetRecord(key);
				if (!subsetRecord) {
					subsetRecord = await this.fetchSubsetRecord(
						descriptor,
						normalizedText,
						codePoints,
						key,
					);
				}
				if (!subsetRecord) {
					return null;
				}
				const provider = await this.ensureProvider();
				if (!provider) {
					return null;
				}
				const typeface = this.createTypefaceFromBytes(subsetRecord.bytes);
				if (!typeface) {
					return null;
				}
				const registeredFamily = buildRegisteredFamilyName(
					descriptor,
					key,
					false,
				);

				provider.registerFont(typeface, registeredFamily);
				if (descriptor.family === PRIMARY_FONT_FAMILY) {
					this.primaryTypefaces.push({
						typeface,
						familyName: registeredFamily,
					});
				} else {
					const familyTypefaces =
						this.fallbackTypefacesByFamily.get(descriptor.family) ?? [];
					familyTypefaces.push({
						typeface,
						familyName: registeredFamily,
					});
					this.fallbackTypefacesByFamily.set(
						descriptor.family,
						familyTypefaces,
					);
				}
				this.appliedSubsetKeys.add(key);
				this.requestFailedUntilByKey.delete(key);
				return {
					key,
					descriptorFamily: descriptor.family,
					registeredFamily,
					codePoints,
				};
			} catch (error) {
				this.requestFailedUntilByKey.set(
					key,
					resolveNowMs() + REQUEST_FAILURE_COOLDOWN_MS,
				);
				console.warn("[FontRegistry] Failed to load font subset:", error);
				return null;
			}
		})();

		this.requestInflightByKey.set(key, requestPromise);
		const result = await requestPromise;
		this.requestInflightByKey.delete(key);
		return result;
	}

	private scheduleCoverageFlush(): Promise<void> {
		return new Promise((resolve) => {
			this.flushResolvers.push(resolve);
			if (this.coverageDebounceTimer !== null) {
				return;
			}
			this.coverageDebounceTimer = setTimeout(() => {
				this.coverageDebounceTimer = null;
				void this.flushCoverageNow().catch((error) => {
					console.warn("[FontRegistry] Coverage flush failed:", error);
				});
			}, COVERAGE_DEBOUNCE_MS);
		});
	}

	private resolveFlushWaiters() {
		const resolvers = [...this.flushResolvers];
		this.flushResolvers.length = 0;
		for (const resolve of resolvers) {
			resolve();
		}
	}

	private async flushCoverageNow(): Promise<void> {
		if (this.isFlushingCoverage) {
			return;
		}
		this.isFlushingCoverage = true;
		let hasStateChanged = false;
		try {
			const pendingPrimaryCodePoints = [...this.pendingPrimaryCodePoints];
			this.pendingPrimaryCodePoints.clear();
			if (pendingPrimaryCodePoints.length > 0) {
				const changed = await this.resolvePrimaryCoverageForCodePoints(
					pendingPrimaryCodePoints,
				);
				hasStateChanged = hasStateChanged || changed;
			}
			const fallbackChanged =
				await this.resolveFallbackCoverageForUnsupportedCodePoints();
			hasStateChanged = hasStateChanged || fallbackChanged;
		} finally {
			this.isFlushingCoverage = false;
			this.resolveFlushWaiters();
		}

		if (hasStateChanged) {
			this.notifySubscribers();
		}
		if (this.pendingPrimaryCodePoints.size > 0) {
			void this.scheduleCoverageFlush();
		}
	}

	private async resolvePrimaryCoverageForCodePoints(
		codePoints: number[],
	): Promise<boolean> {
		let hasStateChanged = false;
		const codePointsNeedingFetch: number[] = [];

		for (const codePoint of codePoints) {
			if (this.supportedByPrimary.has(codePoint)) continue;
			if (this.unsupportedByPrimary.has(codePoint)) continue;
			const char = String.fromCodePoint(codePoint);
			const matchedPrimaryFamily = this.findPrimaryFamilyForChar(char);
			if (matchedPrimaryFamily) {
				this.supportedByPrimary.add(codePoint);
				this.resolvedPrimaryFamilyByCodePoint.set(
					codePoint,
					matchedPrimaryFamily,
				);
				hasStateChanged = true;
				continue;
			}
			codePointsNeedingFetch.push(codePoint);
		}

		if (codePointsNeedingFetch.length === 0) {
			return hasStateChanged;
		}

		for (const chunk of chunkCodePoints(
			codePointsNeedingFetch,
			MAX_TEXT_CHUNK_CODE_POINTS,
		)) {
			const chunkText = codePointsToText(chunk);
			const loadedSubset = await this.loadSubsetForDescriptor(
				PRIMARY_FONT_DESCRIPTOR,
				chunkText,
			);
			if (!loadedSubset) {
				for (const codePoint of chunk) {
					if (!this.unsupportedByPrimary.has(codePoint)) {
						this.unsupportedByPrimary.add(codePoint);
						hasStateChanged = true;
					}
				}
				continue;
			}
			for (const codePoint of loadedSubset.codePoints) {
				const char = String.fromCodePoint(codePoint);
				const matchedPrimaryFamily = this.findPrimaryFamilyForChar(char);
				if (matchedPrimaryFamily) {
					if (!this.supportedByPrimary.has(codePoint)) {
						this.supportedByPrimary.add(codePoint);
						hasStateChanged = true;
					}
					if (
						this.resolvedPrimaryFamilyByCodePoint.get(codePoint) !==
						matchedPrimaryFamily
					) {
						this.resolvedPrimaryFamilyByCodePoint.set(
							codePoint,
							matchedPrimaryFamily,
						);
						hasStateChanged = true;
					}
					continue;
				}
				if (!this.unsupportedByPrimary.has(codePoint)) {
					this.unsupportedByPrimary.add(codePoint);
					hasStateChanged = true;
				}
			}
		}

		return hasStateChanged;
	}

	private async resolveFallbackCoverageForUnsupportedCodePoints(): Promise<boolean> {
		let hasStateChanged = false;
		let unresolvedCodePoints = this.collectUnresolvedUnsupportedCodePoints();
		if (unresolvedCodePoints.length === 0) {
			return false;
		}

		for (const codePoint of unresolvedCodePoints) {
			const char = String.fromCodePoint(codePoint);
			const resolvedFamily = this.findLoadedFallbackFamilyForChar(char);
			if (!resolvedFamily) continue;
			if (
				this.resolvedFallbackFamilyByCodePoint.get(codePoint) !== resolvedFamily
			) {
				this.resolvedFallbackFamilyByCodePoint.set(codePoint, resolvedFamily);
				hasStateChanged = true;
			}
		}

		unresolvedCodePoints = this.collectUnresolvedUnsupportedCodePoints();
		if (unresolvedCodePoints.length === 0) {
			return hasStateChanged;
		}

		for (const descriptor of FALLBACK_FONT_DESCRIPTORS) {
			const unsupportedByFamily = this.getUnsupportedSetForFallbackFamily(
				descriptor.family,
			);
			const eligibleCodePoints = unresolvedCodePoints.filter((codePoint) => {
				if (this.resolvedFallbackFamilyByCodePoint.has(codePoint)) {
					return false;
				}
				return !unsupportedByFamily.has(codePoint);
			});
			if (eligibleCodePoints.length === 0) {
				continue;
			}
			if (descriptor.family === APPLE_EMOJI_FAMILY) {
				for (const codePoint of eligibleCodePoints) {
					unsupportedByFamily.add(codePoint);
				}
				continue;
			}

			for (const chunk of chunkCodePoints(
				eligibleCodePoints,
				MAX_TEXT_CHUNK_CODE_POINTS,
			)) {
				const chunkText = codePointsToText(chunk);
				const loadedSubset = await this.loadSubsetForDescriptor(
					descriptor,
					chunkText,
				);
				if (!loadedSubset) {
					continue;
				}
				for (const codePoint of loadedSubset.codePoints) {
					if (this.resolvedFallbackFamilyByCodePoint.has(codePoint)) {
						continue;
					}
					const char = String.fromCodePoint(codePoint);
					const matchedFallbackFamily = this.findFallbackFamilyForChar(
						descriptor.family,
						char,
					);
					if (matchedFallbackFamily) {
						this.resolvedFallbackFamilyByCodePoint.set(
							codePoint,
							matchedFallbackFamily,
						);
						hasStateChanged = true;
						continue;
					}
					if (!unsupportedByFamily.has(codePoint)) {
						unsupportedByFamily.add(codePoint);
						hasStateChanged = true;
					}
				}
			}

			unresolvedCodePoints = this.collectUnresolvedUnsupportedCodePoints();
			if (unresolvedCodePoints.length === 0) {
				break;
			}
		}

		return hasStateChanged;
	}

	private notifySubscribers() {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.warn("[FontRegistry] subscriber callback failed:", error);
			}
		}
	}

	async ensureCoverage(
		params: FontRegistryEnsureCoverageParams,
	): Promise<void> {
		const text = params.text ?? "";
		await this.ensureBootstrap();

		const codePoints = toSortedUniqueCodePoints(text);
		let hasStateChanged = false;
		for (const codePoint of codePoints) {
			if (this.supportedByPrimary.has(codePoint)) continue;
			if (this.unsupportedByPrimary.has(codePoint)) continue;
			if (this.resolvedFallbackFamilyByCodePoint.has(codePoint)) continue;
			const char = String.fromCodePoint(codePoint);
			const matchedPrimaryFamily = this.findPrimaryFamilyForChar(char);
			if (matchedPrimaryFamily) {
				this.supportedByPrimary.add(codePoint);
				this.resolvedPrimaryFamilyByCodePoint.set(
					codePoint,
					matchedPrimaryFamily,
				);
				hasStateChanged = true;
				continue;
			}
			this.pendingPrimaryCodePoints.add(codePoint);
		}
		if (hasStateChanged) {
			this.notifySubscribers();
		}

		if (
			this.pendingPrimaryCodePoints.size <= 0 &&
			this.collectUnresolvedUnsupportedCodePoints().length <= 0
		) {
			return;
		}

		await this.scheduleCoverageFlush();
	}

	getParagraphRunPlan(text: string): RunPlan[] {
		if (!text) return [];
		const runs: RunPlan[] = [];
		let currentText = "";
		let currentFontFamilies: string[] | null = null;
		let currentStatus: "primary" | "fallback" = "primary";

		for (const char of Array.from(text)) {
			const codePoint = char.codePointAt(0);
			const primaryFamily =
				codePoint === undefined
					? PRIMARY_FONT_FAMILY
					: (this.resolvedPrimaryFamilyByCodePoint.get(codePoint) ??
						PRIMARY_FONT_FAMILY);
			const fallbackFamily =
				codePoint === undefined
					? null
					: (this.resolvedFallbackFamilyByCodePoint.get(codePoint) ?? null);
			const nextFontFamilies = fallbackFamily
				? [primaryFamily, fallbackFamily]
				: [primaryFamily];
			const shouldPreferAppleEmoji =
				codePoint !== undefined &&
				this.localAppleEmojiLoaded &&
				isEmojiLikeCodePoint(char, codePoint);
			if (shouldPreferAppleEmoji) {
				const resolvedAppleFamily =
					this.findFallbackFamilyForChar(APPLE_EMOJI_FAMILY, char) ??
					APPLE_EMOJI_FAMILY;
				const existingAppleIndex =
					nextFontFamilies.indexOf(resolvedAppleFamily);
				if (existingAppleIndex === -1) {
					nextFontFamilies.unshift(resolvedAppleFamily);
				} else if (existingAppleIndex > 0) {
					nextFontFamilies.splice(existingAppleIndex, 1);
					nextFontFamilies.unshift(resolvedAppleFamily);
				}
			}
			const nextStatus: "primary" | "fallback" =
				nextFontFamilies.length > 1 ? "fallback" : "primary";

			if (
				currentFontFamilies === null ||
				!hasSameFontFamilies(currentFontFamilies, nextFontFamilies)
			) {
				if (currentText.length > 0 && currentFontFamilies !== null) {
					runs.push({
						text: currentText,
						fontFamilies: currentFontFamilies,
						status: currentStatus,
					});
				}
				currentText = char;
				currentFontFamilies = nextFontFamilies;
				currentStatus = nextStatus;
				continue;
			}
			currentText += char;
		}

		if (currentText.length > 0 && currentFontFamilies !== null) {
			runs.push({
				text: currentText,
				fontFamilies: currentFontFamilies,
				status: currentStatus,
			});
		}
		return runs;
	}

	async getFontProvider(): Promise<SkTypefaceFontProvider | null> {
		await this.ensureBootstrap();
		return this.provider;
	}

	getPrimaryTypeface(): SkTypeface | null {
		return this.primaryTypefaces[0]?.typeface ?? null;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	resetForTests() {
		if (this.coverageDebounceTimer !== null) {
			clearTimeout(this.coverageDebounceTimer);
			this.coverageDebounceTimer = null;
		}
		this.resolveFlushWaiters();
		this.listeners.clear();
		this.supportedByPrimary.clear();
		this.unsupportedByPrimary.clear();
		this.resolvedPrimaryFamilyByCodePoint.clear();
		this.resolvedFallbackFamilyByCodePoint.clear();
		this.unsupportedByFallbackFamily.clear();
		this.pendingPrimaryCodePoints.clear();
		this.requestInflightByKey.clear();
		this.requestFailedUntilByKey.clear();
		this.subsetMemoryCache.clear();
		this.appliedSubsetKeys.clear();
		this.primaryTypefaces.length = 0;
		this.fallbackTypefacesByFamily.clear();
		this.provider = null;
		this.providerPromise = null;
		this.bootstrapPromise = null;
		this.localSubsetLoaded = false;
		this.localSecondarySubsetLoaded = false;
		this.localAppleEmojiLoaded = false;
		this.isFlushingCoverage = false;
		this.fontCacheDbPromise = null;
	}
}

export const fontRegistry = new FontRegistry();

export const __resetFontRegistryForTests = (): void => {
	fontRegistry.resetForTests();
};

export const FONT_REGISTRY_PRIMARY_FAMILY = PRIMARY_FONT_FAMILY;
