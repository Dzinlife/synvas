/**
 * 素材库组件
 * 用于展示可拖拽的素材（图片、视频等）
 */

import type { ElementType, TimelineElement, TrackRole } from "core/dsl/types";
import { insertElementIntoMainTrack } from "core/editor/utils/mainTrackMagnet";
import type React from "react";
import { useCallback } from "react";
import { componentRegistry } from "@/dsl/model/componentRegistry";
import { createTransformMeta } from "@/dsl/transform";
import {
	clampFrame,
	framesToTimecode,
	secondsToFrames,
} from "@/utils/timecode";
import {
	useAttachments,
	useFps,
	useRippleEditing,
	useTimelineStore,
} from "./contexts/TimelineContext";
import {
	type MaterialDndContext,
	type MaterialDndItem,
	useMaterialDnd,
	useMaterialDndContext,
} from "./drag/materialDnd";
import { finalizeTimelineElements } from "./utils/mainTrackMagnet";
import { buildTimelineMeta } from "./utils/timelineTime";
import {
	findAvailableTrack,
	getElementRole,
	getStoredTrackAssignments,
	getTrackCount,
} from "./utils/trackAssignment";
import {
	getTransitionDurationParts,
	isTransitionElement,
} from "./utils/transitions";

// ============================================================================
// 类型定义
// ============================================================================

type MaterialItem = MaterialDndItem & {
	thumbnailUrl: string;
	component: string;
	elementType: ElementType;
	props: Record<string, unknown>;
	trackRole?: TrackRole;
};

type MaterialPreset = {
	type?: MaterialItem["type"];
	name?: string;
	uri?: string;
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	duration?: number;
	props?: Record<string, unknown>;
};

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
		positionX: number,
		positionY: number,
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
		getRole: (target) => getMaterialRole(target),
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

const buildSvgThumbnail = (label: string, color: string): string => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="${color}"/><text x="100" y="50" font-size="20" fill="#ffffff" text-anchor="middle" font-family="Arial">${label}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const MATERIAL_PRESETS: Record<string, MaterialPreset> = {
	image: {
		type: "image",
		name: "示例图片",
		uri: "/photo.jpeg",
		thumbnailUrl: "/photo.jpeg",
		width: 1920,
		height: 1080,
		props: { uri: "/photo.jpeg" },
	},
	"video-clip": {
		type: "video",
		name: "示例视频",
		uri: "/intro.mp4",
		thumbnailUrl: buildSvgThumbnail("VIDEO", "#1d4ed8"),
		width: 1920,
		height: 1080,
		props: { uri: "/intro.mp4", reversed: false },
	},
		"audio-clip": {
			type: "audio",
			name: "示例音频",
			uri: "https://cdn.jsdelivr.net/gh/anars/blank-audio@master/5-seconds-of-silence.mp3",
		thumbnailUrl: buildSvgThumbnail("AUDIO", "#0f766e"),
		width: 1920,
		height: 200,
			props: {
				uri: "https://cdn.jsdelivr.net/gh/anars/blank-audio@master/5-seconds-of-silence.mp3",
				reversed: false,
			},
		},
	lottie: {
		type: "image",
		name: "Lottie 动画",
		uri: "https://lottie.host/2eb481e4-0f47-46a0-b670-936cd715c51f/ajTiosbGxW.lottie",
		thumbnailUrl: buildSvgThumbnail("LOTTIE", "#7c3aed"),
		width: 400,
		height: 400,
		props: {
			uri: "https://lottie.host/2eb481e4-0f47-46a0-b670-936cd715c51f/ajTiosbGxW.lottie",
			loop: true,
			speed: 1.0,
		},
	},
	"filter/color-filter": {
		type: "image",
		name: "调色滤镜",
		thumbnailUrl: buildSvgThumbnail("FILTER", "#0ea5e9"),
		props: { hue: 30, saturation: 0.3, brightness: 0.1, contrast: 0.2 },
	},
	"filter/halation": {
		type: "image",
		name: "胶片光晕",
		thumbnailUrl: buildSvgThumbnail("HALATION", "#be123c"),
		props: {
			intensity: 0.45,
			threshold: 0.78,
			radius: 8,
			diffusion: 0.55,
			warmness: 0.6,
			chromaticShift: 1.2,
		},
	},
	"transition/crossfade": {
		type: "transition",
		name: "Crossfade",
		uri: "transition://crossfade",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><rect width='200' height='80' fill='%236363f1'/><path d='M0 0 L200 80 M0 80 L200 0' stroke='%23ffffff' stroke-width='6' opacity='0.7'/><text x='100' y='50' font-size='26' fill='%23ffffff' text-anchor='middle' font-family='Arial'>T</text></svg>",
		duration: 15,
	},
	"transition/pixel-shader": {
		type: "transition",
		name: "像素风 Shader",
		uri: "transition://pixel-shader",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><defs><pattern id='pix' width='8' height='8' patternUnits='userSpaceOnUse'><rect width='8' height='8' fill='%230f172a'/><rect width='4' height='4' fill='%23f97316'/><rect x='4' y='4' width='4' height='4' fill='%233b82f6'/></pattern></defs><rect width='200' height='80' fill='url(%23pix)'/><rect width='200' height='80' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.6'/><text x='100' y='50' font-size='20' fill='%23ffffff' text-anchor='middle' font-family='Arial'>PIXEL</text></svg>",
		duration: 18,
	},
	"transition/ripple-dissolve": {
		type: "transition",
		name: "Ripple Dissolve",
		uri: "transition://ripple-dissolve",
		thumbnailUrl:
			"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80'><rect width='200' height='80' fill='%231e293b'/><circle cx='100' cy='40' r='10' fill='none' stroke='%23a5b4fc' stroke-width='4' opacity='0.9'/><circle cx='100' cy='40' r='24' fill='none' stroke='%23818cf8' stroke-width='3' opacity='0.7'/><circle cx='100' cy='40' r='38' fill='none' stroke='%23c7d2fe' stroke-width='2' opacity='0.6'/><text x='100' y='50' font-size='18' fill='%23ffffff' text-anchor='middle' font-family='Arial'>RIPPLE</text></svg>",
		duration: 18,
	},
};

