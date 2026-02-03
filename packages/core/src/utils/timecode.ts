export const DEFAULT_FPS = 30;

const safeFps = (fps: number): number => {
	if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
	return Math.round(fps);
};

export const PIXELS_PER_SECOND = 50;

export const getPixelsPerFrame = (fps: number): number => {
	return PIXELS_PER_SECOND / safeFps(fps);
};

export const assertValidFps = (fps: number, label = "fps"): number => {
	if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(fps)) {
		throw new Error(`${label} must be a positive integer`);
	}
	return fps;
};

export function clampFrame(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.round(value));
}

export function framesToSeconds(frames: number, fps: number): number {
	const resolvedFps = safeFps(fps);
	return clampFrame(frames) / resolvedFps;
}

export function secondsToFrames(seconds: number, fps: number): number {
	const resolvedFps = safeFps(fps);
	if (!Number.isFinite(seconds) || seconds <= 0) return 0;
	return Math.round(seconds * resolvedFps);
}

export function framesToTimecode(frames: number, fps: number): string {
	const resolvedFps = safeFps(fps);
	const totalFrames = clampFrame(frames);
	const totalSeconds = Math.floor(totalFrames / resolvedFps);
	const frameInSecond = totalFrames % resolvedFps;

	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3600);

	return `${hours.toString().padStart(2, "0")}:${minutes
		.toString()
		.padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frameInSecond
		.toString()
		.padStart(2, "0")}`;
}

export function timecodeToFrames(timecode: string, fps: number): number {
	const resolvedFps = safeFps(fps);
	if (typeof timecode !== "string") {
		throw new Error("Invalid timecode: must be a string");
	}
	const match = timecode.trim().match(/^(\d+):([0-5]\d):([0-5]\d):(\d+)$/);
	if (!match) {
		throw new Error(`Invalid timecode format: ${timecode}`);
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	const frames = Number(match[4]);
	if (
		!Number.isFinite(hours) ||
		!Number.isFinite(minutes) ||
		!Number.isFinite(seconds) ||
		!Number.isFinite(frames)
	) {
		throw new Error(`Invalid timecode value: ${timecode}`);
	}
	if (frames >= resolvedFps) {
		throw new Error(`Invalid timecode frames: ${timecode}`);
	}
	const totalSeconds = hours * 3600 + minutes * 60 + seconds;
	return totalSeconds * resolvedFps + frames;
}
