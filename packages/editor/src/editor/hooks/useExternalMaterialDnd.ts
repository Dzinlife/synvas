import type {
	TimelineElement as TimelineElementType,
	TrackRole,
} from "core/dsl/types";
import { insertElementIntoMainTrack } from "core/editor/utils/mainTrackMagnet";
import type React from "react";
import { useCallback, useRef } from "react";
import {
	isAudioFile,
	readAudioMetadata,
	writeAudioToOpfs,
} from "@/asr/opfsAudio";
import { createTransformMeta } from "@/dsl/transform";
import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";
import { toast } from "@/lib/toast";
import { useProjectStore } from "@/projects/projectStore";
import { clampFrame } from "@/utils/timecode";
import {
	useAttachments,
	useCurrentTime,
	useElements,
	useFps,
	useRippleEditing,
} from "../contexts/TimelineContext";
import {
	resolveMaterialDropTarget,
	useDragStore,
	useMaterialDndContext,
} from "../drag";
import {
	calculateAutoScrollSpeed,
	type MaterialDragData,
} from "../drag/dragStore";
import {
	type ExternalVideoMetadata,
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
	resolveExternalVideoUri,
} from "../utils/externalVideo";
import { finalizeTimelineElements } from "../utils/mainTrackMagnet";
import { buildTimelineMeta } from "../utils/timelineTime";
import {
	findAvailableTrack,
	getStoredTrackAssignments,
	getTrackCount,
	insertTrackAt,
} from "../utils/trackAssignment";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"bmp",
	"svg",
	"heic",
	"heif",
	"tiff",
	"tif",
	"avif",
	"ico",
	"psd",
]);

const DEFAULT_IMAGE_WIDTH = 1920;
const DEFAULT_IMAGE_HEIGHT = 1080;
const FILE_PREFIX = "file://";

type FileWithPath = File & { path?: string };

const isImageFile = (file: File): boolean => {
	if (file.type.startsWith("image/")) return true;
	const parts = file.name.toLowerCase().split(".");
	if (parts.length < 2) return false;
	const ext = parts[parts.length - 1];
	return IMAGE_EXTENSIONS.has(ext);
};

const getFilePath = (file: File): string | null => {
	const rawPath = (file as FileWithPath).path;
	if (typeof rawPath !== "string") return null;
	const trimmed = rawPath.trim();
	return trimmed ? trimmed : null;
};

const getElectronFilePath = (file: File): string | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				webUtils?: {
					getPathForFile?: (file: File) => string | null | undefined;
				};
			};
		}
	).aiNleElectron;
	const resolved = bridge?.webUtils?.getPathForFile?.(file);
	if (typeof resolved !== "string") return null;
	const trimmed = resolved.trim();
	return trimmed ? trimmed : null;
};

const buildFileUrlFromPath = (rawPath: string): string => {
	if (rawPath.startsWith(FILE_PREFIX)) return rawPath;
	const normalized = rawPath.replace(/\\/g, "/");
	let pathPart = normalized;
	let isUnc = false;

	if (pathPart.startsWith("//")) {
		isUnc = true;
		pathPart = pathPart.slice(2);
	} else if (/^[a-zA-Z]:\//.test(pathPart)) {
		pathPart = `/${pathPart}`;
	} else if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}

	const encoded = pathPart
		.split("/")
		.map((segment) => {
			if (!segment) return "";
			if (!isUnc && /^[a-zA-Z]:$/.test(segment)) return segment;
			return encodeURIComponent(segment);
		})
		.join("/");

	return `${FILE_PREFIX}${encoded}`;
};

const resolveExternalFileUrl = (file: File): string | null => {
	if (typeof window === "undefined" || !("aiNleElectron" in window)) {
		return null;
	}
	const filePath = getFilePath(file) ?? getElectronFilePath(file);
	return filePath ? buildFileUrlFromPath(filePath) : null;
};

