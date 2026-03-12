import type React from "react";
import TimelineEditor from "@/scene-editor/TimelineEditor";
import CanvasNodeDrawerShell, {
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	CANVAS_NODE_DRAWER_MIN_HEIGHT,
} from "@/studio/canvas/CanvasNodeDrawerShell";
import ScenePlaybackControlBar from "./ScenePlaybackControlBar";

export const SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT =
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT;
export const SCENE_TIMELINE_DRAWER_MIN_HEIGHT = CANVAS_NODE_DRAWER_MIN_HEIGHT;
export const SCENE_TIMELINE_DRAWER_MAX_HEIGHT_RATIO =
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO;

interface SceneTimelineDrawerContentProps {
	onExitFocus: () => void;
}

interface SceneTimelineDrawerProps extends SceneTimelineDrawerContentProps {
	onHeightChange?: (height: number) => void;
	resizable?: boolean;
	defaultHeight?: number;
	minHeight?: number;
	maxHeightRatio?: number;
}

export const SceneTimelineDrawerContent: React.FC<
	SceneTimelineDrawerContentProps
> = ({ onExitFocus }) => {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<ScenePlaybackControlBar onExitFocus={onExitFocus} />
			<div className="min-h-0 flex-1 overflow-hidden rounded-2xl [corner-shape:superellipse(1.2)] mask-[url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAA5JREFUeNpiYGBgAAgwAAAEAAGbA+oJAAAAAElFTkSuQmCC)]">
				<TimelineEditor />
			</div>
		</div>
	);
};

const SceneTimelineDrawer: React.FC<SceneTimelineDrawerProps> = ({
	onExitFocus,
	onHeightChange,
	resizable = true,
	defaultHeight = SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT,
	minHeight = SCENE_TIMELINE_DRAWER_MIN_HEIGHT,
	maxHeightRatio = SCENE_TIMELINE_DRAWER_MAX_HEIGHT_RATIO,
}) => {
	return (
		<CanvasNodeDrawerShell
			dataTestId="scene-timeline-drawer"
			defaultHeight={defaultHeight}
			minHeight={minHeight}
			maxHeightRatio={maxHeightRatio}
			resizable={resizable}
			onHeightChange={onHeightChange}
			resizeHandleLabel="调整时间线高度"
		>
			<SceneTimelineDrawerContent onExitFocus={onExitFocus} />
		</CanvasNodeDrawerShell>
	);
};

export default SceneTimelineDrawer;
