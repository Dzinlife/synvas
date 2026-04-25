import type { TimelineElement, TrackRole } from "core/timeline-system/types";
import type { RefObject } from "react";
import { useCallback } from "react";
import { componentRegistry } from "@/element-system/model/componentRegistry";
import { useProjectStore } from "@/projects/projectStore";
import {
	calculateAutoScrollSpeed,
	type DropTargetInfo,
	resolveMaterialDropTarget,
	useDragStore,
} from "@/scene-editor/drag";
import { findTimelineDropTargetFromScreenPosition } from "@/scene-editor/drag/timelineDropTargets";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { DEFAULT_TRACK_HEIGHT } from "@/scene-editor/timeline/trackConfig";
import { findAttachments } from "@/scene-editor/utils/attachments";
import {
	insertElementIntoMainTrack,
	insertElementsIntoMainTrackGroup,
} from "@/scene-editor/utils/mainTrackMagnet";
import { pasteTimelineClipboardPayload } from "@/scene-editor/utils/timelineClipboard";
import { getPixelsPerFrame } from "@/scene-editor/utils/timelineScale";
import {
	getStoredTrackAssignments,
	getTrackRoleMapFromTracks,
} from "@/scene-editor/utils/trackAssignment";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import {
	buildCanvasClipboardEntries,
	instantiateCanvasClipboardEntries,
} from "@/studio/clipboard/canvasClipboard";
import {
	type StudioTimelineCanvasDropRequest,
	type StudioTimelineClipboardPayload,
	useStudioClipboardStore,
} from "@/studio/clipboard/studioClipboardStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type {
	CanvasNode,
	SceneDocument,
	SceneNode,
} from "@/studio/project/types";
import { secondsToFrames } from "@/utils/timecode";
import { collectCanvasAutoLayoutAncestorBoardIds } from "./canvasBoardAutoLayout";
import {
	allocateInsertSiblingOrder,
	buildLayerTreeOrder,
	resolveLayerSiblingCount,
	sortByTreePaintOrder,
} from "./layerOrderCoordinator";
import {
	type CameraState,
	DROP_GRID_COLUMNS,
	DROP_GRID_OFFSET_X,
	DROP_GRID_OFFSET_Y,
	isCanvasSurfaceTarget,
	isOverlayWheelTarget,
} from "./canvasWorkspaceUtils";
import {
	buildCopyName,
	type CanvasContextMenuState,
	type CanvasGraphHistoryEntry,
	cloneTimelineJson,
	createCanvasEntityId,
	createTimelineClipboardElementId,
	isPointInsideRect,
	normalizeSelectedNodeIds,
	type NodeDragSession,
	resolveTimelineTrackLockedMap,
} from "./canvasWorkspaceModel";

type UseCanvasTimelineClipboardBridgeParams = {
	runtimeManager: StudioRuntimeManager | null;
	normalizedSelectedNodeIds: string[];
	containerRef: RefObject<HTMLDivElement | null>;
	lastPointerClientRef: RefObject<{ x: number; y: number } | null>;
	lastCanvasPointerWorldRef: RefObject<{ x: number; y: number } | null>;
	getCamera: () => CameraState;
	resolveWorldPoint: (
		clientX: number,
		clientY: number,
	) => {
		x: number;
		y: number;
	};
	resolveExpandedNodeIdsWithDescendants: (nodeIds: string[]) => string[];
	commitSelectedNodeIds: (nodeIds: string[]) => void;
	commitAutoLayoutForBoardIds: (
		boardIds: string[],
		sourceNodes: CanvasNode[],
	) => void;
	setContextMenuState: (nextState: CanvasContextMenuState) => void;
};

