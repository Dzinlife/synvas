export * from "core/timeline-system/timeline";

export type SnapPointType = "element-start" | "element-end" | "playhead";

export interface SnapPoint {
	time: number;
	type: SnapPointType;
	assetId?: string;
}

export interface SnapResult {
	time: number;
	snapPoint: SnapPoint | null;
}
