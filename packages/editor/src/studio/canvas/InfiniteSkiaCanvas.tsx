import type { TimelineElement } from "core/dsl/types";
import type { SceneNode, StudioProject } from "core/studio/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Canvas,
	Fill,
	Group,
	Picture,
	Rect,
	type SkPicture,
} from "react-skia-lite";
import { buildSkiaFrameSnapshot } from "@/editor/preview/buildSkiaTree";
import { EditorRuntimeProvider } from "@/editor/runtime/EditorRuntimeProvider";
import { useStudioRuntimeManager } from "@/editor/runtime/EditorRuntimeProvider";
import type { EditorRuntime, TimelineRuntime } from "@/editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

interface InfiniteSkiaCanvasProps {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	nodes: SceneNode[];
	scenes: StudioProject["scenes"];
}

interface SceneFrameEntry {
	picture: SkPicture;
	dispose: () => void;
}

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

const buildRenderSignature = (runtime: TimelineRuntime): unknown[] => {
	const state = runtime.timelineStore.getState();
	return [
		state.currentTime,
		state.previewTime,
		state.isPlaying,
		state.isExporting,
		state.exportTime,
		state.elements,
		state.tracks,
		state.assets,
		state.canvasSize,
		state.fps,
	];
};

const buildScenePicture = async (
	runtime: TimelineRuntime,
): Promise<SceneFrameEntry | null> => {
	const state = runtime.timelineStore.getState();
	if (state.canvasSize.width <= 0 || state.canvasSize.height <= 0) return null;

	const snapshot = await buildSkiaFrameSnapshot(
		{
			elements: state.elements,
			displayTime: state.getRenderTime(),
			tracks: state.tracks,
			getTrackIndexForElement,
			sortByTrackIndex,
			prepare: {
				isExporting: false,
				fps: state.fps,
				canvasSize: state.canvasSize,
				prepareTransitionPictures: true,
				forcePrepareFrames: true,
				awaitReady: true,
				getModelStore: (id) => runtime.modelRegistry.get(id),
			},
		},
		{
			wrapRenderNode: (node) => (
				<EditorRuntimeProvider runtime={createScopedRuntime(runtime)}>
					{node}
				</EditorRuntimeProvider>
			),
		},
	);

	return {
		picture: snapshot.picture,
		dispose: snapshot.dispose,
	};
};

const InfiniteSkiaCanvas: React.FC<InfiniteSkiaCanvasProps> = ({
	width,
	height,
	camera,
	nodes,
	scenes,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const sceneIds = useMemo(
		() => Array.from(new Set(nodes.map((node) => node.sceneId))),
		[nodes],
	);
	const frameEntriesRef = useRef<Map<string, SceneFrameEntry>>(new Map());
	const renderEpochRef = useRef<Map<string, number>>(new Map());
	const queueRef = useRef<Map<string, Promise<void>>>(new Map());
	const [version, setVersion] = useState(0);
	void version;

	useEffect(() => {
		return () => {
			for (const entry of frameEntriesRef.current.values()) {
				entry.dispose();
			}
			frameEntriesRef.current.clear();
			renderEpochRef.current.clear();
			queueRef.current.clear();
		};
	}, []);

	useEffect(() => {
		const subscriptions: Array<() => void> = [];
		const expectedSceneIds = new Set(sceneIds);

		const enqueueBuild = (sceneId: string, build: () => Promise<void>) => {
			const current = queueRef.current.get(sceneId) ?? Promise.resolve();
			const next = current.then(build, build);
			queueRef.current.set(
				sceneId,
				next.then(
					() => undefined,
					() => undefined,
				),
			);
		};

		const renderScene = (sceneId: string, runtime: TimelineRuntime) => {
			const nextEpoch = (renderEpochRef.current.get(sceneId) ?? 0) + 1;
			renderEpochRef.current.set(sceneId, nextEpoch);
			enqueueBuild(sceneId, async () => {
				const targetEpoch = renderEpochRef.current.get(sceneId);
				if (targetEpoch !== nextEpoch) return;
				try {
					const frameEntry = await buildScenePicture(runtime);
					if (!frameEntry) return;
					if (renderEpochRef.current.get(sceneId) !== nextEpoch) {
						frameEntry.dispose();
						return;
					}
					const previous = frameEntriesRef.current.get(sceneId);
					frameEntriesRef.current.set(sceneId, frameEntry);
					previous?.dispose();
					setVersion((value) => value + 1);
				} catch (error) {
					// 画布销毁阶段或模型切换阶段可能抛出短暂错误，保持容错并等待下一次帧更新。
					console.warn(`[InfiniteSkiaCanvas] Failed to render scene ${sceneId}:`, error);
				}
			});
		};

		for (const sceneId of sceneIds) {
			const scene = scenes[sceneId];
			if (!scene) continue;
			const runtime = runtimeManager.ensureTimelineRuntime(toSceneTimelineRef(sceneId));
			const selector = () => buildRenderSignature(runtime);
			subscriptions.push(
				runtime.timelineStore.subscribe(
					selector,
					() => {
						renderScene(sceneId, runtime);
					},
					{ fireImmediately: true },
				),
			);
		}

		for (const [sceneId, entry] of frameEntriesRef.current.entries()) {
			if (expectedSceneIds.has(sceneId)) continue;
			entry.dispose();
			frameEntriesRef.current.delete(sceneId);
			renderEpochRef.current.delete(sceneId);
			queueRef.current.delete(sceneId);
		}

		return () => {
			for (const unsubscribe of subscriptions) {
				unsubscribe();
			}
		};
	}, [runtimeManager, sceneIds, scenes]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			data-testid="infinite-skia-canvas"
			className="absolute inset-0 pointer-events-none"
		>
			<Canvas style={{ width, height }}>
				<Fill color="#111" />
				<Group
					transform={[
						{ translateX: camera.x },
						{ translateY: camera.y },
						{ scale: camera.zoom },
					]}
				>
					{nodes.map((node) => {
						const scene = scenes[node.sceneId];
						if (!scene) return null;
						const entry = frameEntriesRef.current.get(node.sceneId);
						const sourceWidth = Math.max(1, scene.timeline.canvas.width);
						const sourceHeight = Math.max(1, scene.timeline.canvas.height);
						const scaleX = node.width / sourceWidth;
						const scaleY = node.height / sourceHeight;

						return (
							<Group
								key={`scene-skia-${node.id}`}
								clip={{
									x: node.x,
									y: node.y,
									width: node.width,
									height: node.height,
								}}
							>
								<Group
									transform={[
										{ translateX: node.x },
										{ translateY: node.y },
										{ scaleX },
										{ scaleY },
									]}
								>
									{entry ? (
										<Picture picture={entry.picture} />
									) : (
										<Rect
											x={0}
											y={0}
											width={sourceWidth}
											height={sourceHeight}
											color="#171717"
										/>
									)}
								</Group>
							</Group>
						);
					})}
				</Group>
			</Canvas>
		</div>
	);
};

export default InfiniteSkiaCanvas;