const readImageMetadata = async (
	file: File,
): Promise<{ width: number; height: number }> => {
	const url = URL.createObjectURL(file);
	const image = new Image();
	image.src = url;

	try {
		const metadata = await new Promise<{ width: number; height: number }>(
			(resolve, reject) => {
				const cleanup = () => {
					image.src = "";
				};

				image.onload = () => {
					resolve({
						width: image.naturalWidth || DEFAULT_IMAGE_WIDTH,
						height: image.naturalHeight || DEFAULT_IMAGE_HEIGHT,
					});
					cleanup();
				};
				image.onerror = () => {
					reject(new Error("读取图片元数据失败"));
					cleanup();
				};
			},
		);
		return metadata;
	} finally {
		URL.revokeObjectURL(url);
	}
};

export interface UseExternalMaterialDndOptions {
	scrollAreaRef: React.RefObject<HTMLDivElement | null>;
	verticalScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function useExternalMaterialDnd({
	scrollAreaRef,
	verticalScrollRef,
}: UseExternalMaterialDndOptions) {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const { fps } = useFps();
	const { currentTime } = useCurrentTime();
	const { setElements } = useElements();
	const { attachments, autoAttach } = useAttachments();
	const { rippleEditingEnabled } = useRippleEditing();
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
	const externalDragTypeRef = useRef<"video" | "audio" | "image" | null>(null);

	const hasExternalFileDrag = useCallback(
		(dataTransfer: DataTransfer | null): boolean => {
			if (!dataTransfer) return false;
			if (
				Array.from(dataTransfer.types ?? []).some(
					(type) =>
						type === "Files" ||
						type === "public.file-url" ||
						type === "text/uri-list" ||
						type === "application/x-moz-file" ||
						type.toLowerCase().includes("file"),
				)
			) {
				return true;
			}
			if (dataTransfer.files && dataTransfer.files.length > 0) {
				return true;
			}
			if (dataTransfer.items) {
				if (dataTransfer.items.length > 0) {
					return true;
				}
				return Array.from(dataTransfer.items).some(
					(item) => item.kind === "file",
				);
			}
			return false;
		},
		[],
	);

	const getExternalAllFiles = useCallback(
		(dataTransfer: DataTransfer | null) => {
			if (!dataTransfer) return [];
			const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
			const itemFiles = items
				.map((item) => (item.kind === "file" ? item.getAsFile() : null))
				.filter((file): file is File => Boolean(file));
			const files = Array.from(dataTransfer.files);
			if (files.length > 0) return files;
			return itemFiles;
		},
		[],
	);

	const isElectron = typeof window !== "undefined" && "aiNleElectron" in window;

	const getExternalVideoFiles = useCallback(
		(dataTransfer: DataTransfer | null) => {
			if (!dataTransfer) return [];
			const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
			const itemFiles = items
				.map((item) => (item.kind === "file" ? item.getAsFile() : null))
				.filter((file): file is File => Boolean(file));
			const itemVideoFiles = itemFiles.filter((file) => isVideoFile(file));
			if (isElectron) {
				const hasFilePath = (file: File): boolean => {
					const rawPath = (file as File & { path?: string }).path;
					return typeof rawPath === "string" && rawPath.trim().length > 0;
				};
				const itemWithPath = itemVideoFiles.filter((file) => hasFilePath(file));
				if (itemWithPath.length > 0) return itemWithPath;
			}
			const files = Array.from(dataTransfer.files);
			if (files.length > 0) {
				return files.filter((file) => isVideoFile(file));
			}
			return itemVideoFiles;
		},
		[isElectron],
	);

	const getExternalImageFiles = useCallback(
		(dataTransfer: DataTransfer | null) => {
			if (!dataTransfer) return [];
			const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
			const itemFiles = items
				.map((item) => (item.kind === "file" ? item.getAsFile() : null))
				.filter((file): file is File => Boolean(file));
			const itemImageFiles = itemFiles.filter((file) => isImageFile(file));
			if (isElectron) {
				const hasFilePath = (file: File): boolean => {
					const rawPath = (file as File & { path?: string }).path;
					return typeof rawPath === "string" && rawPath.trim().length > 0;
				};
				const itemWithPath = itemImageFiles.filter((file) => hasFilePath(file));
				if (itemWithPath.length > 0) return itemWithPath;
			}
			const files = Array.from(dataTransfer.files);
			if (files.length > 0) {
				return files.filter((file) => isImageFile(file));
			}
			return itemImageFiles;
		},
		[isElectron],
	);

	const resolveExternalAudioUri = useCallback(
		async (file: File) => {
			if (isElectron) {
				const fileUrl = resolveExternalFileUrl(file);
				if (!fileUrl) {
					throw new Error("无法读取本地音频文件路径");
				}
				return fileUrl;
			}
			if (!currentProjectId) {
				throw new Error("当前项目不存在，无法写入 OPFS");
			}
			const { uri } = await writeAudioToOpfs(file, currentProjectId);
			return uri;
		},
		[isElectron, currentProjectId],
	);

	const resolveExternalImageUri = useCallback(
		async (file: File) => {
			if (isElectron) {
				const fileUrl = resolveExternalFileUrl(file);
				if (!fileUrl) {
					throw new Error("无法读取本地图片文件路径");
				}
				return fileUrl;
			}
			if (!currentProjectId) {
				throw new Error("当前项目不存在，无法写入 OPFS");
			}
			const { uri } = await writeProjectFileToOpfs(
				file,
				currentProjectId,
				"images",
			);
			return uri;
		},
		[isElectron, currentProjectId],
	);

	const resolveExternalDropTarget = useCallback(
		(clientX: number, clientY: number, materialRole: TrackRole) => {
			return resolveMaterialDropTarget(
				materialDndContext,
				{
					materialRole,
					materialDurationFrames: materialDndContext.defaultDurationFrames,
					isTransitionMaterial: false,
				},
				clientX,
				clientY,
			);
		},
		[materialDndContext],
	);

	const getExternalAudioFiles = useCallback(
		(dataTransfer: DataTransfer | null) => {
			if (!dataTransfer) return [];
			const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
			const itemFiles = items
				.map((item) => (item.kind === "file" ? item.getAsFile() : null))
				.filter((file): file is File => Boolean(file));
			const itemAudioFiles = itemFiles.filter((file) => isAudioFile(file));
			if (isElectron) {
				const hasFilePath = (file: File): boolean => {
					const rawPath = (file as File & { path?: string }).path;
					return typeof rawPath === "string" && rawPath.trim().length > 0;
				};
				const itemWithPath = itemAudioFiles.filter((file) => hasFilePath(file));
				if (itemWithPath.length > 0) return itemWithPath;
			}
			const files = Array.from(dataTransfer.files);
			if (files.length > 0) {
				return files.filter((file) => isAudioFile(file));
			}
			return itemAudioFiles;
		},
		[isElectron],
	);

	const handleExternalDragEnter = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (!hasExternalFileDrag(event.dataTransfer)) return;
			if (externalDragActiveRef.current) return;
			externalDragActiveRef.current = true;
			externalDragOffsetRef.current = { x: 60, y: 40 };
			const audioFiles = getExternalAudioFiles(event.dataTransfer);
			const imageFiles = getExternalImageFiles(event.dataTransfer);
			const videoFiles = getExternalVideoFiles(event.dataTransfer);
			const dragType =
				audioFiles.length > 0 &&
				videoFiles.length === 0 &&
				imageFiles.length === 0
					? "audio"
					: imageFiles.length > 0 &&
							videoFiles.length === 0 &&
							audioFiles.length === 0
						? "image"
						: "video";
			externalDragTypeRef.current = dragType;
			const dragData: MaterialDragData = {
				type: dragType,
				uri: "",
				name:
					dragType === "audio"
						? "音频文件"
						: dragType === "image"
							? "图片文件"
							: "视频文件",
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
			getExternalImageFiles,
			getExternalAudioFiles,
			getExternalVideoFiles,
			materialDndContext.defaultDurationFrames,
			startDrag,
		],
	);

