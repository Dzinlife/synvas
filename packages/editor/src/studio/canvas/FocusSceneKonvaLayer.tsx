import type { TimelineElement } from "core/dsl/types";
import type { SceneNode } from "core/studio/types";
import type Konva from "konva";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Line as KonvaLine,
	Rect as KonvaRect,
	Layer,
	Stage,
	Transformer,
} from "react-konva";
import { transformMetaToRenderLayout } from "@/dsl/layout";
import { useTimelineStore, useTracks } from "@/editor/contexts/TimelineContext";
import { buildKonvaTree } from "@/editor/preview/buildSkiaTree";
import { LabelLayer } from "@/editor/preview/LabelLayer";
import { usePreviewInteractions } from "@/editor/preview/usePreviewInteractions";
import {
	EditorRuntimeProvider,
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/editor/runtime/EditorRuntimeProvider";
import type { EditorRuntime, TimelineRuntime } from "@/editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";

interface FocusSceneKonvaLayerProps {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	focusedNode: SceneNode;
	sceneId: string;
}

interface FocusSceneKonvaLayerInnerProps {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	focusedNode: SceneNode;
}

const SCALE_EPSILON = 1e-6;

const createScopedRuntime = (runtime: TimelineRuntime): EditorRuntime => ({
	id: `${runtime.id}:focus-konva-layer`,
	timelineStore: runtime.timelineStore,
	modelRegistry: runtime.modelRegistry,
});

const FocusSceneKonvaLayerInner: React.FC<FocusSceneKonvaLayerInnerProps> = ({
	width,
	height,
	camera,
	focusedNode,
}) => {
	const timelineStore = useTimelineStoreApi();
	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const { tracks } = useTracks();
	const renderElementsRef = useRef<TimelineElement[]>([]);
	const [renderElements, setRenderElements] = useState<TimelineElement[]>([]);

	const sourceWidth = Math.max(1, canvasSize.width);
	const sourceHeight = Math.max(1, canvasSize.height);
	const sceneScaleX = focusedNode.width / sourceWidth;
	const sceneScaleY = focusedNode.height / sourceHeight;
	const safeSceneScaleX =
		Math.abs(sceneScaleX) > SCALE_EPSILON ? sceneScaleX : 1;
	const safeSceneScaleY =
		Math.abs(sceneScaleY) > SCALE_EPSILON ? sceneScaleY : 1;
	const stageScaleX = camera.zoom * safeSceneScaleX;
	const stageScaleY = camera.zoom * safeSceneScaleY;

	const canvasConvertOptions = useMemo(
		() => ({
			picture: {
				width: sourceWidth,
				height: sourceHeight,
			},
			canvas: {
				width: sourceWidth,
				height: sourceHeight,
			},
		}),
		[sourceHeight, sourceWidth],
	);

	const getEffectiveScale = useCallback(
		() => ({
			x: stageScaleX,
			y: stageScaleY,
		}),
		[stageScaleX, stageScaleY],
	);

	const getEffectiveZoom = useCallback(() => {
		const reference = Math.max(
			Math.min(Math.abs(stageScaleX), Math.abs(stageScaleY)),
			SCALE_EPSILON,
		);
		return reference;
	}, [stageScaleX, stageScaleY]);

	const stageToCanvasCoords = useCallback(
		(stageX: number, stageY: number) => {
			const safeCameraZoom = Math.max(camera.zoom, SCALE_EPSILON);
			const worldX = stageX / safeCameraZoom - camera.x;
			const worldY = stageY / safeCameraZoom - camera.y;
			const canvasX = (worldX - focusedNode.x) / safeSceneScaleX;
			const canvasY = (worldY - focusedNode.y) / safeSceneScaleY;
			return {
				canvasX,
				canvasY,
			};
		},
		[camera, focusedNode.x, focusedNode.y, safeSceneScaleX, safeSceneScaleY],
	);

	const canvasToStageCoords = useCallback(
		(canvasX: number, canvasY: number) => {
			const worldX = focusedNode.x + canvasX * safeSceneScaleX;
			const worldY = focusedNode.y + canvasY * safeSceneScaleY;
			const stageX = (worldX + camera.x) * camera.zoom;
			const stageY = (worldY + camera.y) * camera.zoom;
			return {
				stageX,
				stageY,
			};
		},
		[camera, focusedNode.x, focusedNode.y, safeSceneScaleX, safeSceneScaleY],
	);

	const {
		stageRef,
		transformerRef,
		groupProxyRef,
		groupProxyBox,
		selectedIds,
		hoveredId,
		draggingId,
		snapGuides,
		selectionStageRect,
		getTrackIndexForElement,
		transformerBoundBoxFunc,
		handleMouseDown,
		handleMouseUp,
		handleDragStart,
		handleDrag,
		handleDragEnd,
		handleGroupTransformStart,
		handleGroupTransform,
		handleGroupTransformEnd,
		handleTransformStart,
		handleTransform,
		handleTransformEnd,
		handleMouseEnter,
		handleMouseLeave,
		handleStageClick,
		handleStageMouseDown,
		handleStageMouseMove,
		handleStageMouseUp,
		transformBaseRef,
	} = usePreviewInteractions({
		renderElements,
		renderElementsRef,
		canvasConvertOptions,
		canvasWidth: sourceWidth,
		canvasHeight: sourceHeight,
		getEffectiveZoom,
		getEffectiveScale,
		stageToCanvasCoords,
		canvasToStageCoords,
	});

	const effectiveZoom = getEffectiveZoom();
	const stageOrigin = useMemo(() => {
		return canvasToStageCoords(0, 0);
	}, [canvasToStageCoords]);

	const sortByTrackIndex = useCallback(
		(items: TimelineElement[]) => {
			return items
				.map((el, index) => ({
					el,
					index,
					trackIndex: getTrackIndexForElement(el),
				}))
				.sort((a, b) => {
					if (a.trackIndex !== b.trackIndex) {
						return a.trackIndex - b.trackIndex;
					}
					return a.index - b.index;
				})
				.map(({ el }) => el);
		},
		[getTrackIndexForElement],
	);

	const { getRenderTime, getElements } = useMemo(
		() => timelineStore.getState(),
		[timelineStore],
	);

	useEffect(() => {
		const updateKonvaElements = () => {
			const displayTime = getRenderTime();
			const allElements = getElements();
			const orderedElements = buildKonvaTree({
				elements: allElements,
				displayTime,
				tracks,
				sortByTrackIndex,
			});

			const prevElements = renderElementsRef.current;
			if (
				prevElements.length !== orderedElements.length ||
				orderedElements.some((el, i) => prevElements[i] !== el)
			) {
				renderElementsRef.current = orderedElements;
				setRenderElements(orderedElements);
			}
		};

		const unsubCurrentTime = timelineStore.subscribe(
			(state) => state.currentTime,
			updateKonvaElements,
		);
		const unsubPreviewTime = timelineStore.subscribe(
			(state) => state.previewTime,
			updateKonvaElements,
		);

		return () => {
			unsubCurrentTime();
			unsubPreviewTime();
		};
	}, [getElements, getRenderTime, sortByTrackIndex, timelineStore, tracks]);

	useEffect(() => {
		return timelineStore.subscribe(
			(state) => state.elements,
			(newElements) => {
				const displayTime = getRenderTime();
				const orderedElements = buildKonvaTree({
					elements: newElements,
					displayTime,
					tracks,
					sortByTrackIndex,
				});
				renderElementsRef.current = orderedElements;
				setRenderElements(orderedElements);
			},
			{ fireImmediately: true },
		);
	}, [getRenderTime, sortByTrackIndex, timelineStore, tracks]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			className="absolute inset-0 z-20"
			data-testid="focus-scene-konva-layer"
		>
			<LabelLayer
				elements={renderElements}
				selectedIds={selectedIds}
				stageRef={stageRef}
				groupProxyRef={groupProxyRef}
				canvasConvertOptions={canvasConvertOptions}
				offsetX={stageOrigin.stageX}
				offsetY={stageOrigin.stageY}
				zoomLevel={effectiveZoom}
				pinchState={{
					isPinching: false,
					centerX: 0,
					centerY: 0,
					initialZoom: effectiveZoom,
					currentZoom: effectiveZoom,
				}}
				groupProxyBox={groupProxyBox}
			/>
			<Stage
				ref={stageRef}
				width={width}
				height={height}
				onClick={handleStageClick}
				onMouseDown={handleStageMouseDown}
				onMouseMove={handleStageMouseMove}
				onMouseUp={handleStageMouseUp}
			>
				<Layer>
					{selectionStageRect &&
						selectionStageRect.width > 0 &&
						selectionStageRect.height > 0 && (
							<KonvaRect
								x={selectionStageRect.x}
								y={selectionStageRect.y}
								width={selectionStageRect.width}
								height={selectionStageRect.height}
								fill="rgba(59,130,246,0.15)"
								stroke="rgba(59,130,246,0.8)"
								strokeWidth={1}
								dash={[6, 4]}
							/>
						)}
					{snapGuides.vertical.map((x) => (
						<KonvaLine
							key={`focus-snap-v-${x}`}
							points={[x, 0, x, height]}
							stroke="rgba(59,130,246,0.8)"
							strokeWidth={1}
							dash={[4, 4]}
							listening={false}
						/>
					))}
					{snapGuides.horizontal.map((y) => (
						<KonvaLine
							key={`focus-snap-h-${y}`}
							points={[0, y, width, y]}
							stroke="rgba(59,130,246,0.8)"
							strokeWidth={1}
							dash={[4, 4]}
							listening={false}
						/>
					))}
					{groupProxyBox &&
						groupProxyBox.width > 0 &&
						groupProxyBox.height > 0 && (
							<KonvaRect
								ref={groupProxyRef}
								x={groupProxyBox.x}
								y={groupProxyBox.y}
								width={groupProxyBox.width}
								height={groupProxyBox.height}
								offsetX={groupProxyBox.width / 2}
								offsetY={groupProxyBox.height / 2}
								rotation={groupProxyBox.rotation}
								fill="transparent"
								stroke="transparent"
								listening={false}
								onTransform={handleGroupTransform}
								onTransformStart={handleGroupTransformStart}
								onTransformEnd={handleGroupTransformEnd}
							/>
						)}
					{renderElements.map((element) => {
						if (!element.transform) return null;
						const id = element.id;
						const isHovered = hoveredId === id;
						const isDragging = draggingId === id;
						const isSelected = selectedIds.includes(id);
						const renderLayout = transformMetaToRenderLayout(
							element.transform,
							canvasConvertOptions.picture,
							canvasConvertOptions.canvas,
						);
						const { stageX, stageY } = canvasToStageCoords(
							renderLayout.cx,
							renderLayout.cy,
						);
						const baseTransform =
							selectedIds.length === 1 &&
							selectedIds[0] === id &&
							transformerRef.current?.isTransforming?.() === true
								? transformBaseRef.current[id]
								: undefined;
						const canvasWidth = baseTransform?.canvasWidth ?? renderLayout.w;
						const canvasHeight = baseTransform?.canvasHeight ?? renderLayout.h;
						const stageWidth = canvasWidth * Math.abs(stageScaleX);
						const stageHeight = canvasHeight * Math.abs(stageScaleY);
						const rotationDegrees = (renderLayout.rotation * 180) / Math.PI;

						return (
							<KonvaRect
								key={id}
								x={stageX}
								y={stageY}
								width={stageWidth}
								height={stageHeight}
								offsetX={stageWidth / 2}
								offsetY={stageHeight / 2}
								fill="transparent"
								stroke={
									isSelected
										? "rgba(255,0,0,1)"
										: isDragging
											? "rgba(255,0,0,0.8)"
											: isHovered
												? "rgba(255,0,0,0.6)"
												: "transparent"
								}
								strokeWidth={1}
								draggable
								data-id={id}
								name={`element-${id}`}
								rotation={rotationDegrees}
								onMouseDown={() => handleMouseDown(id)}
								onMouseUp={handleMouseUp}
								onDragStart={(event: Konva.KonvaEventObject<DragEvent>) =>
									handleDragStart(id, event)
								}
								onDragMove={(event: Konva.KonvaEventObject<DragEvent>) =>
									handleDrag(id, event)
								}
								onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) =>
									handleDragEnd(id, event)
								}
								onTransform={(event: Konva.KonvaEventObject<Event>) =>
									handleTransform(id, event)
								}
								onTransformStart={(event: Konva.KonvaEventObject<Event>) =>
									handleTransformStart(id, event)
								}
								onTransformEnd={(event: Konva.KonvaEventObject<Event>) =>
									handleTransformEnd(id, event)
								}
								onMouseEnter={() => handleMouseEnter(id)}
								onMouseLeave={handleMouseLeave}
								cursor={isSelected ? "default" : "move"}
							/>
						);
					})}
					<Transformer
						ignoreStroke
						ref={transformerRef}
						boundBoxFunc={transformerBoundBoxFunc}
						anchorFill="black"
						anchorStroke="rgba(255,0,0,1)"
						anchorStrokeWidth={1.25}
						anchorSize={7}
						borderStroke="rgba(255,0,0,0.7)"
					/>
				</Layer>
			</Stage>
		</div>
	);
};

const FocusSceneKonvaLayer: React.FC<FocusSceneKonvaLayerProps> = ({
	sceneId,
	...restProps
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const runtime = useMemo(
		() => runtimeManager.ensureTimelineRuntime(toSceneTimelineRef(sceneId)),
		[runtimeManager, sceneId],
	);
	const scopedRuntime = useMemo(() => createScopedRuntime(runtime), [runtime]);

	return (
		<EditorRuntimeProvider runtime={scopedRuntime}>
			<FocusSceneKonvaLayerInner {...restProps} />
		</EditorRuntimeProvider>
	);
};

export default FocusSceneKonvaLayer;
