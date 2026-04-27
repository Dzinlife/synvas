import type { SkImage } from "react-skia-lite";

export const isDisposedSkImage = (
	image: SkImage | null | undefined,
): boolean => {
	if (!image || typeof image !== "object") return false;
	const maybeHostImage = image as SkImage & { ref?: unknown };
	if (!("ref" in maybeHostImage)) return false;
	return maybeHostImage.ref === null || maybeHostImage.ref === undefined;
};

export const readSkImageSize = (
	image: SkImage | null | undefined,
): { width: number; height: number } | null => {
	if (!image || isDisposedSkImage(image)) return null;
	try {
		const width = image.width();
		const height = image.height();
		if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
		if (width <= 0 || height <= 0) return null;
		return { width, height };
	} catch {
		return null;
	}
};