	const handleExternalDragOver = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (!hasExternalFileDrag(event.dataTransfer)) return;

			if (!externalDragActiveRef.current) {
				externalDragActiveRef.current = true;
				externalDragOffsetRef.current = { x: 60, y: 40 };
				const audioFiles = getExternalAudioFiles(event.dataTransfer);
				const imageFiles = getExternalImageFiles(event.dataTransfer);
				const videoFiles = getExternalVideoFiles(event.dataTransfer);
				const dragType =
					audioFiles.length > 0 &&
					videoFiles.length === 0 &&
					imageFiles.length === 0
						? "audio"
						: imageFiles.length > 0 &&
								videoFiles.length === 0 &&
								audioFiles.length === 0
							? "image"
							: "video";
				externalDragTypeRef.current = dragType;
				const dragData: MaterialDragData = {
					type: dragType,
					uri: "",
					name:
						dragType === "audio"
							? "音频文件"
							: dragType === "image"
								? "图片文件"
								: "视频文件",
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
			const dragType =
				externalDragTypeRef.current ??
				(getExternalAudioFiles(event.dataTransfer).length > 0 &&
				getExternalVideoFiles(event.dataTransfer).length === 0 &&
				getExternalImageFiles(event.dataTransfer).length === 0
					? "audio"
					: getExternalImageFiles(event.dataTransfer).length > 0 &&
							getExternalVideoFiles(event.dataTransfer).length === 0 &&
							getExternalAudioFiles(event.dataTransfer).length === 0
						? "image"
						: "video");
			const dropTarget = resolveExternalDropTarget(
				event.clientX,
				event.clientY,
				dragType === "audio" ? "audio" : "clip",
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
			getExternalAudioFiles,
			getExternalImageFiles,
			getExternalVideoFiles,
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
			externalDragTypeRef.current = null;
			updateDropTarget(null);
			endDrag();
		},
		[hasExternalFileDrag, stopAutoScroll, updateDropTarget, endDrag],
	);

	const handleExternalDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const videoFiles = getExternalVideoFiles(event.dataTransfer);
			const audioFiles = getExternalAudioFiles(event.dataTransfer);
			const imageFiles = getExternalImageFiles(event.dataTransfer);
			const allFiles = getExternalAllFiles(event.dataTransfer);
			const hasAudio = audioFiles.length > 0;
			const hasImage = imageFiles.length > 0;
			const hasVideo = videoFiles.length > 0;
			if (!hasVideo && !hasAudio && !hasImage) {
				if (allFiles.length > 0) {
					toast.error("不支持的文件类型");
				}
				return;
			}

			externalDragTypeRef.current = null;

			const dropTarget =
				useDragStore.getState().dropTarget ??
				resolveExternalDropTarget(
					event.clientX,
					event.clientY,
					hasAudio ? "audio" : "clip",
				);
			const fallbackDropTarget = dropTarget ?? {
				zone: "timeline" as const,
				type: "track" as const,
				trackIndex: hasAudio ? -1 : 0,
				time: clampFrame(currentTime),
				canDrop: true,
			};
			stopAutoScroll();
			externalDragActiveRef.current = false;
			updateDropTarget(null);
			endDrag();

			if (hasAudio) {
				const prepared: {
					file: File;
					uri: string;
					duration: number;
				}[] = [];
				for (const file of audioFiles) {
					try {
						const uri = await resolveExternalAudioUri(file);
						const metadata = await readAudioMetadata(file).catch(() => ({
							duration: 1,
						}));
						prepared.push({
							file,
							uri,
							duration: metadata.duration,
						});
					} catch (error) {
						console.warn("外部音频导入失败:", error);
						toast.error(`导入失败：${file.name}`);
					}
				}

				if (prepared.length === 0) return;

				const primaryDurationFrames = Math.max(
					1,
					Math.round(prepared[0].duration * fps),
				);
				const resolvedDropTarget =
					resolveMaterialDropTarget(
						materialDndContext,
						{
							materialRole: "audio",
							materialDurationFrames: primaryDurationFrames,
							isTransitionMaterial: false,
						},
						event.clientX,
						event.clientY,
					) ?? fallbackDropTarget;

				if (!resolvedDropTarget || !resolvedDropTarget.canDrop) return;
				if (resolvedDropTarget.zone !== "timeline") return;

				setElements((prev) => {
					let nextElements = prev;
					let nextStart = clampFrame(resolvedDropTarget.time ?? 0);
					let targetTrackIndex = resolvedDropTarget.trackIndex ?? -1;
					let targetType: "track" | "gap" = resolvedDropTarget.type ?? "track";
					if (targetTrackIndex >= 0) {
						targetTrackIndex = -1;
						targetType = "track";
					}

					let assignments = getStoredTrackAssignments(prev);
					const trackCount = getTrackCount(assignments);

					prepared.forEach((item, index) => {
						const durationFrames = Math.max(1, Math.round(item.duration * fps));
						const startFrame = nextStart;
						const endFrame = startFrame + durationFrames;
						const newId = `external-audio-${Date.now()}-${index}`;
						if (targetType === "gap") {
							const updatedAssignments = insertTrackAt(
								targetTrackIndex,
								assignments,
							);
							nextElements = nextElements.map((el) => {
								const nextTrack = updatedAssignments.get(el.id);
								if (
									nextTrack !== undefined &&
									nextTrack !== el.timeline.trackIndex
								) {
									return {
										...el,
										timeline: {
											...el.timeline,
											trackIndex: nextTrack,
										},
									};
								}
								return el;
							});
							assignments = updatedAssignments;
							targetType = "track";
						}

						const finalTrack = findAvailableTrack(
							startFrame,
							endFrame,
							targetTrackIndex,
							"audio",
							nextElements,
							assignments,
							newId,
							trackCount,
						);
						const newElement: TimelineElementType = {
							id: newId,
							type: "AudioClip",
							component: "audio-clip",
							name: item.file.name,
							props: {
								uri: item.uri,
								reversed: false,
							},
							transform: createTransformMeta({
								width: 1920,
								height: 1080,
								positionX: 0,
								positionY: 0,
							}),
							timeline: buildTimelineMeta(
								{
									start: startFrame,
									end: endFrame,
									trackIndex: finalTrack,
									role: "audio",
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
						nextStart = endFrame;
					});

					return finalizeTimelineElements(nextElements, {
						rippleEditingEnabled,
						attachments,
						autoAttach,
						fps,
						trackLockedMap,
					});
				});
				return;
			}

			if (hasImage) {
				const prepared: {
					file: File;
					uri: string;
					width: number;
					height: number;
				}[] = [];
				for (const file of imageFiles) {
					try {
						const uri = await resolveExternalImageUri(file);
						const metadata = await readImageMetadata(file).catch(() => ({
							width: DEFAULT_IMAGE_WIDTH,
							height: DEFAULT_IMAGE_HEIGHT,
						}));
						prepared.push({
							file,
							uri,
							width: metadata.width,
							height: metadata.height,
						});
					} catch (error) {
						console.warn("外部图片导入失败:", error);
						toast.error(`导入失败：${file.name}`);
					}
				}

				if (prepared.length === 0) return;

				const primaryDurationFrames = Math.max(
					1,
					materialDndContext.defaultDurationFrames,
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
					) ?? fallbackDropTarget;

				if (!resolvedDropTarget || !resolvedDropTarget.canDrop) return;

				if (resolvedDropTarget.zone === "preview") {
					const positionX = resolvedDropTarget.positionX ?? 0;
					const positionY = resolvedDropTarget.positionY ?? 0;
					setElements((prev) => {
						let nextElements = prev;
						let nextStart = clampFrame(currentTime);
						const assignments = getStoredTrackAssignments(prev);
						let nextTrackCount = getTrackCount(assignments);

						prepared.forEach((item, index) => {
							const durationFrames = Math.max(
								1,
								materialDndContext.defaultDurationFrames,
							);
							const startFrame = nextStart;
							const endFrame = startFrame + durationFrames;
							const newId = `external-image-${Date.now()}-${index}`;
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
								type: "Image",
								component: "image",
								name: item.file.name,
								props: {
									uri: item.uri,
								},
								transform: createTransformMeta({
									width: item.width,
									height: item.height,
									positionX,
									positionY,
								}),
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
					const targetTrackIndex = resolvedDropTarget.trackIndex ?? 0;
					let targetType: "track" | "gap" = resolvedDropTarget.type ?? "track";

					const postProcessOptions = {
						rippleEditingEnabled,
						attachments,
						autoAttach,
						fps,
						trackLockedMap,
					};

					prepared.forEach((item, index) => {
						const durationFrames = Math.max(
							1,
							materialDndContext.defaultDurationFrames,
						);
						const startFrame = nextStart;
						const endFrame = startFrame + durationFrames;
						const insertIndex =
							targetType === "gap"
								? Math.max(1, targetTrackIndex)
								: targetTrackIndex;

						const newElement: TimelineElementType = {
							id: `external-image-${Date.now()}-${index}`,
							type: "Image",
							component: "image",
							name: item.file.name,
							props: {
								uri: item.uri,
							},
							transform: createTransformMeta({
								width: item.width,
								height: item.height,
								positionX: 0,
								positionY: 0,
							}),
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
						} else if (rippleEditingEnabled && insertIndex === 0) {
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
				return;
			}

			if (!hasVideo) {
				return;
			}

			const prepared: {
				file: File;
				uri: string;
				metadata: ExternalVideoMetadata;
			}[] = [];
			for (const file of videoFiles) {
				try {
					if (!currentProjectId) {
						throw new Error("当前项目不存在，无法写入 OPFS");
					}
					const uri = await resolveExternalVideoUri(file, currentProjectId);
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
				) ?? fallbackDropTarget;

			if (!resolvedDropTarget || !resolvedDropTarget.canDrop) return;

			if (resolvedDropTarget.zone === "preview") {
				const positionX = resolvedDropTarget.positionX ?? 0;
				const positionY = resolvedDropTarget.positionY ?? 0;
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
							transform: createTransformMeta({
								width: item.metadata.width,
								height: item.metadata.height,
								positionX,
								positionY,
							}),
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
				const targetTrackIndex = resolvedDropTarget.trackIndex ?? 0;
				let targetType: "track" | "gap" = resolvedDropTarget.type ?? "track";

				const postProcessOptions = {
					rippleEditingEnabled,
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
						transform: createTransformMeta({
							width: item.metadata.width,
							height: item.metadata.height,
							positionX: 0,
							positionY: 0,
						}),
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
					} else if (rippleEditingEnabled && insertIndex === 0) {
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
			getExternalAudioFiles,
			getExternalImageFiles,
			getExternalAllFiles,
			resolveExternalDropTarget,
			stopAutoScroll,
			updateDropTarget,
			endDrag,
			setElements,
			currentTime,
			fps,
			materialDndContext,
			rippleEditingEnabled,
			attachments,
			autoAttach,
			trackLockedMap,
			resolveExternalAudioUri,
			resolveExternalImageUri,
			currentProjectId,
		],
	);

	return {
		handleExternalDragEnter,
		handleExternalDragOver,
		handleExternalDragLeave,
		handleExternalDrop,
	};
}
