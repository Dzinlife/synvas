import { clampFrame, timecodeToFrames } from "@/utils/timecode";

export const parseStartEndSchema = (schema: number | string, fps: number) => {
	if (typeof schema === "number") {
		return clampFrame(schema);
	}

	try {
		return timecodeToFrames(schema, fps);
	} catch {
		return 0;
	}
};
