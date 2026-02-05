export * from "core/editor/timeline/types";

export type SnapPointType = "element-start" | "element-end" | "playhead";

export interface SnapPoint {
	time: number;
	type: SnapPointType;
	sourceId?: string;
}

export interface SnapResult {
	time: number;
	snapPoint: SnapPoint | null;
}
