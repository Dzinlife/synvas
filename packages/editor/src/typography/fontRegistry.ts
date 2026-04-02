import {
	scheduleSkiaDispose,
	Skia,
	type SkTypeface,
	type SkTypefaceFontProvider,
} from "react-skia-lite";

const PRIMARY_FONT_FAMILY = "Inter";
const SECONDARY_FONT_FAMILY = "Noto Sans SC";
const APPLE_EMOJI_FAMILY = "Apple Color Emoji";

const PRIMARY_LOCAL_FONT_URI = "/fonts/Inter-Latin-wght-normal.woff2";
const SECONDARY_LOCAL_FONT_URI = "/fonts/NotoSansSC-Base-400.woff2";
const APPLE_EMOJI_LOCAL_URI = "/fonts/AppleColorEmoji-Linux.ttf";

const REQUEST_TIMEOUT_MS = 8_000;
const EMOJI_LIKE_CHAR_PATTERN = /\p{Extended_Pictographic}/u;

export type FontLanguage = "latin" | "cjk" | "emoji";

export interface FontSourceUrl {
	kind: "url";
	url: string;
	provider: "local" | "google" | "custom";
}

export interface FontDefinition {
	id: string;
	family: string;
	languages: FontLanguage[];
	source: FontSourceUrl;
	weight?: number | null;
	style?: "normal" | "italic";
	priority?: number;
}

export interface FontRegistryResolveOptions {
	fallbackChain?: string[];
}

export interface FontRegistryEnsureCoverageParams
	extends FontRegistryResolveOptions {
	text: string;
}

export interface RunPlan {
	text: string;
	fontFamilies: string[];
	status: "primary" | "fallback";
}

const hasSameFontFamilies = (left: string[], right: string[]): boolean => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
};

const normalizeFamilyName = (value: string): string => value.trim();

const sanitizeLanguageList = (value: FontLanguage[]): FontLanguage[] => {
	const resolved: FontLanguage[] = [];
	const seen = new Set<FontLanguage>();
	for (const language of value) {
		if (
			language !== "latin" &&
			language !== "cjk" &&
			language !== "emoji"
		) {
			continue;
		}
		if (seen.has(language)) continue;
		seen.add(language);
		resolved.push(language);
	}
	return resolved;
};

const normalizeFontDefinition = (definition: FontDefinition): FontDefinition | null => {
	const id = definition.id.trim();
	const family = normalizeFamilyName(definition.family);
	const sourceUrl = definition.source.url.trim();
	if (!id || !family || !sourceUrl) {
		return null;
	}
	const languages = sanitizeLanguageList(definition.languages);
	if (languages.length <= 0) {
		return null;
	}
	return {
		id,
		family,
		languages,
		source: {
			kind: "url",
			provider: definition.source.provider,
			url: sourceUrl,
		},
		priority:
			typeof definition.priority === "number" && Number.isFinite(definition.priority)
				? definition.priority
				: 0,
		style: definition.style,
		weight: definition.weight,
	};
};

const isControlCodePoint = (codePoint: number): boolean => {
	return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
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

const isCjkCodePoint = (codePoint: number): boolean => {
	if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return true;
	if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return true;
	if (codePoint >= 0xf900 && codePoint <= 0xfaff) return true;
	if (codePoint >= 0x2e80 && codePoint <= 0x2fdf) return true;
	if (codePoint >= 0x3000 && codePoint <= 0x303f) return true;
	if (codePoint >= 0x3040 && codePoint <= 0x309f) return true;
	if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return true;
	if (codePoint >= 0x31f0 && codePoint <= 0x31ff) return true;
	if (codePoint >= 0x3100 && codePoint <= 0x312f) return true;
	if (codePoint >= 0x3130 && codePoint <= 0x318f) return true;
	if (codePoint >= 0xac00 && codePoint <= 0xd7af) return true;
	if (codePoint >= 0x1100 && codePoint <= 0x11ff) return true;
	if (codePoint >= 0xff00 && codePoint <= 0xffef) return true;
	if (codePoint >= 0x20000 && codePoint <= 0x2a6df) return true;
	if (codePoint >= 0x2a700 && codePoint <= 0x2b73f) return true;
	if (codePoint >= 0x2b740 && codePoint <= 0x2b81f) return true;
	if (codePoint >= 0x2b820 && codePoint <= 0x2ceaf) return true;
	if (codePoint >= 0x2ceb0 && codePoint <= 0x2ebef) return true;
	if (codePoint >= 0x2f800 && codePoint <= 0x2fa1f) return true;
	return false;
};

const classifyCharLanguage = (char: string, codePoint: number): FontLanguage => {
	if (isEmojiLikeCodePoint(char, codePoint)) {
		return "emoji";
	}
	if (isCjkCodePoint(codePoint)) {
		return "cjk";
	}
	return "latin";
};

const collectLanguagesFromText = (text: string): Set<FontLanguage> => {
	const languages = new Set<FontLanguage>();
	for (const char of Array.from(text)) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined || isControlCodePoint(codePoint)) {
			continue;
		}
		languages.add(classifyCharLanguage(char, codePoint));
	}
	return languages;
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