const resolveMaterialType = (type: ElementType): MaterialItem["type"] => {
	switch (type) {
		case "AudioClip":
			return "audio";
		case "VideoClip":
			return "video";
		case "Transition":
			return "transition";
		case "Text":
		case "Caption":
			return "text";
		default:
			return "image";
	}
};

const buildMaterialProps = (
	definition: {
		type: ElementType;
		meta: { defaultProps?: Record<string, unknown> };
	},
	preset: MaterialPreset,
): Record<string, unknown> => {
	const merged = {
		...(definition.meta.defaultProps ?? {}),
		...(preset.props ?? {}),
	};

	if (
		preset.uri &&
		["Image", "VideoClip", "AudioClip", "Lottie"].includes(definition.type)
	) {
		return { ...merged, uri: preset.uri };
	}

	return merged;
};

const buildMaterialItems = (): MaterialItem[] => {
	return componentRegistry
		.getAll()
		.filter((definition) => !definition.meta.hiddenInMaterialLibrary)
		.map((definition) => {
			const preset = MATERIAL_PRESETS[definition.component] ?? {};
			const name = preset.name ?? definition.meta.name;
			const type = preset.type ?? resolveMaterialType(definition.type);
			const uri = preset.uri ?? definition.component;
			const thumbnailUrl =
				preset.thumbnailUrl ?? buildSvgThumbnail(name, "#0f172a");
			const props = buildMaterialProps(
				{
					type: definition.type,
					meta: {
						defaultProps:
							(definition.meta.defaultProps as
								| Record<string, unknown>
								| undefined) ?? undefined,
					},
				},
				preset,
			);

			return {
				id: `material-${definition.component}`,
				type,
				name,
				uri,
				thumbnailUrl,
				width: preset.width ?? 1920,
				height: preset.height ?? 1080,
				duration: preset.duration,
				component: definition.component,
				elementType: definition.type,
				props,
				trackRole: definition.meta.trackRole,
			};
		});
};

