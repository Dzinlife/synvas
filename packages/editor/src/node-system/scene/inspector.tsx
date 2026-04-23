import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import type { SceneDocument, SceneNode } from "@/studio/project/types";
import { useContext, useMemo } from "react";
import { framesToTimecode } from "@/utils/timecode";
import ElementSettingsPanel from "@/scene-editor/components/ElementSettingsPanel";
import { useSelectedElement } from "@/scene-editor/contexts/TimelineContext";
import {
	EditorRuntimeContext,
	EditorRuntimeProvider,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import { createScopedStudioRuntime } from "@/scene-editor/runtime/createScopedStudioRuntime";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import CanvasActiveNodeMetaPanel from "@/studio/canvas/CanvasActiveNodeMetaPanel";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNodeInspectorProps } from "../types";

const Item = ({ label, value }: { label: string; value: React.ReactNode }) => {
	return (
		<div className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
			<div className="text-[11px] text-white/60">{label}</div>
			<div className="break-all text-[11px] text-white/90">{value}</div>
		</div>
	);
};

const SceneNodeMetaPanel = ({ scene }: { scene: SceneDocument }) => {
	const durationFrames = useMemo(() => {
		return resolveTimelineEndFrame(scene.timeline.elements);
	}, [scene.timeline.elements]);

	return (
		<div
			data-testid="canvas-scene-node-meta-panel"
			className="flex h-full min-h-0 w-full flex-col overflow-hidden ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
		>
			<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
				Scene
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
				<Item label="Name" value={scene.name} />
				<Item label="ID" value={scene.id} />
				<Item
					label="Size"
					value={`${scene.timeline.canvas.width} x ${scene.timeline.canvas.height}`}
				/>
				<Item label="FPS" value={scene.timeline.fps} />
				<Item
					label="Duration"
					value={`${durationFrames}f (${framesToTimecode(durationFrames, scene.timeline.fps)})`}
				/>
				<Item label="Elements" value={scene.timeline.elements.length} />
			</div>
		</div>
	);
};

const SceneNodeInspectorContent = ({ scene }: { scene: SceneDocument }) => {
	const { selectedElement } = useSelectedElement();

	if (selectedElement) {
		return (
			<div
				data-testid="canvas-timeline-element-settings-panel"
				className="flex h-full min-h-0 w-full flex-col overflow-hidden ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
			>
				<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
					Element
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-3">
					<ElementSettingsPanel />
				</div>
			</div>
		);
	}

	return <SceneNodeMetaPanel scene={scene} />;
};

export const SceneNodeInspector = ({
	node,
	scene,
	asset,
}: CanvasNodeInspectorProps<SceneNode>) => {
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (
			!manager?.ensureTimelineRuntime ||
			!manager?.getTimelineRuntime ||
			!manager?.listTimelineRuntimes
		) {
			return null;
		}
		return runtime as EditorRuntime & StudioRuntimeManager;
	}, [runtime]);
	const timelineRuntime = useMemo(() => {
		if (!scene || !runtimeManager) return null;
		const sceneRef = toSceneTimelineRef(node.sceneId);
		return (
			runtimeManager.getTimelineRuntime(sceneRef) ??
			runtimeManager.ensureTimelineRuntime(sceneRef)
		);
	}, [node.sceneId, runtimeManager, scene]);
	const scopedRuntime = useMemo(() => {
		if (!timelineRuntime || !runtimeManager) return null;
		return createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: node.sceneId,
		});
	}, [node.sceneId, runtimeManager, timelineRuntime]);

	if (!scene || !timelineRuntime || !scopedRuntime) {
		return <CanvasActiveNodeMetaPanel node={node} scene={scene} asset={asset} />;
	}

	return (
		<EditorRuntimeProvider runtime={scopedRuntime}>
			<SceneNodeInspectorContent scene={scene} />
		</EditorRuntimeProvider>
	);
};
