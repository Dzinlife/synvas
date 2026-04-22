import type { SceneNode } from "core/studio/types";
import { SceneTimelineDrawerContent } from "@/scene-editor/components/SceneTimelineDrawer";
import type { CanvasNodeDrawerProps } from "../types";

export const SceneNodeDrawer = ({
	onClose,
	onDropTimelineElementsToCanvas,
	onRestoreSceneReferenceToCanvas,
}: CanvasNodeDrawerProps<SceneNode>) => {
	return (
		<SceneTimelineDrawerContent
			onExitFocus={onClose}
			onDropTimelineElementsToCanvas={onDropTimelineElementsToCanvas}
			onRestoreSceneReferenceToCanvas={onRestoreSceneReferenceToCanvas}
		/>
	);
};
