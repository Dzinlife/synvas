import {
	toDisplayTimeFromFrameIndex,
	toFrameIndex,
} from "core/render-system/framePrecompileBuffer";
import type { RenderFrameChannel } from "core/timeline-system/model/types";
import type { TimelineElement } from "core/timeline-system/types";
import type { ReactNode } from "react";
import { buildSkiaFrameSnapshot } from "@/scene-editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import type { SceneNode } from "@/studio/project/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

type BuildSkiaFrameSnapshotArgs = Parameters<typeof buildSkiaFrameSnapshot>[0];
type SceneFrameSnapshot = Awaited<ReturnType<typeof buildSkiaFrameSnapshot>>;

export type SceneNodeFrameSnapshot = {
	kind: "picture";
	picture: NonNullable<SceneFrameSnapshot["picture"]>;
	dispose?: (() => void) | undefined;
	frameIndex: number;
	displayTime: number;
	fps: number;
	sourceWidth: number;
	sourceHeight: number;
};

const createScopedRuntime = (runtime: TimelineRuntime): EditorRuntime => ({
	id: `${runtime.id}:infinite-scene-render`,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

const sortByTrackIndex = (elements: TimelineElement[]): TimelineElement[] => {
	return elements
		.map((element, index) => ({
			element,
			index,
			trackIndex: element.timeline.trackIndex ?? 0,
		}))
		.sort((left, right) => {
			if (left.trackIndex !== right.trackIndex) {
				return left.trackIndex - right.trackIndex;
			}
			return left.index - right.index;
		})
		.map((item) => item.element);
};

const getTrackIndexForElement = (element: TimelineElement): number => {
	return element.timeline.trackIndex ?? 0;
};

export const resolveSceneNodeFrameIndex = (
	displayTime: number,
	fps: number,
): number => {
	const normalizedFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
	return toFrameIndex(displayTime, normalizedFps);
};

export const resolveSceneNodeDisplayTimeFromFrame = (
	frameIndex: number,
	fps: number,
	currentDisplayTime: number,
): number => {
	const normalizedFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
	return toDisplayTimeFromFrameIndex(
		frameIndex,
		normalizedFps,
		currentDisplayTime,
	);
};

export const buildSceneNodeFrameSnapshot = async ({
	node,
	runtime,
	runtimeManager,
	elements,
	tracks,
	displayTime,
	frameIndex,
	fps,
	canvasSize,
	frameChannel,
}: {
	node: SceneNode;
	runtime: TimelineRuntime;
	runtimeManager: StudioRuntimeManager;
	elements: BuildSkiaFrameSnapshotArgs["elements"];
	tracks: BuildSkiaFrameSnapshotArgs["tracks"];
	displayTime: number;
	frameIndex: number;
	fps: number;
	canvasSize: { width: number; height: number };
	frameChannel?: RenderFrameChannel;
}): Promise<SceneNodeFrameSnapshot> => {
	const normalizedFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
	const safeCanvasSize = {
		width: Math.max(1, Math.round(canvasSize.width || 1)),
		height: Math.max(1, Math.round(canvasSize.height || 1)),
	};
	const resolveCompositionTimeline: NonNullable<
		NonNullable<
			Parameters<typeof buildSkiaFrameSnapshot>[1]
		>["resolveCompositionTimeline"]
	> = (sceneId) => {
		const childRuntime = runtimeManager.getTimelineRuntime(
			toSceneTimelineRef(sceneId),
		);
		if (!childRuntime) return null;
		const childState = childRuntime.timelineStore.getState();
		return {
			sceneId,
			elements: childState.elements,
			tracks: childState.tracks,
			fps: childState.fps,
			canvasSize: childState.canvasSize,
			getModelStore: (id: string) => childRuntime.modelRegistry.get(id),
			wrapRenderNode: (childNode: ReactNode) => (
				<EditorRuntimeProvider runtime={createScopedRuntime(childRuntime)}>
					{childNode}
				</EditorRuntimeProvider>
			),
		};
	};
	const frameSnapshot = await buildSkiaFrameSnapshot(
		{
			elements,
			displayTime,
			tracks,
			getTrackIndexForElement,
			sortByTrackIndex,
			prepare: {
				isExporting: false,
				fps: normalizedFps,
				canvasSize: safeCanvasSize,
				prepareTransitionPictures: true,
				forcePrepareFrames: true,
				awaitReady: true,
				getModelStore: (id) => runtime.modelRegistry.get(id),
				compositionPath: [node.sceneId],
				compositionRenderTarget: "picture",
				frameSnapshotRenderTarget: "picture",
				...(frameChannel ? { frameChannel } : {}),
			},
		},
		{
			wrapRenderNode: (renderNode) => (
				<EditorRuntimeProvider runtime={createScopedRuntime(runtime)}>
					{renderNode}
				</EditorRuntimeProvider>
			),
			resolveCompositionTimeline,
		},
	);
	if (!frameSnapshot.picture) {
		throw new Error("Scene preview frame picture is null");
	}
	return {
		kind: "picture",
		picture: frameSnapshot.picture,
		dispose: frameSnapshot.dispose,
		frameIndex,
		displayTime,
		fps: normalizedFps,
		sourceWidth: safeCanvasSize.width,
		sourceHeight: safeCanvasSize.height,
	};
};
