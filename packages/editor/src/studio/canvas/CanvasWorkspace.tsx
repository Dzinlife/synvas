import { insertElementIntoMainTrack } from "core/editor/utils/mainTrackMagnet";
import type {
	ElementType,
	TimelineAsset,
	TimelineElement,
	TrackRole,
} from "core/dsl/types";
import { useCallback, useMemo } from "react";
import { createTransformMeta } from "@/dsl/transform";
import {
	type AssetRefDragData,
	type MaterialDndContext,
	type MaterialDndItem,
	useMaterialDnd,
	useMaterialDndContext,
} from "@/editor/drag";
import {
	useAttachments,
	useElements,
	useFps,
	useRippleEditing,
	useAssets,
} from "@/editor/contexts/TimelineContext";
import { finalizeTimelineElements } from "@/editor/utils/mainTrackMagnet";
import { buildTimelineMeta } from "@/editor/utils/timelineTime";
import { clampFrame, secondsToFrames } from "@/utils/timecode";
import { useCanvasStore } from "./canvasStore";

const DEFAULT_ELEMENT_WIDTH = 1920;
const DEFAULT_ELEMENT_HEIGHT = 1080;
const DEFAULT_AUDIO_HEIGHT = 200;

type CanvasMaterialItem = MaterialDndItem & {
	assetId: string;
	assetKind: TimelineAsset["kind"];
	component: string;
	elementType: ElementType;
};

const resolveCanvasItemFromAsset = (
	asset: TimelineAsset,
): CanvasMaterialItem | null => {
	switch (asset.kind) {
		case "video":
			return {
				id: `canvas-${asset.id}`,
				assetId: asset.id,
				assetKind: asset.kind,
				type: "video",
				name: asset.name ?? "Video Asset",
				uri: asset.uri,
				component: "video-clip",
				elementType: "VideoClip",
				width: DEFAULT_ELEMENT_WIDTH,
				height: DEFAULT_ELEMENT_HEIGHT,
			};
		case "audio":
			return {
				id: `canvas-${asset.id}`,
				assetId: asset.id,
				assetKind: asset.kind,
				type: "audio",
				name: asset.name ?? "Audio Asset",
				uri: asset.uri,
				component: "audio-clip",
				elementType: "AudioClip",
				width: DEFAULT_ELEMENT_WIDTH,
				height: DEFAULT_AUDIO_HEIGHT,
			};
		case "image":
			return {
				id: `canvas-${asset.id}`,
				assetId: asset.id,
				assetKind: asset.kind,
				type: "image",
				name: asset.name ?? "Image Asset",
				uri: asset.uri,
				component: "image",
				elementType: "Image",
				width: DEFAULT_ELEMENT_WIDTH,
				height: DEFAULT_ELEMENT_HEIGHT,
			};
		case "lottie":
			return {
				id: `canvas-${asset.id}`,
				assetId: asset.id,
				assetKind: asset.kind,
				type: "image",
				name: asset.name ?? "Lottie Asset",
				uri: asset.uri,
				component: "lottie",
				elementType: "Lottie",
				width: DEFAULT_ELEMENT_WIDTH,
				height: DEFAULT_ELEMENT_HEIGHT,
			};
		default:
			return null;
	}
};

const resolveTrackRoleFromAssetKind = (
	kind: TimelineAsset["kind"],
): TrackRole => {
	if (kind === "audio") return "audio";
	return "clip";
};

interface CanvasAssetCardProps {
	item: CanvasMaterialItem;
	dndContext: MaterialDndContext;
	onTimelineDrop: (
		item: CanvasMaterialItem,
		trackIndex: number,
		time: number,
		dropTargetType?: "track" | "gap",
	) => void;
	onRemove: (assetId: string) => void;
}

