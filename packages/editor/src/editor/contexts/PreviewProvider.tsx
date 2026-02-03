import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CanvasRef } from "react-skia-lite";

export interface PinchState {
	isPinching: boolean;
	centerX: number; // pinch 中心点 X（相对于容器）
	centerY: number; // pinch 中心点 Y（相对于容器）
	initialZoom: number; // pinch 开始时的 zoomLevel
	currentZoom: number; // 当前临时 zoomLevel
}

const PreviewContext = createContext({
	pictureWidth: 1920,
	pictureHeight: 1080,
	canvasWidth: 1920, // canvas 保持与 picture 相同尺寸
	canvasHeight: 1080,
	setZoomLevel: (zoomLevel: number) => {},
	setPictureSize: (pictureSize: { width: number; height: number }) => {},
	setContainerSize: (containerSize: { width: number; height: number }) => {},
	zoomLevel: 0.5,
	zoomTransform: "",
	offsetX: 0,
	offsetY: 0,
	// Pinch zoom
	pinchState: {
		isPinching: false,
		centerX: 0,
		centerY: 0,
		initialZoom: 0.5,
		currentZoom: 0.5,
	} as PinchState,
	startPinchZoom: (centerX: number, centerY: number) => {},
	updatePinchZoom: (scale: number, centerX: number, centerY: number) => {},
	endPinchZoom: () => {},
	// Pan offset
	panOffset: { x: 0, y: 0 },
	setPanOffset: (offset: { x: number; y: number }) => {},
	resetPanOffset: () => {},
	// Canvas ref
	canvasRef: { current: null } as React.RefObject<CanvasRef | null>,
	setCanvasRef: (ref: CanvasRef | null) => {},
});

