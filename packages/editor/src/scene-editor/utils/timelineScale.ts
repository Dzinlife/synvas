export const PIXELS_PER_SECOND = 50;

const normalizeScale = (scale: number): number => {
	if (!Number.isFinite(scale) || scale <= 0) return 1;
	return scale;
};

export function getPixelsPerFrame(fps: number, scale = 1): number {
	if (!Number.isFinite(fps) || fps <= 0) {
		return (PIXELS_PER_SECOND / 30) * normalizeScale(scale);
	}
	return (PIXELS_PER_SECOND / fps) * normalizeScale(scale);
}

export function framesToPixels(frames: number, fps: number, scale = 1): number {
	return frames * getPixelsPerFrame(fps, scale);
}

export function pixelsToFrames(pixels: number, fps: number, scale = 1): number {
	return pixels / getPixelsPerFrame(fps, scale);
}