const createDefaultFontDefinitions = (): FontDefinition[] => {
	return [
		{
			id: "default-inter",
			family: PRIMARY_FONT_FAMILY,
			languages: ["latin"],
			source: {
				kind: "url",
				provider: "local",
				url: PRIMARY_LOCAL_FONT_URI,
			},
			weight: 400,
			style: "normal",
			priority: 0,
		},
		{
			id: "default-noto-sans-sc",
			family: SECONDARY_FONT_FAMILY,
			languages: ["cjk"],
			source: {
				kind: "url",
				provider: "local",
				url: SECONDARY_LOCAL_FONT_URI,
			},
			weight: 400,
			style: "normal",
			priority: 0,
		},
		{
			id: "default-apple-color-emoji",
			family: APPLE_EMOJI_FAMILY,
			languages: ["emoji"],
			source: {
				kind: "url",
				provider: "local",
				url: APPLE_EMOJI_LOCAL_URI,
			},
			weight: null,
			style: "normal",
			priority: 0,
		},
	];
};

const DEFAULT_FALLBACK_CHAIN = [
	PRIMARY_FONT_FAMILY,
	SECONDARY_FONT_FAMILY,
	APPLE_EMOJI_FAMILY,
];

const scheduleDisposableRelease = (target: unknown) => {
	if (!target || typeof target !== "object") return;
	const disposable = target as {
		dispose?: (() => void) | undefined;
		delete?: (() => void) | undefined;
	};
	if (
		typeof disposable.dispose !== "function" &&
		typeof disposable.delete !== "function"
	) {
		return;
	}
	scheduleSkiaDispose(disposable, { timing: "manual" });
};

class FontRegistry {
	private listeners = new Set<() => void>();
	private provider: SkTypefaceFontProvider | null = null;
	private providerPromise: Promise<SkTypefaceFontProvider | null> | null = null;
	private primaryTypeface: SkTypeface | null = null;
	private providerEpoch = 0;
	private readonly registeredTypefaces = new Set<SkTypeface>();

	private readonly definitionsById = new Map<string, FontDefinition>();
	private readonly definitionsByFamily = new Map<string, FontDefinition[]>();
	private defaultFallbackChain = [...DEFAULT_FALLBACK_CHAIN];

	private readonly loadedDefinitionIds = new Set<string>();
	private readonly loadInflightByDefinitionId = new Map<string, Promise<boolean>>();

	constructor() {
		this.resetDefinitionsToDefault();
	}

	private sortDefinitions(definitions: FontDefinition[]): FontDefinition[] {
		return [...definitions].sort((left, right) => {
			const leftPriority = left.priority ?? 0;
			const rightPriority = right.priority ?? 0;
			if (leftPriority !== rightPriority) {
				return leftPriority - rightPriority;
			}
			return left.id.localeCompare(right.id);
		});
	}

	private rebuildFamilyIndex() {
		this.definitionsByFamily.clear();
		for (const definition of this.definitionsById.values()) {
			const family = normalizeFamilyName(definition.family);
			const familyDefinitions = this.definitionsByFamily.get(family) ?? [];
			familyDefinitions.push(definition);
			this.definitionsByFamily.set(family, familyDefinitions);
		}
		for (const [family, definitions] of this.definitionsByFamily) {
			this.definitionsByFamily.set(family, this.sortDefinitions(definitions));
		}
	}

	private sanitizeFallbackChain(chain?: string[]): string[] {
		const baseChain =
			chain && chain.length > 0 ? chain : this.defaultFallbackChain;
		const resolved: string[] = [];
		const seen = new Set<string>();
		for (const family of baseChain) {
			if (typeof family !== "string") continue;
			const normalized = normalizeFamilyName(family);
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			resolved.push(normalized);
		}
		if (resolved.length > 0) {
			return resolved;
		}
		return [...DEFAULT_FALLBACK_CHAIN];
	}

