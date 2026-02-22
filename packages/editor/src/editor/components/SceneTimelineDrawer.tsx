import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import TimelineEditor from "@/editor/TimelineEditor";
import ScenePlaybackControlBar from "./ScenePlaybackControlBar";

const MIN_HEIGHT = 240;
const DEFAULT_HEIGHT = 320;

interface SceneTimelineDrawerProps {
	onExitFocus: () => void;
}

const SceneTimelineDrawer: React.FC<SceneTimelineDrawerProps> = ({
	onExitFocus,
}) => {
	const [drawerHeight, setDrawerHeight] = useState(DEFAULT_HEIGHT);
	const draggingRef = useRef(false);
	const startYRef = useRef(0);
	const startHeightRef = useRef(0);

	const handleMouseMove = useCallback((event: MouseEvent) => {
		if (!draggingRef.current) return;
		const deltaY = startYRef.current - event.clientY;
		const maxHeight = Math.max(
			MIN_HEIGHT,
			Math.round(window.innerHeight * 0.65),
		);
		const nextHeight = Math.min(
			maxHeight,
			Math.max(MIN_HEIGHT, startHeightRef.current + deltaY),
		);
		setDrawerHeight(nextHeight);
	}, []);

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
			data-testid="scene-timeline-drawer"
			className="absolute inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900"
			style={{ height: drawerHeight }}
		>
			<button
				type="button"
				aria-label="调整时间线高度"
				onMouseDown={handleResizeMouseDown}
				className="absolute -top-2 left-0 h-4 w-full cursor-ns-resize"
			>
				<span className="mx-auto mt-1 block h-1 w-20 rounded-full bg-white/30" />
			</button>
			<div className="flex h-full min-h-0 flex-col">
				<ScenePlaybackControlBar onExitFocus={onExitFocus} />
				<div className="min-h-0 flex-1">
					<TimelineEditor />
				</div>
			</div>
		</div>
	);
};

export default SceneTimelineDrawer;
