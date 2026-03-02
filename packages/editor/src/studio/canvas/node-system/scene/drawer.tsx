import type { SceneNode } from "core/studio/types";
import { SceneTimelineDrawerContent } from "@/editor/components/SceneTimelineDrawer";
import type { CanvasNodeDrawerProps } from "../types";

export const SceneNodeDrawer = ({
	onClose,
}: CanvasNodeDrawerProps<SceneNode>) => {
	return <SceneTimelineDrawerContent onExitFocus={onClose} />;
};