const resolveMaterialDuration = (item: MaterialItem, fps: number): number => {
	if (Number.isFinite(item.duration) && (item.duration ?? 0) > 0) {
		return item.duration as number;
	}
	return secondsToFrames(5, fps);
};

const getMaterialRole = (item: MaterialItem): TrackRole => {
	if (item.trackRole) return item.trackRole;
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

const MaterialLibrary: React.FC = () => {
	const dndContext = useMaterialDndContext();
	const setElements = useTimelineStore((state) => state.setElements);
	const currentTime = useTimelineStore((state) => state.currentTime);
	const { fps } = useFps();
	const { attachments, autoAttach } = useAttachments();
	const { rippleEditingEnabled } = useRippleEditing();

	const materials = buildMaterialItems();

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
				const role = getMaterialRole(item);
				const isTransitionItem =
					item.elementType === "Transition" || item.type === "transition";

				const postProcessOptions = {
					rippleEditingEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap: dndContext.trackLockedMap,
				};

				if (isTransitionItem) {
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
						component: item.component,
						name: item.name,
						props: { ...(item.props ?? {}) },
						transition: {
							duration: durationFrames,
							boundry: startFrame,
							fromId: link.fromId,
							toId: link.toId,
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

				const durationFrames = resolveMaterialDuration(item, fps);
				const insertIndex =
					dropTargetType === "gap"
						? role === "audio"
							? Math.min(-1, trackIndex)
							: Math.max(1, trackIndex)
						: trackIndex;
				const newElement: TimelineElement = {
					id: `element-${Date.now()}`,
					type: item.elementType,
					component: item.component,
					name: item.name,
					props: { ...(item.props ?? {}) },
					transform: createTransformMeta({
						width: item.width ?? 1920,
						height: item.height ?? 1080,
						positionX: 0,
						positionY: 0,
					}),
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
						zIndex: role === "overlay" ? 2 : role === "effect" ? 1 : 0,
						visible: true,
						opacity: 1,
					},
				};

				if (dropTargetType === "gap") {
					// gap 投放需要插入新轨道
					const shifted = prev.map((el) => {
						const currentTrack = el.timeline.trackIndex ?? 0;
						if (role === "audio") {
							if (currentTrack <= insertIndex) {
								return {
									...el,
									timeline: {
										...el.timeline,
										trackIndex: currentTrack - 1,
									},
								};
							}
							return el;
						}

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

				// 主轨开启波纹编辑时，插入逻辑交给主轨处理以保持连续性
				if (rippleEditingEnabled && trackIndex === 0) {
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
			rippleEditingEnabled,
			attachments,
			autoAttach,
			fps,
			dndContext,
		],
	);

	// 处理素材库拖拽放置到预览画布
	const handlePreviewDrop = useCallback(
		(item: MaterialItem, positionX: number, positionY: number) => {
			const elementWidth = item.width ?? 400;
			const elementHeight = item.height ?? 300;
			const role = getMaterialRole(item);

			setElements((prev) => {
				const durationFrames = resolveMaterialDuration(item, fps);
				const startFrame = clampFrame(currentTime);
				const endFrame = startFrame + durationFrames;
				const newId = `element-${Date.now()}`;
				const trackAssignments = getStoredTrackAssignments(prev);
				const trackCount = getTrackCount(trackAssignments);
				// 预览投放默认落在非主轨，避免主轨波纹编辑造成意外移动
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
					type: item.elementType,
					component: item.component,
					name: item.name,
					props: { ...(item.props ?? {}) },
					transform: createTransformMeta({
						width: elementWidth,
						height: elementHeight,
						positionX,
						positionY,
					}),
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
						zIndex: role === "overlay" ? 2 : role === "effect" ? 1 : 0,
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
		<div className="space-y-2">
			{materials.map((item) => (
				<MaterialCard
					key={item.id}
					item={item}
					onTimelineDrop={handleTimelineDrop}
					onPreviewDrop={handlePreviewDrop}
					dndContext={dndContext}
				/>
			))}
		</div>
	);
};

export default MaterialLibrary;
export type { MaterialItem };