	private resolveDefinitionsForCoverage(
		languages: Set<FontLanguage>,
		fallbackChain: string[],
	): FontDefinition[] {
		const resolved: FontDefinition[] = [];
		const seen = new Set<string>();
		for (const family of fallbackChain) {
			const definitions = this.definitionsByFamily.get(family) ?? [];
			for (const definition of definitions) {
				const hasLanguageMatch = definition.languages.some((language) => {
					return languages.has(language);
				});
				if (!hasLanguageMatch) {
					continue;
				}
				if (seen.has(definition.id)) {
					continue;
				}
				seen.add(definition.id);
				resolved.push(definition);
				break;
			}
		}
		return resolved;
	}

	private resetProviderState() {
		for (const typeface of this.registeredTypefaces) {
			scheduleDisposableRelease(typeface);
		}
		this.registeredTypefaces.clear();
		scheduleDisposableRelease(this.provider);
		this.provider = null;
		this.providerPromise = null;
		this.primaryTypeface = null;
		this.providerEpoch += 1;
		this.loadedDefinitionIds.clear();
		this.loadInflightByDefinitionId.clear();
	}

	private resetDefinitionsToDefault() {
		this.definitionsById.clear();
		for (const definition of createDefaultFontDefinitions()) {
			this.definitionsById.set(definition.id, definition);
		}
		this.rebuildFamilyIndex();
		this.defaultFallbackChain = [...DEFAULT_FALLBACK_CHAIN];
	}

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
			try {
				return typefaceFactory.MakeFreeTypeFaceFromData(fontData) ?? null;
			} finally {
				scheduleSkiaDispose(
					fontData as {
						dispose?: (() => void) | undefined;
						delete?: (() => void) | undefined;
					},
					{ timing: "animationFrame" },
				);
			}
		} catch (error) {
			console.warn(
				"[FontRegistry] Failed to create typeface from bytes:",
				error,
			);
			return null;
		}
	}

	private async fetchFontBytes(url: string): Promise<ArrayBuffer> {
		const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
		if (!response.ok) {
			throw new Error(`Font request failed with status ${response.status}`);
		}
		return response.arrayBuffer();
	}

	private async loadFontDefinition(definition: FontDefinition): Promise<boolean> {
		if (this.loadedDefinitionIds.has(definition.id)) {
			return false;
		}
		const inflight = this.loadInflightByDefinitionId.get(definition.id);
		if (inflight) {
			await inflight;
			return false;
		}
		const requestPromise = (async () => {
			const startEpoch = this.providerEpoch;
			try {
				const provider = await this.ensureProvider();
				if (!provider) {
					return false;
				}
				if (startEpoch !== this.providerEpoch) {
					return false;
				}
				const bytes = await this.fetchFontBytes(definition.source.url);
				if (startEpoch !== this.providerEpoch) {
					return false;
				}
				const typeface = this.createTypefaceFromBytes(bytes);
				if (!typeface) {
					return false;
				}
				if (startEpoch !== this.providerEpoch) {
					scheduleDisposableRelease(typeface);
					return false;
				}
				provider.registerFont(typeface, definition.family);
				this.registeredTypefaces.add(typeface);
				this.loadedDefinitionIds.add(definition.id);
				if (
					this.primaryTypeface === null &&
					definition.family === PRIMARY_FONT_FAMILY
				) {
					this.primaryTypeface = typeface;
				}
				return true;
			} catch (error) {
				console.warn("[FontRegistry] Failed to load full font:", error);
				return false;
			}
		})();
		this.loadInflightByDefinitionId.set(definition.id, requestPromise);
		try {
			return await requestPromise;
		} finally {
			this.loadInflightByDefinitionId.delete(definition.id);
		}
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

	private isFamilySupportingLanguage(
		family: string,
		language: FontLanguage,
	): boolean {
		const definitions = this.definitionsByFamily.get(family) ?? [];
		for (const definition of definitions) {
			if (definition.languages.includes(language)) {
				return true;
			}
		}
		return false;
	}

	private resolveRunStatus(
		language: FontLanguage,
		fallbackChain: string[],
	): "primary" | "fallback" {
		const primaryFamily = fallbackChain[0];
		if (!primaryFamily) return "fallback";
		return this.isFamilySupportingLanguage(primaryFamily, language)
			? "primary"
			: "fallback";
	}

	registerFontDefinitions(
		definitions: FontDefinition[],
		mode: "append" | "replace" = "append",
	) {
		const normalizedDefinitions = definitions
			.map((definition) => normalizeFontDefinition(definition))
			.filter((definition): definition is FontDefinition => {
				return definition !== null;
			});

		if (mode === "replace") {
			this.definitionsById.clear();
			for (const definition of normalizedDefinitions) {
				this.definitionsById.set(definition.id, definition);
			}
			this.rebuildFamilyIndex();
			this.resetProviderState();
			this.defaultFallbackChain = this.sanitizeFallbackChain(
				this.defaultFallbackChain,
			);
			this.notifySubscribers();
			return;
		}

		let shouldResetProvider = false;
		for (const definition of normalizedDefinitions) {
			if (this.definitionsById.has(definition.id)) {
				shouldResetProvider = true;
			}
			this.definitionsById.set(definition.id, definition);
		}
		this.rebuildFamilyIndex();
		if (shouldResetProvider) {
			this.resetProviderState();
		}
		this.defaultFallbackChain = this.sanitizeFallbackChain(
			this.defaultFallbackChain,
		);
		this.notifySubscribers();
	}

	setDefaultFallbackChain(fallbackChain: string[]) {
		const nextChain = this.sanitizeFallbackChain(fallbackChain);
		if (hasSameFontFamilies(nextChain, this.defaultFallbackChain)) {
			return;
		}
		this.defaultFallbackChain = nextChain;
		this.notifySubscribers();
	}

	getDefaultFallbackChain(): string[] {
		return [...this.defaultFallbackChain];
	}

	async ensureCoverage(
		params: FontRegistryEnsureCoverageParams,
	): Promise<void> {
		const text = params.text ?? "";
		if (!text) {
			await this.ensureProvider();
			return;
		}
		const languages = collectLanguagesFromText(text);
		if (languages.size <= 0) {
			await this.ensureProvider();
			return;
		}
		const fallbackChain = this.sanitizeFallbackChain(params.fallbackChain);
		const definitions = this.resolveDefinitionsForCoverage(
			languages,
			fallbackChain,
		);
		if (definitions.length <= 0) {
			await this.ensureProvider();
			return;
		}
		let hasStateChanged = false;
		for (const definition of definitions) {
			const loaded = await this.loadFontDefinition(definition);
			hasStateChanged = hasStateChanged || loaded;
		}
		if (hasStateChanged) {
			this.notifySubscribers();
		}
	}

	getParagraphRunPlan(
		text: string,
		options?: FontRegistryResolveOptions,
	): RunPlan[] {
		if (!text) return [];
		const fallbackChain = this.sanitizeFallbackChain(options?.fallbackChain);
		const runs: RunPlan[] = [];
		let currentText = "";
		let currentLanguage: FontLanguage | null = null;

		const flushCurrentRun = () => {
			if (!currentText || currentLanguage === null) {
				return;
			}
			runs.push({
				text: currentText,
				fontFamilies: [...fallbackChain],
				status: this.resolveRunStatus(currentLanguage, fallbackChain),
			});
			currentText = "";
			currentLanguage = null;
		};

		for (const char of Array.from(text)) {
			const codePoint = char.codePointAt(0);
			const language =
				codePoint === undefined
					? "latin"
					: classifyCharLanguage(char, codePoint);
			if (currentLanguage === null) {
				currentLanguage = language;
				currentText = char;
				continue;
			}
			if (currentLanguage !== language) {
				flushCurrentRun();
				currentLanguage = language;
				currentText = char;
				continue;
			}
			currentText += char;
		}
		flushCurrentRun();
		return runs;
	}

	async getFontProvider(): Promise<SkTypefaceFontProvider | null> {
		await this.ensureProvider();
		return this.provider;
	}

	getPrimaryTypeface(): SkTypeface | null {
		return this.primaryTypeface;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	resetForTests() {
		this.listeners.clear();
		this.resetDefinitionsToDefault();
		this.resetProviderState();
	}
}

export const fontRegistry = new FontRegistry();

export const __resetFontRegistryForTests = (): void => {
	fontRegistry.resetForTests();
};

export const FONT_REGISTRY_PRIMARY_FAMILY = PRIMARY_FONT_FAMILY;