const PreviewProvider = ({ children }: { children: React.ReactNode }) => {
	const [pictureSize, setPictureSize] = useState({
		width: 1920,
		height: 1080,
	});

	// Canvas ref for export functionality
	const canvasRefHolder = useRef<CanvasRef | null>(null);
	const setCanvasRef = useCallback((ref: CanvasRef | null) => {
		canvasRefHolder.current = ref;
	}, []);

	// canvas 尺寸保持与 picture 相同，不随 zoom 改变
	// 所有缩放都通过 CSS transform 实现
	const canvasSize = useMemo(
		() => ({
			width: pictureSize.width,
			height: pictureSize.height,
		}),
		[pictureSize],
	);

	const [containerSize, setContainerSize] = useState<{
		width: number;
		height: number;
	} | null>(null);

	// 计算合适的初始 zoomLevel（fit-to-container）
	const calculateFitZoomLevel = useCallback(
		(
			picture: { width: number; height: number },
			container: { width: number; height: number } | null,
		) => {
			if (!container || container.width === 0 || container.height === 0) {
				return 0.5;
			}

			// 留出边距，使画面稍微小一圈（留出 5% 的边距）
			const paddingRatio = 0.95;
			const availableWidth = container.width * paddingRatio;
			const availableHeight = container.height * paddingRatio;

			// 计算缩放比例，使得 picture 能够完整显示在容器中
			const scaleX = availableWidth / picture.width;
			const scaleY = availableHeight / picture.height;
			// 选择较小的缩放比例，确保内容完整显示
			return Math.min(scaleX, scaleY, 1); // 最大不超过 1（不放大）
		},
		[],
	);

	const [zoomLevel, setZoomLevel] = useState(() => {
		return calculateFitZoomLevel(pictureSize, null);
	});

	// Pinch zoom state
	const [pinchState, setPinchState] = useState<PinchState>({
		isPinching: false,
		centerX: 0,
		centerY: 0,
		initialZoom: zoomLevel,
		currentZoom: zoomLevel,
	});

	// Pan offset - 用户手动平移的偏移量
	const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

	const resetPanOffset = useCallback(() => {
		setPanOffset({ x: 0, y: 0 });
	}, []);

	// 设置 zoom level（仅更新 zoomLevel，不改变 canvas 尺寸）
	const setZoom = useCallback((newZoomLevel: number) => {
		setZoomLevel(Math.min(Math.max(newZoomLevel, 0.1), 2));
	}, []);

	// Pinch zoom methods
	const startPinchZoom = useCallback(
		(centerX: number, centerY: number) => {
			setPinchState({
				isPinching: true,
				centerX,
				centerY,
				initialZoom: zoomLevel,
				currentZoom: zoomLevel,
			});
		},
		[zoomLevel],
	);

	const updatePinchZoom = useCallback(
		(scale: number, centerX: number, centerY: number) => {
			setPinchState((prev) => {
				if (!prev.isPinching) return prev;
				const newZoom = Math.min(Math.max(prev.initialZoom * scale, 0.1), 2);
				return {
					...prev,
					centerX,
					centerY,
					currentZoom: newZoom,
				};
			});
		},
		[],
	);

	const endPinchZoom = useCallback(() => {
		setPinchState((prev) => {
			if (!prev.isPinching) return prev;

			const { centerX, centerY, currentZoom } = prev;
			const scaleRatio = currentZoom / zoomLevel;

			// 计算显示尺寸（canvas 尺寸 * zoom）
			const displayedWidth = canvasSize.width * zoomLevel;
			const displayedHeight = canvasSize.height * zoomLevel;

			// 计算当前 canvas 在容器中的基础位置
			const baseOffsetX = containerSize
				? (containerSize.width - displayedWidth) / 2
				: 0;
			const baseOffsetY = containerSize
				? (containerSize.height - displayedHeight) / 2
				: 0;

			// 计算 pinch 期间的实际变换位置（CSS transform 的结果）
			const canvasCenterX = centerX - baseOffsetX - panOffset.x;
			const canvasCenterY = centerY - baseOffsetY - panOffset.y;
			const currentTranslateX =
				baseOffsetX + panOffset.x + canvasCenterX * (1 - scaleRatio);
			const currentTranslateY =
				baseOffsetY + panOffset.y + canvasCenterY * (1 - scaleRatio);

			// 计算新的显示尺寸对应的基础偏移
			const newDisplayedWidth = canvasSize.width * currentZoom;
			const newDisplayedHeight = canvasSize.height * currentZoom;
			const newBaseOffsetX = containerSize
				? (containerSize.width - newDisplayedWidth) / 2
				: 0;
			const newBaseOffsetY = containerSize
				? (containerSize.height - newDisplayedHeight) / 2
				: 0;

			// 计算需要的 panOffset 使得视觉位置保持不变
			const newPanX = currentTranslateX - newBaseOffsetX;
			const newPanY = currentTranslateY - newBaseOffsetY;

			setPanOffset({ x: newPanX, y: newPanY });
			setZoom(currentZoom);

			return {
				...prev,
				isPinching: false,
				initialZoom: currentZoom,
			};
		});
	}, [setZoom, zoomLevel, containerSize, canvasSize, panOffset]);

	// 计算显示尺寸（canvas 尺寸 * zoom）
	const displayedSize = useMemo(() => {
		const currentZoom = pinchState.isPinching
			? pinchState.currentZoom
			: zoomLevel;
		return {
			width: canvasSize.width * currentZoom,
			height: canvasSize.height * currentZoom,
		};
	}, [canvasSize, zoomLevel, pinchState]);

	// 计算基础偏移量（居中）- 基于显示尺寸
	const baseOffset = useMemo(() => {
		if (
			!containerSize ||
			containerSize.width === 0 ||
			containerSize.height === 0
		) {
			return { x: 0, y: 0 };
		}

		// 使用当前 zoom 后的显示尺寸计算居中
		const displayedWidth = canvasSize.width * zoomLevel;
		const displayedHeight = canvasSize.height * zoomLevel;

		const x = (containerSize.width - displayedWidth) / 2;
		const y = (containerSize.height - displayedHeight) / 2;

		return { x, y };
	}, [containerSize, canvasSize, zoomLevel]);

	// 最终偏移量 = 基础偏移 + pan 偏移
	const { offsetX, offsetY } = useMemo(() => {
		return {
			offsetX: baseOffset.x + panOffset.x,
			offsetY: baseOffset.y + panOffset.y,
		};
	}, [baseOffset, panOffset]);

	const zoomTransform = useMemo(() => {
		// pinch zoom 时使用特殊的变换，以 pinch 中心点为原点进行缩放
		if (pinchState.isPinching) {
			const scaleRatio = pinchState.currentZoom / zoomLevel;
			const { centerX, centerY } = pinchState;

			// pinch 中心点相对于当前 canvas 位置（考虑 panOffset）的坐标
			const canvasCenterX = centerX - baseOffset.x - panOffset.x;
			const canvasCenterY = centerY - baseOffset.y - panOffset.y;

			// 使用 translate + scale 实现以 pinch 中心为原点的缩放
			const translateX =
				baseOffset.x + panOffset.x + canvasCenterX * (1 - scaleRatio);
			const translateY =
				baseOffset.y + panOffset.y + canvasCenterY * (1 - scaleRatio);

			// 先平移到正确位置，再应用基础缩放，再应用 pinch 缩放
			return `translate(${translateX}px, ${translateY}px) scale(${zoomLevel * scaleRatio})`;
		}

		// 正常状态：translate + scale(zoomLevel)
		return `translate(${offsetX}px, ${offsetY}px) scale(${zoomLevel})`;
	}, [zoomLevel, offsetX, offsetY, pinchState, baseOffset, panOffset]);

	const setPicture = useCallback(
		(newPictureSize: { width: number; height: number }) => {
			setPictureSize(newPictureSize);
			const newZoomLevel = calculateFitZoomLevel(newPictureSize, containerSize);
			setZoomLevel(newZoomLevel);
		},
		[calculateFitZoomLevel, containerSize],
	);

	const setContainer = useCallback(
		(newContainerSize: { width: number; height: number }) => {
			setContainerSize(newContainerSize);
		},
		[],
	);

	const defaultValues = useMemo(() => {
		return {
			pictureWidth: pictureSize.width,
			pictureHeight: pictureSize.height,
			canvasWidth: canvasSize.width,
			canvasHeight: canvasSize.height,
			zoomLevel,
			setZoomLevel: setZoom,
			setPictureSize: setPicture,
			setContainerSize: setContainer,
			zoomTransform,
			offsetX,
			offsetY,
			// Pinch zoom
			pinchState,
			startPinchZoom,
			updatePinchZoom,
			endPinchZoom,
			// Pan offset
			panOffset,
			setPanOffset,
			resetPanOffset,
			// Canvas ref
			canvasRef: canvasRefHolder,
			setCanvasRef,
		};
	}, [
		pictureSize,
		canvasSize,
		zoomLevel,
		setZoom,
		setPicture,
		setContainer,
		zoomTransform,
		offsetX,
		offsetY,
		pinchState,
		startPinchZoom,
		updatePinchZoom,
		endPinchZoom,
		panOffset,
		setPanOffset,
		resetPanOffset,
		setCanvasRef,
	]);

	return (
		<PreviewContext.Provider value={defaultValues}>
			{children}
		</PreviewContext.Provider>
	);
};

export const usePreview = () => {
	return useContext(PreviewContext);
};

export default PreviewProvider;