const CanvasAssetCard: React.FC<CanvasAssetCardProps> = ({
	item,
	dndContext,
	onTimelineDrop,
	onRemove,
}) => {
	const { bindDrag, dragRef, isBeingDragged } = useMaterialDnd({
		item,
		context: dndContext,
		onTimelineDrop,
		getRole: () => resolveTrackRoleFromAssetKind(item.assetKind),
		getDurationFrames: (_target, defaultDurationFrames) => {
			return item.duration ?? defaultDurationFrames;
		},
		getDragData: (target): AssetRefDragData => ({
			payloadType: "asset-ref",
			assetId: target.assetId,
			assetKind: target.assetKind,
			type: target.type,
			name: target.name,
			width: target.width,
			height: target.height,
			duration: target.duration,
		}),
		ghostSize: { width: 180, height: 52 },
	});

	return (
		<div
			ref={dragRef as React.RefObject<HTMLDivElement>}
			{...bindDrag()}
			className={`flex items-center justify-between rounded-lg border border-white/10 bg-neutral-900/90 px-3 py-2 text-sm text-neutral-100 transition-opacity ${
				isBeingDragged ? "opacity-50" : "opacity-100"
			}`}
			style={{ touchAction: "none" }}
		>
			<div className="min-w-0">
				<div className="truncate">{item.name}</div>
				<div className="mt-1 text-[11px] text-neutral-500">{item.assetKind}</div>
			</div>
			<button
				type="button"
				className="ml-3 rounded border border-white/10 px-2 py-0.5 text-[11px] text-neutral-300 hover:text-white"
				onClick={(event) => {
					event.stopPropagation();
					onRemove(item.assetId);
				}}
			>
				Remove
			</button>
		</div>
	);
};

const CanvasWorkspace: React.FC = () => {
	const { assets } = useAssets();
	const { setElements } = useElements();
	const { fps } = useFps();
	const { attachments, autoAttach } = useAttachments();
	const { rippleEditingEnabled } = useRippleEditing();
	const dndContext = useMaterialDndContext();
	const canvasAssetRefs = useCanvasStore((state) => state.assets);
	const removeAssetRef = useCanvasStore((state) => state.removeAssetRef);

	const canvasItems = useMemo(() => {
		const assetById = new Map(assets.map((asset) => [asset.id, asset]));
		return canvasAssetRefs
			.map((item) => {
				const asset = assetById.get(item.assetId);
				if (!asset) return null;
				return resolveCanvasItemFromAsset(asset);
			})
			.filter((item): item is CanvasMaterialItem => item !== null);
	}, [assets, canvasAssetRefs]);

	const handleTimelineDrop = useCallback(
		(
			item: CanvasMaterialItem,
			trackIndex: number,
			time: number,
			dropTargetType: "track" | "gap" = "track",
		) => {
			const role = resolveTrackRoleFromAssetKind(item.assetKind);
			const durationFrames = Math.max(1, secondsToFrames(5, fps));
			setElements((prev) => {
				const startFrame = clampFrame(time);
				const insertIndex =
					dropTargetType === "gap"
						? role === "audio"
							? Math.min(-1, trackIndex)
							: Math.max(1, trackIndex)
						: trackIndex;
				const postProcessOptions = {
					rippleEditingEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap: dndContext.trackLockedMap,
				};
				const newElement: TimelineElement = {
					id: `element-${Date.now()}`,
					type: item.elementType,
					component: item.component,
					name: item.name,
					assetId: item.assetId,
					props: {},
					transform: createTransformMeta({
						width: item.width ?? DEFAULT_ELEMENT_WIDTH,
						height:
							item.height ??
							(role === "audio" ? DEFAULT_AUDIO_HEIGHT : DEFAULT_ELEMENT_HEIGHT),
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
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
				};

				if (dropTargetType === "gap") {
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

				if (rippleEditingEnabled && trackIndex === 0 && role !== "audio") {
					return insertElementIntoMainTrack(
						prev,
						newElement.id,
						startFrame,
						postProcessOptions,
						newElement,
					);
				}

				return finalizeTimelineElements([...prev, newElement], postProcessOptions);
			});
		},
		[
			attachments,
			autoAttach,
			dndContext.trackLockedMap,
			fps,
			rippleEditingEnabled,
			setElements,
		],
	);

	return (
		<div
			data-canvas-drop-zone
			className="absolute inset-0 bg-neutral-900 text-neutral-200"
		>
			<div className="absolute inset-6 rounded-xl border border-white/10 bg-neutral-950/70 p-4">
				<div className="text-xs uppercase tracking-wider text-neutral-400">
					Canvas Workspace
				</div>
				<div className="mt-2 text-sm text-neutral-300">
					{canvasItems.length} assets
				</div>
				<div className="mt-4 space-y-2">
					{canvasItems.length === 0 ? (
						<div className="text-xs text-neutral-500">
							Drag assets or timeline clips here, then drag back to timeline.
						</div>
					) : (
						canvasItems.map((item) => (
							<CanvasAssetCard
								key={item.assetId}
								item={item}
								dndContext={dndContext}
								onTimelineDrop={handleTimelineDrop}
								onRemove={removeAssetRef}
							/>
						))
					)}
				</div>
			</div>
		</div>
	);
};

export default CanvasWorkspace;
