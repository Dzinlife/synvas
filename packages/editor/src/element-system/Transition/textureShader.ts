import type { SkImage, SkPicture, SkRect, SkShader } from "react-skia-lite";
import { FilterMode, MipmapMode, TileMode } from "react-skia-lite";

export type TransitionTextureSource = SkImage | SkPicture;

export const makeTransitionTextureShader = (
	source: TransitionTextureSource,
	bounds: SkRect,
): SkShader => {
	if ("makeShader" in source) {
		return source.makeShader(
			TileMode.Clamp,
			TileMode.Clamp,
			FilterMode.Linear,
			undefined,
			bounds,
		);
	}
	return source.makeShaderOptions(
		TileMode.Clamp,
		TileMode.Clamp,
		FilterMode.Linear,
		MipmapMode.None,
	);
};
