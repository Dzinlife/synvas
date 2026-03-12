import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const CANVAS_NODE_DRAWER_DEFAULT_HEIGHT = 320;
export const CANVAS_NODE_DRAWER_MIN_HEIGHT = 240;
export const CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO = 0.65;

interface CanvasNodeDrawerShellProps {
	children: React.ReactNode;
	defaultHeight?: number;
	minHeight?: number;
	maxHeightRatio?: number;
	resizable?: boolean;
	onHeightChange?: (height: number) => void;
	dataTestId?: string;
	resizeHandleLabel?: string;
}

const getClampedHeight = (
	height: number,
	minHeight: number,
	maxHeightRatio: number,
): number => {
	const safeMinHeight = Number.isFinite(minHeight)
		? Math.max(1, Math.round(minHeight))
		: CANVAS_NODE_DRAWER_MIN_HEIGHT;
	const safeRatio =
		Number.isFinite(maxHeightRatio) && maxHeightRatio > 0
			? maxHeightRatio
			: CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO;
	const viewportHeight =
		typeof window !== "undefined" ? window.innerHeight : 1080;
	const maxHeight = Math.max(
		safeMinHeight,
		Math.round(viewportHeight * safeRatio),
	);
	const safeHeight = Number.isFinite(height)
		? Math.round(height)
		: CANVAS_NODE_DRAWER_DEFAULT_HEIGHT;
	return Math.min(maxHeight, Math.max(safeMinHeight, safeHeight));
};

const CanvasNodeDrawerShell: React.FC<CanvasNodeDrawerShellProps> = ({
	children,
	defaultHeight = CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	minHeight = CANVAS_NODE_DRAWER_MIN_HEIGHT,
	maxHeightRatio = CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	resizable = false,
	onHeightChange,
	dataTestId = "canvas-node-drawer-shell",
	resizeHandleLabel = "调整 Drawer 高度",
}) => {
	const normalizedDefaultHeight = useMemo(
		() => getClampedHeight(defaultHeight, minHeight, maxHeightRatio),
		[defaultHeight, maxHeightRatio, minHeight],
	);
	const [drawerHeight, setDrawerHeight] = useState(normalizedDefaultHeight);
	const draggingRef = useRef(false);
	const startYRef = useRef(0);
	const startHeightRef = useRef(0);

	useEffect(() => {
		setDrawerHeight(normalizedDefaultHeight);
	}, [normalizedDefaultHeight]);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!draggingRef.current) return;
			const deltaY = startYRef.current - event.clientY;
			const nextHeight = getClampedHeight(
				startHeightRef.current + deltaY,
				minHeight,
				maxHeightRatio,
			);
			setDrawerHeight(nextHeight);
		},
		[maxHeightRatio, minHeight],
	);

	const stopResize = useCallback(() => {
		draggingRef.current = false;
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mouseup", stopResize);
	}, [handleMouseMove]);

	useEffect(() => {
		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", stopResize);
		};
	}, [handleMouseMove, stopResize]);

	useEffect(() => {
		onHeightChange?.(drawerHeight);
	}, [drawerHeight, onHeightChange]);

	const handleResizeMouseDown = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			draggingRef.current = true;
			startYRef.current = event.clientY;
			startHeightRef.current = drawerHeight;
			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", stopResize);
		},
		[drawerHeight, handleMouseMove, stopResize],
	);

	return (
		<div
			data-testid={dataTestId}
			className="absolute inset-x-0 bottom-0 z-40"
			style={{ height: drawerHeight }}
		>
			{resizable && (
				<button
					type="button"
					aria-label={resizeHandleLabel}
					onMouseDown={handleResizeMouseDown}
					className="absolute -top-2 left-0 h-4 w-full cursor-ns-resize"
				>
					<span className="mx-auto mt-1 block h-1 w-20 rounded-full bg-white/30" />
				</button>
			)}
			<div className="h-full min-h-0 rounded-2xl [corner-shape:superellipse(1.2)] ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl">
				{children}
			</div>
		</div>
	);
};

export default CanvasNodeDrawerShell;
