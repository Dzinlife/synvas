/**
 * 素材库组件
 * 用于展示可拖拽的素材（图片、视频等）
 */

import React, { useCallback } from "react";
import { TimelineElement, TrackRole } from "@nle/dsl/types";
import { clampFrame, framesToTimecode, secondsToFrames } from "@nle/utils/timecode";
import {
	findAvailableTrack,
	getElementRole,
	getStoredTrackAssignments,
	getTrackCount,
} from "./utils/trackAssignment";
import { buildTimelineMeta } from "./utils/timelineTime";
import {
	finalizeTimelineElements,
	insertElementIntoMainTrack,
} from "./utils/mainTrackMagnet";
import {
	getTransitionDurationParts,
	isTransitionElement,
} from "./utils/transitions";
import {
	useAttachments,
	useFps,
	useMainTrackMagnet,
	useTimelineStore,
} from "./contexts/TimelineContext";
import {
	type MaterialDndContext,
	type MaterialDndItem,
	useMaterialDnd,
	useMaterialDndContext,
} from "./drag/materialDnd";

// ============================================================================
// 类型定义
// ============================================================================

type MaterialItem = MaterialDndItem & { thumbnailUrl: string };

interface MaterialCardProps {
	item: MaterialItem;
	onTimelineDrop?: (
		item: MaterialItem,
		trackIndex: number,
		time: number,
		dropTargetType?: "track" | "gap",
	) => void;
	onPreviewDrop?: (
		item: MaterialItem,
		canvasX: number,
		canvasY: number,
	) => void;
	dndContext: MaterialDndContext;
}

// ============================================================================
// 素材卡片组件
// ============================================================================

const MaterialCard: React.FC<MaterialCardProps> = ({
	item,
	onTimelineDrop,
	onPreviewDrop,
	dndContext,
}) => {
	const { fps } = useFps();
	const { bindDrag, dragRef, isBeingDragged } = useMaterialDnd({
		item,
		context: dndContext,
		onTimelineDrop,
		onPreviewDrop,
	});

	return (
		<div
			ref={dragRef as React.RefObject<HTMLDivElement>}
			{...bindDrag()}
			className={`relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-opacity ${
				isBeingDragged ? "opacity-50" : "opacity-100"
			}`}
			style={{ touchAction: "none" }}
		>
			<img
				src={item.thumbnailUrl}
				alt={item.name}
				className="w-full h-20 object-cover"
				draggable={false}
			/>
			<div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-2">
				<div className="text-xs text-white truncate">{item.name}</div>
			</div>
			{item.type === "video" && item.duration && (
				<div className="absolute top-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
					{formatDuration(item.duration, fps)}
				</div>
			)}
		</div>
	);
};

// ============================================================================
// 辅助函数
// ============================================================================

function formatDuration(frames: number, fps: number): string {
	return framesToTimecode(frames, fps);
}

const DEFAULT_TRANSITION_DURATION_FRAMES = 15;

const getMaterialRole = (item: MaterialItem): TrackRole => {
	switch (item.type) {
		case "audio":
			return "audio";
		case "text":
			return "overlay";
		case "transition":
			return "clip";
		default:
			return "clip";
	}
};

const resolveTransitionDrop = (
	elements: TimelineElement[],
	trackIndex: number,
	boundary: number,
) => {
	const clips = elements
		.filter(
			(el) =>
				(el.timeline.trackIndex ?? 0) === trackIndex &&
				getElementRole(el) === "clip" &&
				!isTransitionElement(el),
		)
		.sort((a, b) => {
			if (a.timeline.start !== b.timeline.start) {
				return a.timeline.start - b.timeline.start;
			}
			if (a.timeline.end !== b.timeline.end) {
				return a.timeline.end - b.timeline.end;
			}
			return a.id.localeCompare(b.id);
		});

	for (let i = 0; i < clips.length - 1; i += 1) {
		const prev = clips[i];
		const next = clips[i + 1];
		if (prev.timeline.end !== next.timeline.start) continue;
		if (prev.timeline.end !== boundary) continue;
		const hasExisting = elements.some(
			(el) =>
				isTransitionElement(el) &&
				(el.timeline.trackIndex ?? 0) === trackIndex &&
				(el.transition?.boundry === boundary ||
					(el.transition?.fromId === prev.id &&
						el.transition?.toId === next.id)),
		);
		if (hasExisting) return null;
		return { fromId: prev.id, toId: next.id };
	}

	return null;
};

