// import { QueryClientContext } from "@tanstack/react-query";
import type Konva from "konva";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Line as KonvaLine,
	Rect as KonvaRect,
	Layer,
	Stage,
	Transformer,
} from "react-konva";
import type { CanvasRef } from "react-skia-lite";
import {
	renderLayoutToTopLeft,
	transformMetaToRenderLayout,
} from "@/dsl/layout";
import type { TimelineElement } from "@/dsl/types";
import { usePreview } from "./contexts/PreviewProvider";
import { useTimelineStore, useTracks } from "./contexts/TimelineContext";
import { buildKonvaTree } from "./preview/buildSkiaTree";
import { LabelLayer } from "./preview/LabelLayer";
import { SkiaPreviewCanvas } from "./preview/SkiaPreviewCanvas";
import { usePreviewCoordinates } from "./preview/usePreviewCoordinates";
import { usePreviewInteractions } from "./preview/usePreviewInteractions";


const Preview = () => {
	const renderElementsRef = useRef<TimelineElement[]>([]);
	const { tracks } = useTracks();

	const { getDisplayTime, getElements } = useMemo(
		() => useTimelineStore.getState(),
		[],
	);

	// For Konva layer, we need state to trigger re-renders for interaction updates
	// But this is only updated when elements visibility actually changes
	const [renderElements, setRenderElements] = useState<TimelineElement[]>([]);

	const {
		pictureWidth,
		pictureHeight,
		canvasWidth,
		canvasHeight,
		zoomLevel,
		setZoomLevel,
		zoomTransform,
		setContainerSize,
		offsetX,
		offsetY,
		// Pinch zoom
		pinchState,
		startPinchZoom,
		updatePinchZoom,
		endPinchZoom,
		// Pan
		panOffset,
		setPanOffset,
		resetPanOffset,
		// Canvas ref
		setCanvasRef,
	} = usePreview();

	// Pinch zoom state - 记录初始双指距离
	const pinchStartDistanceRef = useRef<number | null>(null);

	const canvasConvertOptions = useMemo(
		() => ({
			picture: {
				width: pictureWidth,
				height: pictureHeight,
			},
			canvas: {
				width: canvasWidth,
				height: canvasHeight,
			},
		}),
		[pictureWidth, pictureHeight, canvasWidth, canvasHeight],
	);
	const { getEffectiveZoom, stageToCanvasCoords, canvasToStageCoords } =
		usePreviewCoordinates({
			offsetX,
			offsetY,
			zoomLevel,
			pinchState,
		});

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
		pictureWidth,
		pictureHeight,
		canvasWidth,
		canvasHeight,
		getEffectiveZoom,
		stageToCanvasCoords,
		canvasToStageCoords,
	});

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

	const skiaCanvasRef = useRef<CanvasRef>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerDimensions, setContainerDimensions] = useState({
		width: 0,
		height: 0,
	});

	// Sync canvas ref to context for export functionality
	useEffect(() => {
		setCanvasRef(skiaCanvasRef.current);
		return () => setCanvasRef(null);
	}, [setCanvasRef]);

	// 监听容器尺寸变化（用于扩大 Konva Stage）
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const updateDimensions = () => {
			const rect = container.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				setContainerDimensions({
					width: rect.width,
					height: rect.height,
				});
				// 设置容器尺寸（用于居中计算）
				setContainerSize({
					width: rect.width,
					height: rect.height,
				});
			}
		};

		// 初始设置
		updateDimensions();

		// 监听窗口大小变化
		const resizeObserver = new ResizeObserver(updateDimensions);
		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
		};
	}, [setContainerSize]);

	// 处理 Mac trackpad pinch zoom（通过 wheel 事件）
	// Mac trackpad 的双指缩放会触发 wheel 事件，并且 ctrlKey 为 true
	const wheelZoomRef = useRef<{
		isZooming: boolean;
		timeoutId: ReturnType<typeof setTimeout> | null;
		initialZoom: number;
		accumulatedDelta: number;
	}>({
		isZooming: false,
		timeoutId: null,
		initialZoom: zoomLevel,
		accumulatedDelta: 0,
	});

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleWheel = (e: WheelEvent) => {
			// Mac trackpad pinch zoom 会带有 ctrlKey
			if (e.ctrlKey) {
				e.preventDefault();
				e.stopPropagation(); // 阻止事件冒泡到 document 级别的处理器

				const rect = container.getBoundingClientRect();
				const centerX = e.clientX - rect.left;
				const centerY = e.clientY - rect.top;

				// 开始缩放
				if (!wheelZoomRef.current.isZooming) {
					wheelZoomRef.current.isZooming = true;
					wheelZoomRef.current.initialZoom = zoomLevel;
					wheelZoomRef.current.accumulatedDelta = 0;
					startPinchZoom(centerX, centerY);
				}

				// 清除之前的结束计时器
				if (wheelZoomRef.current.timeoutId) {
					clearTimeout(wheelZoomRef.current.timeoutId);
				}

				// 累积 delta 值（负值表示放大，正值表示缩小）
				wheelZoomRef.current.accumulatedDelta += e.deltaY;

				// 计算缩放比例（使用指数函数使缩放更平滑）
				const scale = Math.exp(-wheelZoomRef.current.accumulatedDelta * 0.01);
				updatePinchZoom(scale, centerX, centerY);

				// 设置结束计时器（wheel 事件停止后 150ms 结束缩放）
				wheelZoomRef.current.timeoutId = setTimeout(() => {
					wheelZoomRef.current.isZooming = false;
					wheelZoomRef.current.timeoutId = null;
					endPinchZoom();
				}, 150);
			} else {
				// 普通滚动 - 用于平移画布
				e.preventDefault();
				// shift + 滚动 = 水平滚动
				const deltaX = e.shiftKey ? e.deltaY : e.deltaX;
				const deltaY = e.shiftKey ? 0 : e.deltaY;

				setPanOffset({
					x: panOffset.x - deltaX,
					y: panOffset.y - deltaY,
				});
			}
		};

		container.addEventListener("wheel", handleWheel, { passive: false });

		return () => {
			container.removeEventListener("wheel", handleWheel);
			if (wheelZoomRef.current.timeoutId) {
				clearTimeout(wheelZoomRef.current.timeoutId);
			}
		};
	}, [
		zoomLevel,
		startPinchZoom,
		updatePinchZoom,
		endPinchZoom,
		panOffset,
		setPanOffset,
	]);

	// 处理 touch 事件实现 pinch zoom（触摸屏）
	// 使用 Konva 的事件类型（原生 TouchEvent）
	const handleTouchStart = useCallback(
		(e: Konva.KonvaEventObject<TouchEvent>) => {
			const nativeEvent = e.evt;
			if (nativeEvent.touches.length === 2) {
				nativeEvent.preventDefault();
				const touch1 = nativeEvent.touches[0];
				const touch2 = nativeEvent.touches[1];

				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();

				const distance = Math.sqrt(
					(touch1.clientX - touch2.clientX) ** 2 +
						(touch1.clientY - touch2.clientY) ** 2,
				);
				const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
				const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

				pinchStartDistanceRef.current = distance;
				startPinchZoom(centerX, centerY);
			}
		},
		[startPinchZoom],
	);

	const handleTouchMove = useCallback(
		(e: Konva.KonvaEventObject<TouchEvent>) => {
			const nativeEvent = e.evt;
			if (
				nativeEvent.touches.length === 2 &&
				pinchStartDistanceRef.current !== null
			) {
				nativeEvent.preventDefault();
				const touch1 = nativeEvent.touches[0];
				const touch2 = nativeEvent.touches[1];

				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();

				const distance = Math.sqrt(
					(touch1.clientX - touch2.clientX) ** 2 +
						(touch1.clientY - touch2.clientY) ** 2,
				);
				const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
				const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

				// 计算缩放比例
				const scale = distance / pinchStartDistanceRef.current;
				updatePinchZoom(scale, centerX, centerY);
			}
		},
		[updatePinchZoom],
	);

	const handleTouchEnd = useCallback(
		(e: Konva.KonvaEventObject<TouchEvent>) => {
			const nativeEvent = e.evt;
			// 只有当所有手指都离开时才结束 pinch
			if (
				nativeEvent.touches.length < 2 &&
				pinchStartDistanceRef.current !== null
			) {
				pinchStartDistanceRef.current = null;
				endPinchZoom();
			}
		},
		[endPinchZoom],
	);

	useEffect(() => {
		const updateKonvaElements = () => {
			const displayTime = getDisplayTime();
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

		const unsub1 = useTimelineStore.subscribe(
			(state) => state.currentTime,
			updateKonvaElements,
		);
		const unsub2 = useTimelineStore.subscribe(
			(state) => state.previewTime,
			updateKonvaElements,
		);
		return () => {
			unsub1();
			unsub2();
		};
	}, [getDisplayTime, getElements, sortByTrackIndex, tracks]);

	useEffect(() => {
		return useTimelineStore.subscribe(
			(state) => state.elements,
			(newElements) => {
				const time = getDisplayTime();
				const orderedElements = buildKonvaTree({
					elements: newElements,
					displayTime: time,
					tracks,
					sortByTrackIndex,
				});

				// Update Konva layer
				renderElementsRef.current = orderedElements;
				setRenderElements(orderedElements);
			},
			{
				fireImmediately: true,
			},
		);
	}, [getDisplayTime, sortByTrackIndex, tracks]);

	const stageWidth = containerDimensions.width || canvasWidth;
	const stageHeight = containerDimensions.height || canvasHeight;

	return (
		<div
			ref={containerRef}
			className="w-full h-full overflow-hidden"
			style={{ touchAction: "none", position: "relative" }}
			data-preview-drop-zone
			data-zoom-level={zoomLevel}
			data-offset-x={offsetX}
			data-offset-y={offsetY}
			data-picture-width={pictureWidth}
			data-picture-height={pictureHeight}
		>
			{/* <button onClick={handleDownload}>download image</button>
			<button onClick={handleDownloadWithoutBackground}>
				download image without background
			</button> */}
			<div
				style={{
					position: "relative",
					width: canvasWidth,
					height: canvasHeight,
					transform: zoomTransform,
					transformOrigin: "top left",
					willChange: "transform",
				}}
			>
				{/* 下层：Skia Canvas 渲染实际内容 */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						pointerEvents: "none",
					}}
				>
					<SkiaPreviewCanvas
						canvasWidth={canvasWidth}
						canvasHeight={canvasHeight}
						tracks={tracks}
						getTrackIndexForElement={getTrackIndexForElement}
						sortByTrackIndex={sortByTrackIndex}
						getElements={getElements}
						getDisplayTime={getDisplayTime}
						canvasRef={skiaCanvasRef}
					/>
				</div>
			</div>

			{/* DOM 文字标签层 - 在变换 div 外面，使用屏幕坐标，pinch 过程中隐藏 */}
			{!pinchState.isPinching && (
				<LabelLayer
					elements={renderElements}
					selectedIds={selectedIds}
					stageRef={stageRef}
					canvasConvertOptions={canvasConvertOptions}
					offsetX={offsetX}
					offsetY={offsetY}
					zoomLevel={zoomLevel}
					pinchState={pinchState}
					groupProxyBox={groupProxyBox}
				/>
			)}

			{/* 上层：Konva 交互层 - 覆盖整个容器，pinch 过程中隐藏内容 */}
			<Stage
				ref={stageRef}
				width={stageWidth}
				height={stageHeight}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					opacity: pinchState.isPinching ? 0 : 1,
				}}
				onClick={handleStageClick}
				onMouseDown={handleStageMouseDown}
				onMouseMove={handleStageMouseMove}
				onMouseUp={handleStageMouseUp}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
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
							key={`snap-v-${x}`}
							points={[x, 0, x, stageHeight]}
							stroke="rgba(59,130,246,0.8)"
							strokeWidth={1}
							dash={[4, 4]}
							listening={false}
						/>
					))}
					{snapGuides.horizontal.map((y) => (
						<KonvaLine
							key={`snap-h-${y}`}
							points={[0, y, stageWidth, y]}
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
					{renderElements.map((el) => {
						const { id } = el;
						const isHovered = hoveredId === id;
						const isDragging = draggingId === id;
						const isSelected = selectedIds.includes(id);

						const renderLayout = transformMetaToRenderLayout(
							el.transform,
							canvasConvertOptions.picture,
							canvasConvertOptions.canvas,
						);
						const {
							x: canvasX,
							y: canvasY,
							width: canvasWidth_el,
							height: canvasHeight_el,
							rotation: rotate,
						} = renderLayoutToTopLeft(renderLayout);

						// 将画布坐标转换为 Stage 坐标
						const { stageX, stageY } = canvasToStageCoords(canvasX, canvasY);

						// 将画布尺寸转换为 Stage 尺寸
						const effectiveZoom = pinchState.isPinching
							? pinchState.currentZoom
							: zoomLevel;
						const baseTransform = transformBaseRef.current[id];
						const canvasWidth = baseTransform?.canvasWidth ?? canvasWidth_el;
						const canvasHeight = baseTransform?.canvasHeight ?? canvasHeight_el;
						const stageWidth = canvasWidth * effectiveZoom;
						const stageHeight = canvasHeight * effectiveZoom;

						// 将弧度转换为度数（Konva 使用度数）
						const rotationDegrees = (rotate * 180) / Math.PI;

						return (
							<React.Fragment key={id}>
								<KonvaRect
									x={stageX}
									y={stageY}
									width={stageWidth}
									height={stageHeight}
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
									strokeWidth={isSelected ? 1 : 1}
									draggable
									data-id={id}
									name={`element-${id}`}
									rotation={rotationDegrees}
									onMouseDown={() => handleMouseDown(id)}
									onMouseUp={handleMouseUp}
									onDragStart={(e: Konva.KonvaEventObject<DragEvent>) =>
										handleDragStart(id, e)
									}
									onDragMove={(e: Konva.KonvaEventObject<DragEvent>) =>
										handleDrag(id, e)
									}
									onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) =>
										handleDragEnd(id, e)
									}
									onTransform={(e: Konva.KonvaEventObject<Event>) =>
										handleTransform(id, e)
									}
									onTransformStart={(e: Konva.KonvaEventObject<Event>) =>
										handleTransformStart(id, e)
									}
									onTransformEnd={(e: Konva.KonvaEventObject<Event>) =>
										handleTransformEnd(id, e)
									}
									onMouseEnter={() => handleMouseEnter(id)}
									onMouseLeave={handleMouseLeave}
									cursor={isSelected ? "default" : "move"}
								/>
							</React.Fragment>
						);
					})}
					{/* Transformer 用于缩放和旋转 */}
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
			<div
				style={{
					position: "absolute",
					bottom: 16,
					left: "50%",
					transform: "translateX(-50%)",
					display: "flex",
					alignItems: "center",
					gap: 8,
					background: "rgba(0,0,0,0.6)",
					padding: "6px 12px",
					borderRadius: 20,
					backdropFilter: "blur(8px)",
				}}
			>
				<button
					type="button"
					onClick={resetPanOffset}
					style={{
						background: "transparent",
						border: "none",
						color: "white",
						cursor: "pointer",
						padding: "4px 8px",
						borderRadius: 4,
						fontSize: 12,
					}}
					title="重置视图位置"
				>
					⟲
				</button>
				<input
					type="range"
					min={0.1}
					max={2}
					step={0.001}
					value={pinchState.isPinching ? pinchState.currentZoom : zoomLevel}
					onChange={(e) => {
						setZoomLevel(Number(e.target.value));
					}}
					style={{ width: 100 }}
				/>
				<span style={{ color: "white", fontSize: 12, minWidth: 40 }}>
					{Math.round(
						(pinchState.isPinching ? pinchState.currentZoom : zoomLevel) * 100,
					)}
					%
				</span>
			</div>
		</div>
	);
};

export default Preview;
