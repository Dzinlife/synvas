export type ColorPrimaries = "srgb" | "display-p3" | "bt2020" | "unknown";

export type ColorTransfer =
	| "srgb"
	| "bt709"
	| "pq"
	| "hlg"
	| "linear"
	| "unknown";

export type ColorMatrix = "rgb" | "bt709" | "bt2020-ncl" | "unknown";

export type ColorRange = "full" | "limited" | "unknown";

export type PreviewColorSpaceTarget = "auto" | "srgb" | "display-p3";

export interface ColorSpaceDescriptor {
	primaries: ColorPrimaries;
	transfer: ColorTransfer;
	matrix: ColorMatrix;
	range: ColorRange;
	label?: string;
}

export interface AssetColorMetadata {
	detected?: ColorSpaceDescriptor;
	override?: ColorSpaceDescriptor;
}

export interface ColorManagementSettings {
	working: ColorSpaceDescriptor;
	preview: PreviewColorSpaceTarget;
	export: ColorSpaceDescriptor;
}

export const COLOR_SPACE_PRESETS = {
	srgbSdr: {
		primaries: "srgb",
		transfer: "srgb",
		matrix: "rgb",
		range: "full",
		label: "sRGB SDR",
	},
	displayP3Sdr: {
		primaries: "display-p3",
		transfer: "srgb",
		matrix: "rgb",
		range: "full",
		label: "Display P3 SDR",
	},
	rec709Sdr: {
		primaries: "srgb",
		transfer: "bt709",
		matrix: "bt709",
		range: "limited",
		label: "Rec.709 SDR",
	},
	rec2100Pq: {
		primaries: "bt2020",
		transfer: "pq",
		matrix: "bt2020-ncl",
		range: "limited",
		label: "Rec.2100 PQ",
	},
	rec2100Hlg: {
		primaries: "bt2020",
		transfer: "hlg",
		matrix: "bt2020-ncl",
		range: "limited",
		label: "Rec.2100 HLG",
	},
	unknown: {
		primaries: "unknown",
		transfer: "unknown",
		matrix: "unknown",
		range: "unknown",
		label: "Unknown",
	},
} satisfies Record<string, ColorSpaceDescriptor>;

export type ColorSpacePresetKey = keyof typeof COLOR_SPACE_PRESETS;

export const DEFAULT_COLOR_MANAGEMENT_SETTINGS: ColorManagementSettings = {
	working: COLOR_SPACE_PRESETS.displayP3Sdr,
	preview: "auto",
	export: COLOR_SPACE_PRESETS.rec709Sdr,
};

export const cloneColorSpaceDescriptor = (
	descriptor: ColorSpaceDescriptor,
): ColorSpaceDescriptor => ({ ...descriptor });

export const cloneColorManagementSettings = (
	settings: ColorManagementSettings,
): ColorManagementSettings => ({
	working: cloneColorSpaceDescriptor(settings.working),
	preview: settings.preview,
	export: cloneColorSpaceDescriptor(settings.export),
});

export const getColorSpacePresetKey = (
	descriptor: ColorSpaceDescriptor | null | undefined,
): ColorSpacePresetKey | null => {
	if (!descriptor) return null;
	for (const [key, preset] of Object.entries(COLOR_SPACE_PRESETS)) {
		if (
			preset.primaries === descriptor.primaries &&
			preset.transfer === descriptor.transfer &&
			preset.matrix === descriptor.matrix &&
			preset.range === descriptor.range
		) {
			return key as ColorSpacePresetKey;
		}
	}
	return null;
};

export const formatColorSpaceDescriptor = (
	descriptor: ColorSpaceDescriptor | null | undefined,
): string => {
	if (!descriptor) return "Auto";
	return (
		descriptor.label ??
		`${descriptor.primaries} / ${descriptor.transfer} / ${descriptor.matrix} / ${descriptor.range}`
	);
};
