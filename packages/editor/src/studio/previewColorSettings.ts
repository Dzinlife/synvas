import {
	DEFAULT_APP_PREVIEW_COLOR_SETTINGS,
	type AppPreviewColorSettings,
	type PreviewColorSpaceTarget,
	type PreviewDynamicRangeTarget,
} from "core";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasColorSpaceSupport,
	SkiaWebCanvasDynamicRange,
	TextureSourceTargetColorSpace,
} from "react-skia-lite";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

export const PREVIEW_COLOR_SETTINGS_STORAGE_KEY = "synvas.previewColorSettings";

const DISPLAY_P3_MEDIA_QUERY = "(color-gamut: p3)";
const HDR_DYNAMIC_RANGE_MEDIA_QUERY = "(dynamic-range: high)";

const PREVIEW_COLOR_SPACE_TARGETS = new Set<PreviewColorSpaceTarget>([
	"auto",
	"srgb",
	"display-p3",
]);
const PREVIEW_DYNAMIC_RANGE_TARGETS = new Set<PreviewDynamicRangeTarget>([
	"auto",
	"standard",
	"extended",
]);

export interface ResolvedAppPreviewColorOutput {
	settings: AppPreviewColorSettings;
	support: SkiaWebCanvasColorSpaceSupport;
	colorSpace: SkiaWebCanvasColorSpace;
	dynamicRange: SkiaWebCanvasDynamicRange;
	textureTargetColorSpace: TextureSourceTargetColorSpace;
}

interface AppPreviewColorSettingsStoreState {
	settings: AppPreviewColorSettings;
	setColorSpace: (colorSpace: PreviewColorSpaceTarget) => void;
	setDynamicRange: (dynamicRange: PreviewDynamicRangeTarget) => void;
	setSettings: (settings: Partial<AppPreviewColorSettings>) => void;
	reset: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizePreviewColorSettings = (
	value: unknown,
): AppPreviewColorSettings => {
	if (!isRecord(value)) {
		return { ...DEFAULT_APP_PREVIEW_COLOR_SETTINGS };
	}
	const colorSpace = PREVIEW_COLOR_SPACE_TARGETS.has(
		value.colorSpace as PreviewColorSpaceTarget,
	)
		? (value.colorSpace as PreviewColorSpaceTarget)
		: DEFAULT_APP_PREVIEW_COLOR_SETTINGS.colorSpace;
	const dynamicRange = PREVIEW_DYNAMIC_RANGE_TARGETS.has(
		value.dynamicRange as PreviewDynamicRangeTarget,
	)
		? (value.dynamicRange as PreviewDynamicRangeTarget)
		: DEFAULT_APP_PREVIEW_COLOR_SETTINGS.dynamicRange;
	return { colorSpace, dynamicRange };
};

const isPreviewColorSettingsEqual = (
	left: AppPreviewColorSettings,
	right: AppPreviewColorSettings,
): boolean =>
	left.colorSpace === right.colorSpace &&
	left.dynamicRange === right.dynamicRange;

const readPreviewColorSettings = (): AppPreviewColorSettings => {
	if (typeof window === "undefined") {
		return { ...DEFAULT_APP_PREVIEW_COLOR_SETTINGS };
	}
	try {
		const raw = window.localStorage.getItem(PREVIEW_COLOR_SETTINGS_STORAGE_KEY);
		return normalizePreviewColorSettings(raw ? JSON.parse(raw) : null);
	} catch {
		return { ...DEFAULT_APP_PREVIEW_COLOR_SETTINGS };
	}
};

const writePreviewColorSettings = (settings: AppPreviewColorSettings) => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			PREVIEW_COLOR_SETTINGS_STORAGE_KEY,
			JSON.stringify(settings),
		);
	} catch {}
};

const subscribePreviewSupportChange = (listener: () => void) => {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return () => {};
	}
	const mediaQueries = [
		window.matchMedia(DISPLAY_P3_MEDIA_QUERY),
		window.matchMedia(HDR_DYNAMIC_RANGE_MEDIA_QUERY),
	];
	for (const query of mediaQueries) {
		query.addEventListener?.("change", listener);
	}
	return () => {
		for (const query of mediaQueries) {
			query.removeEventListener?.("change", listener);
		}
	};
};