// ============================================================================
// 素材库面板组件
// ============================================================================

// 示例素材数据
const DEMO_MATERIALS: MaterialItem[] = [
	{
		id: "material-1",
		type: "image",
		name: "示例图片",
		uri: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800",
		thumbnailUrl:
			"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=200",
		width: 1920,
		height: 1080,
	},
	{
		id: "material-2",
		type: "image",
		name: "风景照片",
		uri: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800",
		thumbnailUrl:
			"https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=200",
		width: 1920,
		height: 1280,
	},
	{
		id: "material-transition-1",
		type: "transition",
		name: "Crossfade",
		uri: "transition://crossfade",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><rect width='200' height='80' fill='%236363f1'/><path d='M0 0 L200 80 M0 80 L200 0' stroke='%23ffffff' stroke-width='6' opacity='0.7'/><text x='100' y='50' font-size='26' fill='%23ffffff' text-anchor='middle' font-family='Arial'>T</text></svg>",
		duration: 15,
	},
	{
		id: "material-transition-2",
		type: "transition",
		name: "像素风 Shader",
		uri: "transition://pixel-shader",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><defs><pattern id='pix' width='8' height='8' patternUnits='userSpaceOnUse'><rect width='8' height='8' fill='%230f172a'/><rect width='4' height='4' fill='%23f97316'/><rect x='4' y='4' width='4' height='4' fill='%233b82f6'/></pattern></defs><rect width='200' height='80' fill='url(%23pix)'/><rect width='200' height='80' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.6'/><text x='100' y='50' font-size='20' fill='%23ffffff' text-anchor='middle' font-family='Arial'>PIXEL</text></svg>",
		duration: 18,
	},
	{
		id: "material-transition-3",
		type: "transition",
		name: "Ripple Dissolve",
		uri: "transition://ripple-dissolve",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><rect width='200' height='80' fill='%231e293b'/><circle cx='100' cy='40' r='10' fill='none' stroke='%23a5b4fc' stroke-width='4' opacity='0.9'/><circle cx='100' cy='40' r='24' fill='none' stroke='%23818cf8' stroke-width='3' opacity='0.7'/><circle cx='100' cy='40' r='38' fill='none' stroke='%23c7d2fe' stroke-width='2' opacity='0.6'/><text x='100' y='50' font-size='18' fill='%23ffffff' text-anchor='middle' font-family='Arial'>RIPPLE</text></svg>",
		duration: 18,
	},
];

