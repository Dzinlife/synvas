import type { SceneNode } from "@/studio/project/types";
import { SceneTimelineDrawerContent } from "@/scene-editor/components/SceneTimelineDrawer";
import type { CanvasNodeDrawerProps } from "../types";

export const SceneNodeDrawer = ({
	onDropTimelineElementsToCanvas,
	onRestoreSceneReferenceToCanvas,
}: CanvasNodeDrawerProps<SceneNode>) => {
	return (
		<SceneTimelineDrawerContent
			onDropTimelineElementsToCanvas={onDropTimelineElementsToCanvas}
			onRestoreSceneReferenceToCanvas={onRestoreSceneReferenceToCanvas}
		/>
	);
};
