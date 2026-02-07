import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface TimelineContextMenuAction {
	key: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
	onSelect: () => void;
}

interface TimelineContextMenuProps {
	open: boolean;
	x: number;
	y: number;
	actions: TimelineContextMenuAction[];
	onClose: () => void;
}

const MENU_WIDTH = 140;
const MENU_ITEM_HEIGHT = 34;
const MENU_PADDING = 6;
const SCREEN_PADDING = 8;

const TimelineContextMenu: React.FC<TimelineContextMenuProps> = ({
	open,
	x,
	y,
	actions,
	onClose,
}) => {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (menuRef.current?.contains(target)) return;
			onClose();
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			onClose();
		};

		const handleWindowChange = () => {
			onClose();
		};

		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("contextmenu", handlePointerDown, true);
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("wheel", handleWindowChange, true);
		window.addEventListener("scroll", handleWindowChange, true);
		window.addEventListener("resize", handleWindowChange);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("contextmenu", handlePointerDown, true);
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("wheel", handleWindowChange, true);
			window.removeEventListener("scroll", handleWindowChange, true);
			window.removeEventListener("resize", handleWindowChange);
		};
	}, [open, onClose]);

	const position = useMemo(() => {
		if (typeof window === "undefined") {
			return { left: x, top: y };
		}
		const estimatedHeight =
			actions.length * MENU_ITEM_HEIGHT + MENU_PADDING * 2;
		const maxLeft = Math.max(
			SCREEN_PADDING,
			window.innerWidth - MENU_WIDTH - SCREEN_PADDING,
		);
		const maxTop = Math.max(
			SCREEN_PADDING,
			window.innerHeight - estimatedHeight - SCREEN_PADDING,
		);
		return {
			left: Math.max(SCREEN_PADDING, Math.min(x, maxLeft)),
			top: Math.max(SCREEN_PADDING, Math.min(y, maxTop)),
		};
	}, [actions.length, x, y]);

	if (!open || actions.length === 0 || typeof document === "undefined") {
		return null;
	}

	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-[1000] min-w-35 rounded-md border border-white/10 bg-neutral-900/95 p-1 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl"
			style={{ left: position.left, top: position.top }}
			role="menu"
		>
			{actions.map((action) => {
				return (
					<button
						type="button"
						key={action.key}
						role="menuitem"
						disabled={action.disabled}
						className={cn(
							"flex h-8.5 w-full items-center rounded px-2.5 text-left text-neutral-100 transition-colors",
							{
								"cursor-pointer hover:bg-white/10": !action.disabled,
								"cursor-not-allowed text-neutral-500": action.disabled,
								"text-red-300 hover:bg-red-500/20":
									action.danger && !action.disabled,
							},
						)}
						onClick={() => {
							if (action.disabled) return;
							action.onSelect();
							onClose();
						}}
					>
						{action.label}
					</button>
				);
			})}
		</div>,
		document.body,
	);
};

export default TimelineContextMenu;