const canMatchMedia = (query: string): boolean => {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia(query).matches;
	} catch {
		return false;
	}
};

const canUseWebGPUCanvasColorSpace = (): boolean => {
	if (typeof navigator === "undefined") return false;
	const gpuNavigator = navigator as Navigator & {
		gpu?: {
			requestAdapter?: unknown;
		};
	};
	return typeof gpuNavigator.gpu?.requestAdapter === "function";
};

export const detectAppPreviewColorSupport =
	(): SkiaWebCanvasColorSpaceSupport => {
		const displayP3Gamut = canMatchMedia(DISPLAY_P3_MEDIA_QUERY);
		const webgpuCanvasDisplayP3 =
			displayP3Gamut && canUseWebGPUCanvasColorSpace();
		return {
			displayP3Gamut,
			canvas2DDisplayP3: displayP3Gamut,
			webglDrawingBufferDisplayP3: displayP3Gamut,
			webgpuCanvasDisplayP3,
			hdrDynamicRange:
				canMatchMedia(HDR_DYNAMIC_RANGE_MEDIA_QUERY) &&
				canUseWebGPUCanvasColorSpace(),
		};
	};

const usePreviewSupportRevision = (): number => {
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		return subscribePreviewSupportChange(() => {
			setRevision((prev) => prev + 1);
		});
	}, []);
	return revision;
};

export const resolveAppPreviewColorOutput = (
	settings: AppPreviewColorSettings,
	support: SkiaWebCanvasColorSpaceSupport = detectAppPreviewColorSupport(),
): ResolvedAppPreviewColorOutput => {
	const normalizedSettings = normalizePreviewColorSettings(settings);
	const wantsP3 =
		normalizedSettings.colorSpace === "auto" ||
		normalizedSettings.colorSpace === "display-p3";
	const wantsExtended =
		normalizedSettings.dynamicRange === "auto" ||
		normalizedSettings.dynamicRange === "extended";
	const colorSpace: SkiaWebCanvasColorSpace =
		wantsP3 && support.displayP3Gamut ? "p3" : "srgb";
	const dynamicRange: SkiaWebCanvasDynamicRange =
		wantsExtended && support.hdrDynamicRange ? "extended" : "standard";
	return {
		settings: normalizedSettings,
		support,
		colorSpace,
		dynamicRange,
		textureTargetColorSpace: colorSpace === "p3" ? "display-p3" : "srgb",
	};
};

export const useAppPreviewColorSettingsStore =
	create<AppPreviewColorSettingsStoreState>((set) => ({
		settings: readPreviewColorSettings(),
		setColorSpace: (colorSpace) => {
			set((state) => {
				const settings = normalizePreviewColorSettings({
					...state.settings,
					colorSpace,
				});
				if (isPreviewColorSettingsEqual(state.settings, settings)) return state;
				writePreviewColorSettings(settings);
				return { settings };
			});
		},
		setDynamicRange: (dynamicRange) => {
			set((state) => {
				const settings = normalizePreviewColorSettings({
					...state.settings,
					dynamicRange,
				});
				if (isPreviewColorSettingsEqual(state.settings, settings)) return state;
				writePreviewColorSettings(settings);
				return { settings };
			});
		},
		setSettings: (patch) => {
			set((state) => {
				const settings = normalizePreviewColorSettings({
					...state.settings,
					...patch,
				});
				if (isPreviewColorSettingsEqual(state.settings, settings)) return state;
				writePreviewColorSettings(settings);
				return { settings };
			});
		},
		reset: () => {
			const settings = { ...DEFAULT_APP_PREVIEW_COLOR_SETTINGS };
			writePreviewColorSettings(settings);
			set({ settings });
		},
	}));

export const useResolvedAppPreviewColorOutput =
	(): ResolvedAppPreviewColorOutput => {
		const settings = useAppPreviewColorSettingsStore((state) => state.settings);
		const supportRevision = usePreviewSupportRevision();
		return useMemo(
			() => resolveAppPreviewColorOutput(settings),
			[settings, supportRevision],
		);
	};
