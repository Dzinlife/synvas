import {
	COLOR_SPACE_PRESETS,
	DEFAULT_COLOR_MANAGEMENT_SETTINGS,
	cloneColorManagementSettings,
	type ColorManagementSettings,
	type ColorSpaceDescriptor,
	type PreviewColorSpaceTarget,
} from "core";
import type { SkiaWebCanvasColorSpace } from "react-skia-lite";
import type { SceneDocument, StudioProject } from "./types";

export type TextureTargetColorSpace = "srgb" | "display-p3";

export interface SceneColorContext {
	settings: ColorManagementSettings;
	parentWorking?: ColorSpaceDescriptor;
	previewTargetColorSpace: TextureTargetColorSpace;
}

const canDisplayP3Colors = (): boolean => {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia("(color-gamut: p3)").matches;
	} catch {
		return false;
	}
};

const cloneDescriptor = (
	descriptor: ColorSpaceDescriptor,
): ColorSpaceDescriptor => ({ ...descriptor });

export const resolveProjectColorSettings = (
	project: Pick<StudioProject, "color"> | null | undefined,
): ColorManagementSettings => {
	const defaults = cloneColorManagementSettings(DEFAULT_COLOR_MANAGEMENT_SETTINGS);
	if (!project?.color) return defaults;
	return {
		working: project.color.working
			? cloneDescriptor(project.color.working)
			: defaults.working,
		preview: project.color.preview ?? defaults.preview,
		export: project.color.export
			? cloneDescriptor(project.color.export)
			: defaults.export,
	};
};

export const resolveSceneColorSettings = (
	project: Pick<StudioProject, "color"> | null | undefined,
	scene: Pick<SceneDocument, "color"> | null | undefined,
): ColorManagementSettings => {
	const projectSettings = resolveProjectColorSettings(project);
	const sceneColor = scene?.color;
	if (!sceneColor) return projectSettings;
	return {
		working: sceneColor.working
			? cloneDescriptor(sceneColor.working)
			: projectSettings.working,
		preview: sceneColor.preview ?? projectSettings.preview,
		export: sceneColor.export
			? cloneDescriptor(sceneColor.export)
			: projectSettings.export,
	};
};

export const resolvePreviewTargetColorSpace = (
	preview: PreviewColorSpaceTarget,
	supportsDisplayP3: boolean = canDisplayP3Colors(),
): TextureTargetColorSpace => {
	if (preview === "display-p3") {
		return supportsDisplayP3 ? "display-p3" : "srgb";
	}
	if (preview === "auto") {
		return supportsDisplayP3 ? "display-p3" : "srgb";
	}
	return "srgb";
};

export const toSkiaWebCanvasColorSpace = (
	target: TextureTargetColorSpace,
): SkiaWebCanvasColorSpace => (target === "display-p3" ? "p3" : "srgb");

export const resolveSceneColorContext = (
	project: Pick<StudioProject, "color"> | null | undefined,
	scene: Pick<SceneDocument, "color"> | null | undefined,
	parent?: SceneColorContext | null,
): SceneColorContext => {
	const settings = resolveSceneColorSettings(project, scene);
	return {
		settings,
		parentWorking: parent?.settings.working,
		previewTargetColorSpace: resolvePreviewTargetColorSpace(settings.preview),
	};
};

export const resolveSkiaCanvasColorSpaceForScene = (
	project: Pick<StudioProject, "color"> | null | undefined,
	scene: Pick<SceneDocument, "color"> | null | undefined,
): SkiaWebCanvasColorSpace => {
	const context = resolveSceneColorContext(project, scene);
	return toSkiaWebCanvasColorSpace(context.previewTargetColorSpace);
};

export const SCENE_WORKING_COLOR_OPTIONS = [
	{ key: "inherit", label: "Inherit", descriptor: null },
	{
		key: "srgbSdr",
		label: "sRGB SDR",
		descriptor: COLOR_SPACE_PRESETS.srgbSdr,
	},
	{
		key: "displayP3Sdr",
		label: "Display P3 SDR",
		descriptor: COLOR_SPACE_PRESETS.displayP3Sdr,
	},
] as const;

export const SCENE_EXPORT_COLOR_OPTIONS = [
	{ key: "inherit", label: "Inherit", descriptor: null },
	{
		key: "rec709Sdr",
		label: "Rec.709 SDR",
		descriptor: COLOR_SPACE_PRESETS.rec709Sdr,
	},
	{
		key: "displayP3Sdr",
		label: "Display P3 SDR",
		descriptor: COLOR_SPACE_PRESETS.displayP3Sdr,
	},
] as const;

export const ASSET_COLOR_OVERRIDE_OPTIONS = [
	{ key: "auto", label: "Auto", descriptor: null },
	{
		key: "rec709Sdr",
		label: "Rec.709 SDR",
		descriptor: COLOR_SPACE_PRESETS.rec709Sdr,
	},
	{
		key: "displayP3Sdr",
		label: "Display P3 SDR",
		descriptor: COLOR_SPACE_PRESETS.displayP3Sdr,
	},
	{
		key: "rec2100Pq",
		label: "Rec.2100 PQ",
		descriptor: COLOR_SPACE_PRESETS.rec2100Pq,
	},
	{
		key: "rec2100Hlg",
		label: "Rec.2100 HLG",
		descriptor: COLOR_SPACE_PRESETS.rec2100Hlg,
	},
] as const;
