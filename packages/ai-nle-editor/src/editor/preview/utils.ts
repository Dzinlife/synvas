import type { TimelineElement } from "@nle/dsl/types";
import type { TimelineTrack } from "../timeline/types";

/**
 * 根据时间与轨道可见性筛选元素。
 * 纯函数，不触发 React 重新渲染。
 */
export const computeVisibleElements = (
	elements: TimelineElement[],
	currentTime: number,
	tracks: TimelineTrack[],
): TimelineElement[] => {
	return elements.filter((el) => {
		const { start = 0, end = Infinity } = el.timeline;
		const trackIndex = el.timeline.trackIndex ?? 0;
		const trackHidden = tracks[trackIndex]?.hidden ?? false;
		return !trackHidden && currentTime >= start && currentTime < end;
	});
};

export type CanvasConvertOptions = {
	picture: { width: number; height: number };
	canvas: { width: number; height: number };
};
