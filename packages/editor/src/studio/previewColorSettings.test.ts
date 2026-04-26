// @vitest-environment jsdom

import {
	DEFAULT_APP_PREVIEW_COLOR_SETTINGS,
	type AppPreviewColorSettings,
} from "core";
import type { SkiaWebCanvasColorSpaceSupport } from "react-skia-lite";
import { beforeEach, describe, expect, it } from "vitest";
import {
	PREVIEW_COLOR_SETTINGS_STORAGE_KEY,
	resolveAppPreviewColorOutput,
	useAppPreviewColorSettingsStore,
} from "./previewColorSettings";

const createSupport = (
	patch: Partial<SkiaWebCanvasColorSpaceSupport> = {},
): SkiaWebCanvasColorSpaceSupport => ({
	displayP3Gamut: false,
	canvas2DDisplayP3: false,
	webglDrawingBufferDisplayP3: false,
	webgpuCanvasDisplayP3: false,
	hdrDynamicRange: false,
	...patch,
});

describe("preview color settings", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useAppPreviewColorSettingsStore.setState({
			settings: { ...DEFAULT_APP_PREVIEW_COLOR_SETTINGS },
		});
	});

	it("auto 优先解析为 Display P3 / extended", () => {
		const resolved = resolveAppPreviewColorOutput(
			{ colorSpace: "auto", dynamicRange: "auto" },
			createSupport({
				displayP3Gamut: true,
				hdrDynamicRange: true,
			}),
		);

		expect(resolved.colorSpace).toBe("p3");
		expect(resolved.textureTargetColorSpace).toBe("display-p3");
		expect(resolved.dynamicRange).toBe("extended");
	});

	it("auto 在能力不足时回退 sRGB / standard", () => {
		const resolved = resolveAppPreviewColorOutput(
			{ colorSpace: "auto", dynamicRange: "auto" },
			createSupport(),
		);

		expect(resolved.colorSpace).toBe("srgb");
		expect(resolved.textureTargetColorSpace).toBe("srgb");
		expect(resolved.dynamicRange).toBe("standard");
	});

	it("显式 standard 会强制 SDR", () => {
		const resolved = resolveAppPreviewColorOutput(
			{ colorSpace: "display-p3", dynamicRange: "standard" },
			createSupport({
				displayP3Gamut: true,
				hdrDynamicRange: true,
			}),
		);

		expect(resolved.colorSpace).toBe("p3");
		expect(resolved.dynamicRange).toBe("standard");
	});

	it("会持久化应用级 preview 设置", () => {
		useAppPreviewColorSettingsStore.getState().setSettings({
			colorSpace: "srgb",
			dynamicRange: "standard",
		});

		const stored = JSON.parse(
			window.localStorage.getItem(PREVIEW_COLOR_SETTINGS_STORAGE_KEY) ?? "{}",
		) as AppPreviewColorSettings;
		expect(stored).toEqual({
			colorSpace: "srgb",
			dynamicRange: "standard",
		});
	});
});
