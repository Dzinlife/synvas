import React, { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { TimelineElement as TimelineElementType } from "@nle/dsl/types";
import { clampFrame } from "@nle/utils/timecode";
import {
	useAttachments,
	useCurrentTime,
	useElements,
	useFps,
	useMainTrackMagnet,
} from "../contexts/TimelineContext";
import {
	resolveMaterialDropTarget,
	useDragStore,
	useMaterialDndContext,
} from "../drag";
import { calculateAutoScrollSpeed, type MaterialDragData } from "../drag/dragStore";
import {
	type ExternalVideoMetadata,
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
	writeVideoToOpfs,
} from "../utils/externalVideo";
import {
	finalizeTimelineElements,
	insertElementIntoMainTrack,
} from "../utils/mainTrackMagnet";
import {
	findAvailableTrack,
	getStoredTrackAssignments,
	getTrackCount,
} from "../utils/trackAssignment";
import { buildTimelineMeta } from "../utils/timelineTime";

export interface UseExternalMaterialDndOptions {
	scrollAreaRef: React.RefObject<HTMLDivElement>;
	verticalScrollRef: React.RefObject<HTMLDivElement>;
}

export function useExternalMaterialDnd({
	scrollAreaRef,
	verticalScrollRef,
}: UseExternalMaterialDndOptions) {
	const { fps } = useFps();
	const { currentTime } = useCurrentTime();
	const { setElements } = useElements();
	const { attachments, autoAttach } = useAttachments();
	const { mainTrackMagnetEnabled } = useMainTrackMagnet();
	const materialDndContext = useMaterialDndContext();
	const trackLockedMap = materialDndContext.trackLockedMap;

	const {
		startDrag,
		updateGhost,
		updateDropTarget,
		endDrag,
		setAutoScrollSpeedX,
		setAutoScrollSpeedY,
		stopAutoScroll,
	} = useDragStore();

	const externalDragActiveRef = useRef(false);
	const externalDragOffsetRef = useRef({ x: 0, y: 0 });

	const hasExternalFileDrag = useCallback(
		(dataTransfer: DataTransfer | null): boolean => {
			if (!dataTransfer) return false;
			if (dataTransfer.types?.includes("Files")) return true;
			if (dataTransfer.items) {
				return Array.from(dataTransfer.items).some(
					(item) => item.kind === "file",
				);
			}
			return false;
		},
		[],
	);

	const getExternalVideoFiles = useCallback(
		(dataTransfer: DataTransfer | null) => {
			if (!dataTransfer) return [];
			const files = Array.from(dataTransfer.files);
			if (files.length > 0) {
				return files.filter((file) => isVideoFile(file));
			}
			if (dataTransfer.items) {
				const items = Array.from(dataTransfer.items);
				return items
					.map((item) => (item.kind === "file" ? item.getAsFile() : null))
					.filter((file): file is File => Boolean(file))
					.filter((file) => isVideoFile(file));
			}
			return [];
		},
		[],
	);

	const resolveExternalDropTarget = useCallback(
		(clientX: number, clientY: number) => {
			return resolveMaterialDropTarget(
				materialDndContext,
				{
					materialRole: "clip",
					materialDurationFrames: materialDndContext.defaultDurationFrames,
					isTransitionMaterial: false,
				},
				clientX,
				clientY,
			);
		},
		[materialDndContext],
	);

	const handleExternalDragEnter = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			if (!hasExternalFileDrag(event.dataTransfer)) return;
			event.preventDefault();
			if (externalDragActiveRef.current) return;
			externalDragActiveRef.current = true;
			externalDragOffsetRef.current = { x: 60, y: 40 };
			const dragData: MaterialDragData = {
				type: "video",
				uri: "",
				name: "视频文件",
				duration: materialDndContext.defaultDurationFrames,
			};
			startDrag("external-file", dragData, {
				screenX: event.clientX - externalDragOffsetRef.current.x,
				screenY: event.clientY - externalDragOffsetRef.current.y,
				width: 120,
				height: 80,
				label: dragData.name,
			});
		},
		[
			hasExternalFileDrag,
			materialDndContext.defaultDurationFrames,
			startDrag,
		],
	);

	const handleExternalDragOver = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			if (!hasExternalFileDrag(event.dataTransfer)) return;
			event.preventDefault();
			event.stopPropagation();

			if (!externalDragActiveRef.current) {
				externalDragActiveRef.current = true;
				externalDragOffsetRef.current = { x: 60, y: 40 };
				const dragData: MaterialDragData = {
					type: "video",
					uri: "",
					name: "视频文件",
					duration: materialDndContext.defaultDurationFrames,
				};
				startDrag("external-file", dragData, {
					screenX: event.clientX - externalDragOffsetRef.current.x,
					screenY: event.clientY - externalDragOffsetRef.current.y,
					width: 120,
					height: 80,
					label: dragData.name,
				});
			}

			updateGhost({
				screenX: event.clientX - externalDragOffsetRef.current.x,
				screenY: event.clientY - externalDragOffsetRef.current.y,
			});
			const dropTarget = resolveExternalDropTarget(
				event.clientX,
				event.clientY,
			);
			updateDropTarget(dropTarget);

			const scrollArea = scrollAreaRef.current;
			if (scrollArea) {
				const rect = scrollArea.getBoundingClientRect();
				const speedX = calculateAutoScrollSpeed(
					event.clientX,
					rect.left,
					rect.right,
				);
				setAutoScrollSpeedX(speedX);
			}

			const verticalScrollArea = verticalScrollRef.current;
			if (verticalScrollArea) {
				const rect = verticalScrollArea.getBoundingClientRect();
				const speedY = calculateAutoScrollSpeed(
					event.clientY,
					rect.top,
					rect.bottom,
				);
				setAutoScrollSpeedY(speedY);
			}
		},
		[
			hasExternalFileDrag,
			materialDndContext.defaultDurationFrames,
			resolveExternalDropTarget,
			scrollAreaRef,
			setAutoScrollSpeedX,
			setAutoScrollSpeedY,
			startDrag,
			updateDropTarget,
			updateGhost,
			verticalScrollRef,
		],
	);

	const handleExternalDragLeave = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			if (!hasExternalFileDrag(event.dataTransfer)) return;
			event.preventDefault();
			stopAutoScroll();
			externalDragActiveRef.current = false;
			updateDropTarget(null);
			endDrag();
		},
		[hasExternalFileDrag, stopAutoScroll, updateDropTarget, endDrag],
	);

	const handleExternalDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			const files = getExternalVideoFiles(event.dataTransfer);
			if (files.length === 0) return;
			event.preventDefault();
			event.stopPropagation();

			const dropTarget =
				useDragStore.getState().dropTarget ??
				resolveExternalDropTarget(event.clientX, event.clientY);
			stopAutoScroll();
			externalDragActiveRef.current = false;
			updateDropTarget(null);
			endDrag();

			const prepared: {
				file: File;
				uri: string;
				metadata: ExternalVideoMetadata;
			}[] = [];
			for (const file of files) {
				try {
					const { uri } = await writeVideoToOpfs(file);
					const metadata = await readVideoMetadata(file).catch(() =>
						getFallbackVideoMetadata(),
					);
					prepared.push({
						file,
						uri,
						metadata,
					});
				} catch (error) {
					console.warn("外部视频导入失败:", error);
					toast.error(`导入失败：${file.name}`);
				}
			}

			if (prepared.length === 0) return;

			const primaryDurationFrames = Math.max(
				1,
				Math.round(prepared[0].metadata.duration * fps),
			);
			const resolvedDropTarget =
				resolveMaterialDropTarget(
					materialDndContext,
					{
						materialRole: "clip",
						materialDurationFrames: primaryDurationFrames,
						isTransitionMaterial: false,
					},
					event.clientX,
					event.clientY,
				) ?? dropTarget;

			if (!resolvedDropTarget || !resolvedDropTarget.canDrop) return;

			if (resolvedDropTarget.zone === "preview") {
				const canvasX = resolvedDropTarget.canvasX ?? 0;
				const canvasY = resolvedDropTarget.canvasY ?? 0;
				setElements((prev) => {
					let nextElements = prev;
					let nextStart = clampFrame(currentTime);
					const assignments = getStoredTrackAssignments(prev);
					let nextTrackCount = getTrackCount(assignments);

					prepared.forEach((item, index) => {
						const durationFrames = Math.max(
							1,
							Math.round(item.metadata.duration * fps),
						);
						const startFrame = nextStart;
						const endFrame = startFrame + durationFrames;
						const newId = `external-video-${Date.now()}-${index}`;
						const finalTrack = findAvailableTrack(
							startFrame,
							endFrame,
							1,
							"clip",
							nextElements,
							assignments,
							newId,
							nextTrackCount,
						);
						const newElement: TimelineElementType = {
							id: newId,
							type: "VideoClip",
							component: "video-clip",
							name: item.file.name,
							props: {
								uri: item.uri,
							},
							transform: {
								centerX: canvasX,
								centerY: canvasY,
								width: item.metadata.width,
								height: item.metadata.height,
								rotation: 0,
							},
							timeline: buildTimelineMeta(
								{
									start: startFrame,
									end: endFrame,
									trackIndex: finalTrack,
									role: "clip",
								},
								fps,
							),
							render: {
								zIndex: 0,
								visible: true,
								opacity: 1,
							},
						};

						nextElements = [...nextElements, newElement];
						assignments.set(newId, finalTrack);
						nextTrackCount = Math.max(nextTrackCount, finalTrack + 1);
						nextStart = endFrame;
					});

					return nextElements;
				});
				return;
			}

			if (resolvedDropTarget.zone !== "timeline") return;

			setElements((prev) => {
				let nextElements = prev;
				let nextStart = clampFrame(resolvedDropTarget.time ?? 0);
				let targetTrackIndex = resolvedDropTarget.trackIndex ?? 0;
				let targetType: "track" | "gap" = resolvedDropTarget.type ?? "track";

				const postProcessOptions = {
					mainTrackMagnetEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap,
				};

				prepared.forEach((item, index) => {
					const durationFrames = Math.max(
						1,
						Math.round(item.metadata.duration * fps),
					);
					const startFrame = nextStart;
					const endFrame = startFrame + durationFrames;
					const insertIndex =
						targetType === "gap"
							? Math.max(1, targetTrackIndex)
							: targetTrackIndex;

					const newElement: TimelineElementType = {
						id: `external-video-${Date.now()}-${index}`,
						type: "VideoClip",
						component: "video-clip",
						name: item.file.name,
						props: {
							uri: item.uri,
						},
						transform: {
							centerX: 0,
							centerY: 0,
							width: item.metadata.width,
							height: item.metadata.height,
							rotation: 0,
						},
						timeline: buildTimelineMeta(
							{
								start: startFrame,
								end: endFrame,
								trackIndex: insertIndex,
								role: "clip",
							},
							fps,
						),
						render: {
							zIndex: 0,
							visible: true,
							opacity: 1,
						},
					};

					if (targetType === "gap") {
						const shifted = nextElements.map((el) => {
							const currentTrack = el.timeline.trackIndex ?? 0;
							if (currentTrack >= insertIndex) {
								return {
									...el,
									timeline: {
										...el.timeline,
										trackIndex: currentTrack + 1,
									},
								};
							}
							return el;
						});
						nextElements = finalizeTimelineElements(
							[...shifted, newElement],
							postProcessOptions,
						);
						targetType = "track";
					} else if (mainTrackMagnetEnabled && insertIndex === 0) {
						nextElements = insertElementIntoMainTrack(
							nextElements,
							newElement.id,
							startFrame,
							postProcessOptions,
							newElement,
						);
					} else {
						nextElements = finalizeTimelineElements(
							[...nextElements, newElement],
							postProcessOptions,
						);
					}

					const inserted = nextElements.find((el) => el.id === newElement.id);
					nextStart = inserted ? inserted.timeline.end : endFrame;
				});

				return nextElements;
			});
		},
		[
			getExternalVideoFiles,
			resolveExternalDropTarget,
			stopAutoScroll,
			updateDropTarget,
			endDrag,
			setElements,
			currentTime,
			fps,
			materialDndContext,
			mainTrackMagnetEnabled,
			attachments,
			autoAttach,
			trackLockedMap,
		],
	);

	return {
		handleExternalDragEnter,
		handleExternalDragOver,
		handleExternalDragLeave,
		handleExternalDrop,
	};
}
