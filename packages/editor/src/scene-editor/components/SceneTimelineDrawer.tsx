import type React from "react";
import TimelineEditor from "@/scene-editor/TimelineEditor";
import CanvasNodeDrawerShell, {
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	CANVAS_NODE_DRAWER_MIN_HEIGHT,
} from "@/studio/canvas/CanvasNodeDrawerShell";
import type { StudioTimelineCanvasDropRequest } from "@/studio/clipboard/studioClipboardStore";
import ScenePlaybackControlBar from "./ScenePlaybackControlBar";

export const SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT =
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT;
export const SCENE_TIMELINE_DRAWER_MIN_HEIGHT = CANVAS_NODE_DRAWER_MIN_HEIGHT;
export const SCENE_TIMELINE_DRAWER_MAX_HEIGHT_RATIO =
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO;

interface SceneTimelineDrawerContentProps {
	onExitFocus: () => void;
	onDropTimelineElementsToCanvas?: (
		request: StudioTimelineCanvasDropRequest,
	) => boolean;
	onRestoreSceneReferenceToCanvas?: (sceneId: string) => boolean;
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
> = ({
	onExitFocus,
	onDropTimelineElementsToCanvas,
	onRestoreSceneReferenceToCanvas,
}) => {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<ScenePlaybackControlBar onExitFocus={onExitFocus} />
			<div className="min-h-0 flex-1">
				<TimelineEditor
					onDropTimelineElementsToCanvas={onDropTimelineElementsToCanvas}
					onRestoreSceneReferenceToCanvas={onRestoreSceneReferenceToCanvas}
				/>
			</div>
		</div>
	);
};

const SceneTimelineDrawer: React.FC<SceneTimelineDrawerProps> = ({
	onExitFocus,
	onDropTimelineElementsToCanvas,
	onRestoreSceneReferenceToCanvas,
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
			<SceneTimelineDrawerContent
				onExitFocus={onExitFocus}
				onDropTimelineElementsToCanvas={onDropTimelineElementsToCanvas}
				onRestoreSceneReferenceToCanvas={onRestoreSceneReferenceToCanvas}
			/>
		</CanvasNodeDrawerShell>
	);
};

export default SceneTimelineDrawer;