const MaterialLibrary: React.FC = () => {
	const dndContext = useMaterialDndContext();
	const setElements = useTimelineStore((state) => state.setElements);
	const currentTime = useTimelineStore((state) => state.currentTime);
	const { fps } = useFps();
	const { attachments, autoAttach } = useAttachments();
	const { mainTrackMagnetEnabled } = useMainTrackMagnet();

	// 处理素材库拖拽放置到时间线
	const handleTimelineDrop = useCallback(
		(
			item: MaterialItem,
			trackIndex: number,
			time: number,
			dropTargetType: "track" | "gap" = "track",
		) => {
			setElements((prev) => {
				const startFrame = clampFrame(time);

				const postProcessOptions = {
					mainTrackMagnetEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap: dndContext.trackLockedMap,
				};

				if (item.type === "transition") {
					if (dropTargetType === "gap") return prev;
					const link = resolveTransitionDrop(prev, trackIndex, startFrame);
					if (!link) return prev;
					const durationFrames =
						Number.isFinite(item.duration) && (item.duration ?? 0) > 0
							? (item.duration as number)
							: DEFAULT_TRANSITION_DURATION_FRAMES;
					const { head, tail } = getTransitionDurationParts(durationFrames);
					const transitionStart = startFrame - head;
					const transitionEnd = startFrame + tail;
					const newTransition: TimelineElement = {
						id: `transition-${Date.now()}`,
						type: "Transition",
						component:
							item.uri === "transition://pixel-shader"
								? "transition/pixel-shader"
								: item.uri === "transition://ripple-dissolve"
									? "transition/ripple-dissolve"
									: "transition/crossfade",
						name: item.name,
						props: {},
						transition: {
							duration: durationFrames,
							boundry: startFrame,
							fromId: link.fromId,
							toId: link.toId,
						},
						transform: {
							centerX: 0,
							centerY: 0,
							width: 1920,
							height: 1080,
							rotation: 0,
						},
						timeline: buildTimelineMeta(
							{
								start: transitionStart,
								end: transitionEnd,
								trackIndex,
								role: "clip",
							},
							fps,
						),
						render: {
							zIndex: 1,
							visible: true,
							opacity: 1,
						},
					};

					return finalizeTimelineElements(
						[...prev, newTransition],
						postProcessOptions,
					);
				}

				const durationFrames = secondsToFrames(5, fps);
				const role = getMaterialRole(item);
				const insertIndex =
					dropTargetType === "gap" ? Math.max(1, trackIndex) : trackIndex;
				const newElement: TimelineElement = {
					id: `element-${Date.now()}`,
					type: "Image" as const,
					component: "image",
					name: item.name,
					props: {
						uri: item.uri,
					},
					transform: {
						centerX: 0,
						centerY: 0,
						width: item.width ?? 1920,
						height: item.height ?? 1080,
						rotation: 0,
					},
					timeline: buildTimelineMeta(
						{
							start: startFrame,
							end: startFrame + durationFrames,
							trackIndex: insertIndex,
							role,
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
				};

				if (dropTargetType === "gap") {
					// gap 投放需要插入新轨道，先整体下移后续轨道索引
					const shifted = prev.map((el) => {
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
					return finalizeTimelineElements(
						[...shifted, newElement],
						postProcessOptions,
					);
				}

				// 主轨开启磁吸时，插入逻辑交给主轨处理以保持连续性
				if (mainTrackMagnetEnabled && trackIndex === 0) {
					return insertElementIntoMainTrack(
						prev,
						newElement.id,
						startFrame,
						postProcessOptions,
						newElement,
					);
				}

				return finalizeTimelineElements(
					[...prev, newElement],
					postProcessOptions,
				);
			});
		},
		[
			setElements,
			mainTrackMagnetEnabled,
			attachments,
			autoAttach,
			fps,
			dndContext,
		],
	);

	// 处理素材库拖拽放置到预览画布
	const handlePreviewDrop = useCallback(
		(item: MaterialItem, canvasX: number, canvasY: number) => {
			const elementWidth = item.width ?? 400;
			const elementHeight = item.height ?? 300;
			const role = getMaterialRole(item);

			setElements((prev) => {
				const durationFrames = secondsToFrames(5, fps);
				const startFrame = clampFrame(currentTime);
				const endFrame = startFrame + durationFrames;
				const newId = `element-${Date.now()}`;
				const trackAssignments = getStoredTrackAssignments(prev);
				const trackCount = getTrackCount(trackAssignments);
				// 预览投放默认落在非主轨，避免主轨磁吸造成意外移动
				const targetTrackIndex = 1; // 预览投放默认非主轨
				const finalTrack = findAvailableTrack(
					startFrame,
					endFrame,
					targetTrackIndex,
					role,
					prev,
					trackAssignments,
					newId,
					trackCount,
				);
				const newElement: TimelineElement = {
					id: newId,
					type: "Image" as const,
					component: "image",
					name: item.name,
					props: {
						uri: item.uri,
					},
					transform: {
						centerX: canvasX,
						centerY: canvasY,
						width: elementWidth,
						height: elementHeight,
						rotation: 0,
					},
					timeline: buildTimelineMeta(
						{
							start: startFrame,
							end: endFrame,
							trackIndex: finalTrack,
							role,
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
				};

				return [...prev, newElement];
			});
		},
		[setElements, currentTime, fps],
	);

	return (
		<>
			<div className="space-y-2">
				{DEMO_MATERIALS.map((item) => (
					<MaterialCard
						key={item.id}
						item={item}
						onTimelineDrop={handleTimelineDrop}
						onPreviewDrop={handlePreviewDrop}
						dndContext={dndContext}
					/>
				))}
			</div>
		</>
	);
};

export default MaterialLibrary;
export type { MaterialItem };