export const useCanvasTimelineClipboardBridge = ({
	runtimeManager,
	normalizedSelectedNodeIds,
	containerRef,
	lastPointerClientRef,
	lastCanvasPointerWorldRef,
	getCamera,
	resolveWorldPoint,
	resolveExpandedNodeIdsWithDescendants,
	commitSelectedNodeIds,
	commitAutoLayoutForBoardIds,
	setContextMenuState,
}: UseCanvasTimelineClipboardBridgeParams) => {
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const appendCanvasGraphBatch = useProjectStore(
		(state) => state.appendCanvasGraphBatch,
	);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const restoreDetachedSceneNodeForHistory = useProjectStore(
		(state) => state.restoreDetachedSceneNodeForHistory,
	);
	const getSceneTombstone = useProjectStore((state) => state.getSceneTombstone);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const setStudioClipboardPayload = useStudioClipboardStore(
		(state) => state.setPayload,
	);
	const startGlobalDrag = useDragStore((state) => state.startDrag);
	const updateGlobalDragGhost = useDragStore((state) => state.updateGhost);
	const updateGlobalDropTarget = useDragStore(
		(state) => state.updateDropTarget,
	);
	const setGlobalAutoScrollSpeedX = useDragStore(
		(state) => state.setAutoScrollSpeedX,
	);
	const setGlobalAutoScrollSpeedY = useDragStore(
		(state) => state.setAutoScrollSpeedY,
	);
	const stopGlobalAutoScroll = useDragStore((state) => state.stopAutoScroll);
	const endGlobalDrag = useDragStore((state) => state.endDrag);

	const buildCanvasCopyEntries = useCallback((nodeIds: string[]) => {
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject || nodeIds.length === 0) return [];
		const sourceNodeIdSet = new Set(nodeIds);
		const sourceNodes = sortByTreePaintOrder(
			latestProject.canvas.nodes.filter((node) => sourceNodeIdSet.has(node.id)),
		);
		if (sourceNodes.length === 0) return [];
		const targetNodeIdBySourceNodeId = new Map<string, string>();
		for (const sourceNode of sourceNodes) {
			targetNodeIdBySourceNodeId.set(
				sourceNode.id,
				createCanvasEntityId("node"),
			);
		}
		const now = Date.now();
		const copiedEntries = sourceNodes.reduce<CanvasGraphHistoryEntry[]>(
			(entries, sourceNode, index) => {
				const createdAt = now + index;
				const copyName = buildCopyName(sourceNode.name);
				const mappedParentId = sourceNode.parentId
					? (targetNodeIdBySourceNodeId.get(sourceNode.parentId) ?? null)
					: null;
				const baseNode = {
					...sourceNode,
					id: targetNodeIdBySourceNodeId.get(sourceNode.id) ?? sourceNode.id,
					name: copyName,
					parentId: mappedParentId,
					siblingOrder: sourceNode.siblingOrder,
					createdAt,
					updatedAt: createdAt,
				};
				if (sourceNode.type === "scene") {
					const sourceScene = latestProject.scenes[sourceNode.sceneId];
					if (!sourceScene) return entries;
					const sceneId = createCanvasEntityId("scene");
					const scene: SceneDocument = {
						...cloneTimelineJson(sourceScene),
						id: sceneId,
						name: copyName,
						createdAt,
						updatedAt: createdAt,
					};
					const node: SceneNode = {
						...baseNode,
						type: "scene",
						sceneId,
					};
					entries.push({ node, scene });
					return entries;
				}
				entries.push({
					node: baseNode as CanvasNode,
					scene: undefined,
				});
				return entries;
			},
			[],
		);
		if (copiedEntries.length === 0) return copiedEntries;
		const entryByNodeId = new Map(
			copiedEntries.map((entry) => [entry.node.id, entry]),
		);
		const depthByNodeId = new Map<string, number>();
		const resolveDepth = (nodeId: string): number => {
			const cached = depthByNodeId.get(nodeId);
			if (cached !== undefined) return cached;
			const entry = entryByNodeId.get(nodeId);
			if (!entry) return 0;
			const parentId = entry.node.parentId ?? null;
			if (!parentId || !entryByNodeId.has(parentId)) {
				depthByNodeId.set(nodeId, 0);
				return 0;
			}
			const depth = resolveDepth(parentId) + 1;
			depthByNodeId.set(nodeId, depth);
			return depth;
		};
		let workingNodes = [...latestProject.canvas.nodes];
		copiedEntries
			.map((entry, sourceIndex) => ({
				entry,
				sourceIndex,
				depth: resolveDepth(entry.node.id),
			}))
			.sort((left, right) => {
				if (left.depth !== right.depth) return left.depth - right.depth;
				return left.sourceIndex - right.sourceIndex;
			})
			.forEach(({ entry }) => {
				const parentId = entry.node.parentId ?? null;
				const insertIndex = resolveLayerSiblingCount(workingNodes, parentId);
				const { siblingOrder } = allocateInsertSiblingOrder(workingNodes, {
					parentId,
					index: insertIndex,
				});
				entry.node = {
					...entry.node,
					siblingOrder,
				};
				workingNodes = [...workingNodes, entry.node];
			});
		return copiedEntries;
	}, []);

	const resolvePointerTimelineDropTarget = useCallback(() => {
		const pointer = lastPointerClientRef.current;
		if (!pointer) return null;
		return findTimelineDropTargetFromScreenPosition(
			pointer.x,
			pointer.y,
			0,
			DEFAULT_TRACK_HEIGHT,
			false,
		);
	}, [lastPointerClientRef]);

	const resolveDragSessionTimelineNodes = useCallback(
		(dragSession: NodeDragSession) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return [];
			const paintOrderByNodeId = buildLayerTreeOrder(
				latestProject.canvas.nodes,
			).paintOrderByNodeId;
			return dragSession.dragNodeIds
				.map((nodeId) => {
					return (
						latestProject.canvas.nodes.find((node) => node.id === nodeId) ??
						null
					);
				})
				.filter((node): node is CanvasNode => Boolean(node))
				.sort((left, right) => {
					const leftIndex =
						paintOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
					const rightIndex =
						paintOrderByNodeId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
					if (leftIndex !== rightIndex) return leftIndex - rightIndex;
					return left.id.localeCompare(right.id);
				})
				.filter((node) => {
					const definition = getCanvasNodeDefinition(node.type);
					return Boolean(definition.toTimelineClipboardElement);
				});
		},
		[],
	);

	const resolveDragSessionTimelineRole = useCallback(
		(dragSession: NodeDragSession): TrackRole | null => {
			const timelineNodes = resolveDragSessionTimelineNodes(dragSession);
			if (timelineNodes.length === 0) return null;
			return timelineNodes.every((node) => node.type === "audio")
				? "audio"
				: "clip";
		},
		[resolveDragSessionTimelineNodes],
	);

	const resolveDragSessionTimelineDuration = useCallback(
		(dragSession: NodeDragSession, fps: number): number => {
			const timelineNodes = resolveDragSessionTimelineNodes(dragSession);
			const firstNode = timelineNodes[0] ?? null;
			if (
				firstNode &&
				"duration" in firstNode &&
				Number.isFinite(firstNode.duration) &&
				(firstNode.duration ?? 0) > 0
			) {
				return Math.max(1, Math.round(firstNode.duration as number));
			}
			return Math.max(1, secondsToFrames(5, fps));
		},
		[resolveDragSessionTimelineNodes],
	);

	const resolveCanvasNodeTimelineDropTarget = useCallback(
		(
			dragSession: NodeDragSession,
			clientX: number,
			clientY: number,
		): DropTargetInfo | null => {
			const materialRole = resolveDragSessionTimelineRole(dragSession);
			if (!materialRole) return null;
			const timelineRuntime = runtimeManager?.getActiveEditTimelineRuntime();
			if (!timelineRuntime) return null;
			const timelineState = timelineRuntime.timelineStore.getState();
			const ratio = getPixelsPerFrame(
				timelineState.fps,
				timelineState.timelineScale,
			);
			if (!Number.isFinite(ratio) || ratio <= 0) return null;
			return resolveMaterialDropTarget(
				{
					fps: timelineState.fps,
					ratio,
					defaultDurationFrames: Math.max(
						1,
						secondsToFrames(5, timelineState.fps),
					),
					elements: timelineState.elements,
					trackAssignments: getStoredTrackAssignments(timelineState.elements),
					trackRoleMap: getTrackRoleMapFromTracks(timelineState.tracks),
					trackLockedMap: resolveTimelineTrackLockedMap(
						timelineState.tracks,
						timelineState.audioTrackStates,
					),
					trackCount: timelineState.tracks.length || 1,
					rippleEditingEnabled: timelineState.rippleEditingEnabled,
				},
				{
					materialRole,
					materialDurationFrames: resolveDragSessionTimelineDuration(
						dragSession,
						timelineState.fps,
					),
					isTransitionMaterial: false,
				},
				clientX,
				clientY,
			);
		},
		[
			resolveDragSessionTimelineDuration,
			resolveDragSessionTimelineRole,
			runtimeManager,
		],
	);

	const startCanvasTimelineDropPreview = useCallback(
		(dragSession: NodeDragSession, clientX: number, clientY: number) => {
			if (dragSession.globalDragStarted) return;
			const materialRole = resolveDragSessionTimelineRole(dragSession);
			const dragType = materialRole === "audio" ? "audio" : "video";
			startGlobalDrag(
				"external-file",
				{
					type: dragType,
					uri: "",
					name: "Canvas Node",
				},
				{
					screenX: clientX - 60,
					screenY: clientY - 40,
					width: 120,
					height: 80,
					label: "Canvas Node",
				},
			);
			dragSession.globalDragStarted = true;
		},
		[resolveDragSessionTimelineRole, startGlobalDrag],
	);

	const updateCanvasTimelineDropPreview = useCallback(
		(clientX: number, clientY: number, dropTarget: DropTargetInfo | null) => {
			updateGlobalDragGhost({
				screenX: clientX - 60,
				screenY: clientY - 40,
			});
			updateGlobalDropTarget(dropTarget);
			const scrollArea = document.querySelector<HTMLElement>(
				"[data-timeline-scroll-area]",
			);
			if (scrollArea) {
				const rect = scrollArea.getBoundingClientRect();
				const speedX = calculateAutoScrollSpeed(clientX, rect.left, rect.right);
				setGlobalAutoScrollSpeedX(speedX);
			} else {
				setGlobalAutoScrollSpeedX(0);
			}
			const verticalScrollArea = document.querySelector<HTMLElement>(
				"[data-vertical-scroll-area]",
			);
			if (verticalScrollArea) {
				const rect = verticalScrollArea.getBoundingClientRect();
				const speedY = calculateAutoScrollSpeed(clientY, rect.top, rect.bottom);
				setGlobalAutoScrollSpeedY(speedY);
			} else {
				setGlobalAutoScrollSpeedY(0);
			}
		},
		[
			setGlobalAutoScrollSpeedX,
			setGlobalAutoScrollSpeedY,
			updateGlobalDragGhost,
			updateGlobalDropTarget,
		],
	);

	const stopCanvasTimelineDropPreview = useCallback(
		(dragSession: NodeDragSession) => {
			stopGlobalAutoScroll();
			setGlobalAutoScrollSpeedX(0);
			setGlobalAutoScrollSpeedY(0);
			updateGlobalDropTarget(null);
			if (!dragSession.globalDragStarted) return;
			endGlobalDrag();
			dragSession.globalDragStarted = false;
		},
		[
			endGlobalDrag,
			setGlobalAutoScrollSpeedX,
			setGlobalAutoScrollSpeedY,
			stopGlobalAutoScroll,
			updateGlobalDropTarget,
		],
	);

	const buildTimelinePayloadFromCanvasDragSession = useCallback(
		(
			dragSession: NodeDragSession,
			targetSceneId: string | null,
			timelineElements: TimelineElement[],
			fps: number,
			targetCanvasSize: { width: number; height: number } | null,
		) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return null;
			const projectForConversion =
				targetSceneId && latestProject.scenes[targetSceneId]
					? {
							...latestProject,
							scenes: {
								...latestProject.scenes,
								[targetSceneId]: {
									...latestProject.scenes[targetSceneId],
									timeline: {
										...latestProject.scenes[targetSceneId].timeline,
										elements: timelineElements,
										...(targetCanvasSize ? { canvas: targetCanvasSize } : {}),
									},
								},
							},
						}
					: latestProject;
			let nextStartFrame = 0;
			const convertedElements: TimelineElement[] = [];
			const timelineNodes = resolveDragSessionTimelineNodes(dragSession);
			for (const node of timelineNodes) {
				const definition = getCanvasNodeDefinition(node.type);
				const converter = definition.toTimelineClipboardElement;
				if (!converter) continue;
				const scene =
					node.type === "scene"
						? (projectForConversion.scenes[node.sceneId] ?? null)
						: null;
				const assetId = "assetId" in node ? node.assetId : null;
				const asset = assetId
					? (latestProject.assets.find((item) => item.id === assetId) ?? null)
					: null;
				const converted = converter({
					node,
					project: projectForConversion,
					targetSceneId,
					scene,
					asset,
					fps,
					startFrame: nextStartFrame,
					trackIndex: node.type === "audio" ? -1 : 0,
					createElementId: createTimelineClipboardElementId,
				});
				if (!converted) continue;
				convertedElements.push(converted);
				nextStartFrame = Math.max(
					nextStartFrame,
					Math.round(converted.timeline.end),
				);
			}
			if (convertedElements.length === 0) return null;
			const anchorElement = convertedElements[0];
			return {
				elements: convertedElements,
				primaryId: anchorElement.id,
				anchor: {
					assetId: anchorElement.id,
					start: anchorElement.timeline.start,
					trackIndex: anchorElement.timeline.trackIndex ?? 0,
				},
			};
		},
		[resolveDragSessionTimelineNodes],
	);

	const commitCanvasTimelineDrop = useCallback(
		(dragSession: NodeDragSession): boolean => {
			const dropTarget = dragSession.timelineDropTarget;
			if (
				!dropTarget ||
				dropTarget.zone !== "timeline" ||
				!dropTarget.canDrop
			) {
				return false;
			}
			if (
				dropTarget.time === undefined ||
				dropTarget.trackIndex === undefined ||
				!runtimeManager
			) {
				return false;
			}
			const timelineRuntime = runtimeManager.getActiveEditTimelineRuntime();
			if (!timelineRuntime) return false;
			const timelineState = timelineRuntime.timelineStore.getState();
			const payload = buildTimelinePayloadFromCanvasDragSession(
				dragSession,
				timelineRuntime.ref.sceneId,
				timelineState.elements,
				timelineState.fps,
				timelineState.canvasSize,
			);
			if (!payload) return false;
			const postProcessOptions = {
				rippleEditingEnabled: timelineState.rippleEditingEnabled,
				attachments: timelineState.autoAttach
					? findAttachments(timelineState.elements)
					: undefined,
				autoAttach: timelineState.autoAttach,
				fps: timelineState.fps,
				trackLockedMap: resolveTimelineTrackLockedMap(
					timelineState.tracks,
					timelineState.audioTrackStates,
				),
			};
			const pasteResult = pasteTimelineClipboardPayload({
				payload,
				elements: timelineState.elements,
				targetTime: dropTarget.time,
				targetTrackIndex: dropTarget.trackIndex,
				targetType: dropTarget.type ?? "track",
				postProcessOptions,
			});
			if (pasteResult.insertedIds.length === 0) return false;
			const shouldUseMainTrackRippleInsert =
				timelineState.rippleEditingEnabled &&
				(dropTarget.type ?? "track") === "track" &&
				dropTarget.trackIndex === 0;
			const firstInsertedId = pasteResult.insertedIds[0] ?? null;
			const committedElements = shouldUseMainTrackRippleInsert
				? pasteResult.insertedIds.length <= 1 && firstInsertedId
					? insertElementIntoMainTrack(
							pasteResult.elements,
							firstInsertedId,
							dropTarget.time,
							postProcessOptions,
							undefined,
							dropTarget.time,
						)
					: pasteResult.insertedIds.length <= 1
						? pasteResult.elements
						: insertElementsIntoMainTrackGroup(
								pasteResult.elements,
								pasteResult.insertedIds,
								dropTarget.time,
								postProcessOptions,
								dropTarget.time,
							)
				: pasteResult.elements;
			timelineState.setElements(committedElements);
			timelineState.setSelectedIds(
				pasteResult.insertedIds,
				pasteResult.primaryId,
			);
			return true;
		},
		[buildTimelinePayloadFromCanvasDragSession, runtimeManager],
	);

	const resolveCanvasPasteWorldPoint = useCallback(() => {
		const pointer = lastPointerClientRef.current;
		if (pointer && typeof document.elementFromPoint === "function") {
			const target = document.elementFromPoint(pointer.x, pointer.y);
			if (isCanvasSurfaceTarget(target) && !isOverlayWheelTarget(target)) {
				return resolveWorldPoint(pointer.x, pointer.y);
			}
		}
		if (lastCanvasPointerWorldRef.current) {
			return lastCanvasPointerWorldRef.current;
		}
		const container = containerRef.current;
		const currentCamera = getCamera();
		if (!container) {
			return {
				x: -currentCamera.x,
				y: -currentCamera.y,
			};
		}
		const rect = container.getBoundingClientRect();
		return resolveWorldPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2,
		);
	}, [
		containerRef,
		getCamera,
		lastCanvasPointerWorldRef,
		lastPointerClientRef,
		resolveWorldPoint,
	]);

	const resolveNearbyRestoredSceneNode = useCallback(
		(baseNode: SceneNode): SceneNode => {
			const latestProject = useProjectStore.getState().currentProject;
			const anchor = resolveCanvasPasteWorldPoint();
			const width =
				Number.isFinite(baseNode.width) && Math.abs(baseNode.width) > 0
					? baseNode.width
					: 960;
			const height =
				Number.isFinite(baseNode.height) && Math.abs(baseNode.height) > 0
					? baseNode.height
					: 540;
			const existingNodes = latestProject?.canvas.nodes ?? [];
			const overlapsExistingNode = (candidate: SceneNode) => {
				const candidateLeft = Math.min(
					candidate.x,
					candidate.x + candidate.width,
				);
				const candidateRight = Math.max(
					candidate.x,
					candidate.x + candidate.width,
				);
				const candidateTop = Math.min(
					candidate.y,
					candidate.y + candidate.height,
				);
				const candidateBottom = Math.max(
					candidate.y,
					candidate.y + candidate.height,
				);
				return existingNodes.some((node) => {
					if (node.id === candidate.id) return false;
					const nodeLeft = Math.min(node.x, node.x + node.width);
					const nodeRight = Math.max(node.x, node.x + node.width);
					const nodeTop = Math.min(node.y, node.y + node.height);
					const nodeBottom = Math.max(node.y, node.y + node.height);
					return (
						candidateLeft < nodeRight &&
						candidateRight > nodeLeft &&
						candidateTop < nodeBottom &&
						candidateBottom > nodeTop
					);
				});
			};

			for (let index = 0; index < DROP_GRID_COLUMNS * 24; index += 1) {
				const column = index % DROP_GRID_COLUMNS;
				const row = Math.floor(index / DROP_GRID_COLUMNS);
				const candidate: SceneNode = {
					...baseNode,
					x: anchor.x + column * DROP_GRID_OFFSET_X,
					y: anchor.y + row * DROP_GRID_OFFSET_Y,
					width,
					height,
					parentId: null,
					hidden: false,
					locked: false,
					siblingOrder: resolveLayerSiblingCount(existingNodes, null),
				};
				if (!overlapsExistingNode(candidate)) {
					return candidate;
				}
			}

			return {
				...baseNode,
				x: anchor.x,
				y: anchor.y,
				width,
				height,
				parentId: null,
				hidden: false,
				locked: false,
				siblingOrder: resolveLayerSiblingCount(existingNodes, null),
			};
		},
		[resolveCanvasPasteWorldPoint],
	);

	const handleRestoreSceneReferenceToCanvas = useCallback(
		(sceneId: string): boolean => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return false;
			const liveSceneNode = latestProject.canvas.nodes.find(
				(node): node is SceneNode =>
					node.type === "scene" && node.sceneId === sceneId,
			);
			setFocusedNode(null);
			if (liveSceneNode) {
				commitSelectedNodeIds([liveSceneNode.id]);
				return true;
			}
			const scene = latestProject.scenes[sceneId];
			if (!scene) return false;
			const tombstone = getSceneTombstone(sceneId);
			const baseNode: SceneNode = tombstone?.node ?? {
				id:
					typeof crypto !== "undefined" && "randomUUID" in crypto
						? `node-${crypto.randomUUID()}`
						: `node-${Date.now().toString(36)}-${Math.random()
								.toString(36)
								.slice(2, 8)}`,
				type: "scene",
				sceneId,
				name: scene.name,
				x: 0,
				y: 0,
				width:
					scene.timeline.canvas.width > 0 ? scene.timeline.canvas.width : 960,
				height:
					scene.timeline.canvas.height > 0 ? scene.timeline.canvas.height : 540,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				parentId: null,
				createdAt: scene.createdAt,
				updatedAt: scene.updatedAt,
			};
			const restoredNode = resolveNearbyRestoredSceneNode({
				...baseNode,
				name: tombstone?.node.name?.trim() || scene.name,
			});
			restoreDetachedSceneNodeForHistory(restoredNode, {
				layoutOverride: {
					x: restoredNode.x,
					y: restoredNode.y,
					width: restoredNode.width,
					height: restoredNode.height,
					parentId: null,
					hidden: false,
					locked: false,
					siblingOrder: restoredNode.siblingOrder,
				},
			});
			pushHistory({
				kind: "canvas.node-create",
				node: restoredNode,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
			commitSelectedNodeIds([restoredNode.id]);
			return true;
		},
		[
			commitSelectedNodeIds,
			getSceneTombstone,
			pushHistory,
			resolveNearbyRestoredSceneNode,
			restoreDetachedSceneNodeForHistory,
			setFocusedNode,
		],
	);

	const commitCreatedCanvasEntries = useCallback(
		(entries: CanvasGraphHistoryEntry[]): boolean => {
			if (entries.length === 0) return false;
			commitSelectedNodeIds(entries.map((entry) => entry.node.id));
			const latestProject = useProjectStore.getState().currentProject;
			pushHistory({
				kind: "canvas.node-create.batch",
				entries,
				focusNodeId: latestProject?.ui.focusedNodeId ?? null,
			});
			if (latestProject) {
				commitAutoLayoutForBoardIds(
					collectCanvasAutoLayoutAncestorBoardIds(
						latestProject.canvas.nodes,
						entries.map((entry) => entry.node.id),
					),
					latestProject.canvas.nodes,
				);
			}
			setContextMenuState({ open: false });
			return true;
		},
		[
			commitAutoLayoutForBoardIds,
			commitSelectedNodeIds,
			pushHistory,
			setContextMenuState,
		],
	);

	const resolveTimelineClipboardConvertedInputs = useCallback(
		(clipboardPayload: StudioTimelineClipboardPayload) => {
			const sourceCanvasSize =
				clipboardPayload.source?.canvasSize ??
				clipboardPayload.payload.source?.canvasSize ??
				null;
			const sourceFps =
				clipboardPayload.source?.fps ??
				clipboardPayload.payload.source?.fps ??
				30;
			return [...clipboardPayload.payload.elements]
				.sort((left, right) => {
					if (left.timeline.start !== right.timeline.start) {
						return left.timeline.start - right.timeline.start;
					}
					if (left.timeline.end !== right.timeline.end) {
						return left.timeline.end - right.timeline.end;
					}
					return left.id.localeCompare(right.id);
				})
				.map((element) => {
					const definition = componentRegistry.get(element.component);
					const input = definition?.toCanvasClipboardNode?.({
						element,
						sourceCanvasSize,
						fps: sourceFps,
					});
					if (!input) return null;
					const nextName = buildCopyName(input.name ?? element.name ?? "");
					return {
						...input,
						name: nextName,
						x:
							Number.isFinite(input.x as number) && input.x !== undefined
								? input.x
								: 0,
						y:
							Number.isFinite(input.y as number) && input.y !== undefined
								? input.y
								: 0,
					};
				})
				.filter((input): input is NonNullable<typeof input> => Boolean(input));
		},
		[],
	);

	const createTimelineClipboardConvertedNodesAt = useCallback(
		(
			convertedInputs: ReturnType<
				typeof resolveTimelineClipboardConvertedInputs
			>,
			anchorPoint: { x: number; y: number },
		): boolean => {
			if (convertedInputs.length === 0) return false;
			const sourceLeft = convertedInputs.reduce((minValue, input) => {
				return Math.min(minValue, input.x ?? 0);
			}, Number.POSITIVE_INFINITY);
			const sourceTop = convertedInputs.reduce((minValue, input) => {
				return Math.min(minValue, input.y ?? 0);
			}, Number.POSITIVE_INFINITY);
			const safeLeft = Number.isFinite(sourceLeft) ? sourceLeft : 0;
			const safeTop = Number.isFinite(sourceTop) ? sourceTop : 0;
			const createdEntries: CanvasGraphHistoryEntry[] = [];
			for (const input of convertedInputs) {
				const nodeId = createCanvasNode({
					...input,
					x: (input.x ?? 0) - safeLeft + anchorPoint.x,
					y: (input.y ?? 0) - safeTop + anchorPoint.y,
				});
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) continue;
				const node = latestProject.canvas.nodes.find(
					(candidate) => candidate.id === nodeId,
				);
				if (!node) continue;
				createdEntries.push({
					node,
					scene:
						node.type === "scene"
							? latestProject.scenes[node.sceneId]
							: undefined,
				});
			}
			return commitCreatedCanvasEntries(createdEntries);
		},
		[commitCreatedCanvasEntries, createCanvasNode],
	);

	const handleDropTimelineElementsToCanvas = useCallback(
		({
			payload,
			clientX,
			clientY,
		}: StudioTimelineCanvasDropRequest): boolean => {
			const isCanvasDropPoint = (() => {
				if (typeof document === "undefined") return false;
				const timelineEditors = document.querySelectorAll<HTMLElement>(
					'[data-testid="timeline-editor"]',
				);
				for (const timelineEditor of timelineEditors) {
					if (
						isPointInsideRect(
							clientX,
							clientY,
							timelineEditor.getBoundingClientRect(),
						)
					) {
						return false;
					}
				}
				const drawerOverlays = document.querySelectorAll<HTMLElement>(
					'[data-testid="canvas-overlay-drawer"]',
				);
				for (const drawerOverlay of drawerOverlays) {
					if (
						isPointInsideRect(
							clientX,
							clientY,
							drawerOverlay.getBoundingClientRect(),
						)
					) {
						return false;
					}
				}
				if (typeof document.elementFromPoint === "function") {
					const hit = document.elementFromPoint(clientX, clientY);
					if (hit instanceof HTMLElement) {
						if (hit.closest("[data-track-drop-zone]")) return false;
					}
					if (hit && isOverlayWheelTarget(hit)) return false;
					if (hit && isCanvasSurfaceTarget(hit)) return true;
				}
				const timelineDropZones = document.querySelectorAll<HTMLElement>(
					"[data-track-drop-zone]",
				);
				for (const zone of timelineDropZones) {
					if (
						!isPointInsideRect(clientX, clientY, zone.getBoundingClientRect())
					) {
						continue;
					}
					return false;
				}
				const overlayLayers = document.querySelectorAll<HTMLElement>(
					'[data-canvas-overlay-ui="true"]',
				);
				for (const layer of overlayLayers) {
					if (
						!isPointInsideRect(clientX, clientY, layer.getBoundingClientRect())
					) {
						continue;
					}
					return false;
				}
				const surfaces = document.querySelectorAll<HTMLElement>(
					'[data-canvas-surface="true"]',
				);
				for (const surface of surfaces) {
					if (
						isPointInsideRect(clientX, clientY, surface.getBoundingClientRect())
					) {
						return true;
					}
				}
				return false;
			})();
			if (!isCanvasDropPoint) return false;
			const convertedInputs = resolveTimelineClipboardConvertedInputs(payload);
			if (convertedInputs.length === 0) return true;
			const worldPoint = resolveWorldPoint(clientX, clientY);
			createTimelineClipboardConvertedNodesAt(convertedInputs, worldPoint);
			return true;
		},
		[
			createTimelineClipboardConvertedNodesAt,
			resolveTimelineClipboardConvertedInputs,
			resolveWorldPoint,
		],
	);

	const copyNodeIdsToClipboard = useCallback(
		(nodeIds: string[]): boolean => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject || nodeIds.length === 0) {
				return false;
			}
			const normalizedNodeIds = normalizeSelectedNodeIds(
				nodeIds,
				new Set(latestProject.canvas.nodes.map((node) => node.id)),
			);
			if (normalizedNodeIds.length === 0) return false;
			const expandedNodeIds =
				resolveExpandedNodeIdsWithDescendants(normalizedNodeIds);
			if (expandedNodeIds.length === 0) return false;
			const entries = buildCanvasClipboardEntries(
				latestProject,
				expandedNodeIds,
			);
			if (entries.length === 0) return false;
			setStudioClipboardPayload({
				kind: "canvas-nodes",
				entries,
			});
			return true;
		},
		[resolveExpandedNodeIdsWithDescendants, setStudioClipboardPayload],
	);

	const canPasteClipboardPayloadToCanvas = useCallback((): boolean => {
		const clipboardPayload = useStudioClipboardStore.getState().payload;
		if (!clipboardPayload) return false;
		if (clipboardPayload.kind === "canvas-nodes") {
			return clipboardPayload.entries.some((entry) => {
				if (entry.node.type !== "scene") return true;
				return Boolean(entry.scene);
			});
		}
		return resolveTimelineClipboardConvertedInputs(clipboardPayload).length > 0;
	}, [resolveTimelineClipboardConvertedInputs]);

	const pasteFromClipboardToCanvasAt = useCallback(
		(anchorPoint: { x: number; y: number }): boolean => {
			const clipboardPayload = useStudioClipboardStore.getState().payload;
			if (!clipboardPayload) return false;
			if (clipboardPayload.kind === "canvas-nodes") {
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) return false;
				const entries = instantiateCanvasClipboardEntries({
					sourceEntries: clipboardPayload.entries,
					targetLeft: anchorPoint.x,
					targetTop: anchorPoint.y,
					existingNodes: latestProject.canvas.nodes,
				});
				if (entries.length === 0) return false;
				appendCanvasGraphBatch(entries);
				return commitCreatedCanvasEntries(entries);
			}
			const convertedInputs =
				resolveTimelineClipboardConvertedInputs(clipboardPayload);
			if (convertedInputs.length === 0) return false;
			return createTimelineClipboardConvertedNodesAt(
				convertedInputs,
				anchorPoint,
			);
		},
		[
			appendCanvasGraphBatch,
			commitCreatedCanvasEntries,
			createTimelineClipboardConvertedNodesAt,
			resolveTimelineClipboardConvertedInputs,
		],
	);

	const copySelectedNodesToClipboard = useCallback((): boolean => {
		return copyNodeIdsToClipboard(normalizedSelectedNodeIds);
	}, [copyNodeIdsToClipboard, normalizedSelectedNodeIds]);

	return {
		buildCanvasCopyEntries,
		canPasteClipboardPayloadToCanvas,
		commitCanvasTimelineDrop,
		copyNodeIdsToClipboard,
		copySelectedNodesToClipboard,
		handleDropTimelineElementsToCanvas,
		handleRestoreSceneReferenceToCanvas,
		pasteFromClipboardToCanvasAt,
		resolveCanvasNodeTimelineDropTarget,
		resolveCanvasPasteWorldPoint,
		resolvePointerTimelineDropTarget,
		startCanvasTimelineDropPreview,
		stopCanvasTimelineDropPreview,
		updateCanvasTimelineDropPreview,
	};
};
