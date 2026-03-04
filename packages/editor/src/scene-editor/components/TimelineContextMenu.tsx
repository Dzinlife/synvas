import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	DropdownMenu,
	DropdownMenuContextContent,
	DropdownMenuContextItem,
	DropdownMenuContextSubmenu,
	DropdownMenuContextSubmenuContent,
	DropdownMenuContextSubmenuTrigger,
	DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";

export interface TimelineContextMenuAction {
	key: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
	onSelect: () => void;
	children?: TimelineContextMenuAction[];
}

interface TimelineContextMenuProps {
	open: boolean;
	x: number;
	y: number;
	actions: TimelineContextMenuAction[];
	onClose: () => void;
}

const MENU_COLLISION_PADDING = 8;
const SUBMENU_SIDE_OFFSET = -2;

const createVirtualAnchorRect = (x: number, y: number): DOMRect => {
	return {
		x,
		y,
		width: 0,
		height: 0,
		top: y,
		right: x,
		bottom: y,
		left: x,
		toJSON: () => ({}),
	};
};

const TimelineContextMenu: React.FC<TimelineContextMenuProps> = ({
	open,
	x,
	y,
	actions,
	onClose,
}) => {
	const closeRequestedRef = useRef(false);
	const anchor = useMemo(() => {
		return {
			getBoundingClientRect: () => createVirtualAnchorRect(x, y),
		};
	}, [x, y]);

	useEffect(() => {
		if (!open) {
			closeRequestedRef.current = false;
		}
	}, [open]);

	const requestClose = useCallback(() => {
		if (closeRequestedRef.current) return;
		closeRequestedRef.current = true;
		onClose();
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const isInsideMenu = (target: EventTarget | null): boolean => {
			if (!(target instanceof Element)) return false;
			return Boolean(
				target.closest('[data-timeline-context-menu-popup="true"]'),
			);
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (isInsideMenu(event.target)) return;
			requestClose();
		};

		const handleContextMenu = (event: MouseEvent) => {
			if (isInsideMenu(event.target)) return;
			requestClose();
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			requestClose();
		};

		const handleWindowChange = () => {
			requestClose();
		};
		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("contextmenu", handleContextMenu, true);
		window.addEventListener("keydown", handleEscape);
		window.addEventListener("wheel", handleWindowChange, true);
		window.addEventListener("scroll", handleWindowChange, true);
		window.addEventListener("resize", handleWindowChange);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("contextmenu", handleContextMenu, true);
			window.removeEventListener("keydown", handleEscape);
			window.removeEventListener("wheel", handleWindowChange, true);
			window.removeEventListener("scroll", handleWindowChange, true);
			window.removeEventListener("resize", handleWindowChange);
		};
	}, [open, requestClose]);

	const renderAction = (action: TimelineContextMenuAction): React.ReactNode => {
		const hasChildren = (action.children?.length ?? 0) > 0;
		if (hasChildren) {
			return (
				<DropdownMenuContextSubmenu key={action.key}>
					<DropdownMenuContextSubmenuTrigger
						disabled={action.disabled}
						danger={action.danger}
						openOnHover
						delay={0}
						closeDelay={150}
					>
						{action.label}
					</DropdownMenuContextSubmenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuContextSubmenuContent
							side="right"
							align="center"
							sideOffset={SUBMENU_SIDE_OFFSET}
							positionMethod="fixed"
							collisionPadding={MENU_COLLISION_PADDING}
							collisionAvoidance={{
								side: "flip",
								align: "shift",
								fallbackAxisSide: "none",
							}}
							data-timeline-context-menu-popup="true"
						>
							{action.children?.map((child) => renderAction(child))}
						</DropdownMenuContextSubmenuContent>
					</DropdownMenuPortal>
				</DropdownMenuContextSubmenu>
			);
		}
		return (
			<DropdownMenuContextItem
				key={action.key}
				disabled={action.disabled}
				danger={action.danger}
				onClick={() => {
					action.onSelect();
					requestClose();
				}}
			>
				{action.label}
			</DropdownMenuContextItem>
		);
	};

	if (!open || actions.length === 0) {
		return null;
	}

	return (
		<DropdownMenu open={open} modal={false}>
			<DropdownMenuPortal>
				<DropdownMenuContextContent
					anchor={anchor}
					side="bottom"
					align="start"
					positionMethod="fixed"
					collisionPadding={MENU_COLLISION_PADDING}
					collisionAvoidance={{
						side: "flip",
						align: "shift",
						fallbackAxisSide: "none",
					}}
					data-timeline-context-menu-popup="true"
				>
					{actions.map((action) => renderAction(action))}
				</DropdownMenuContextContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	);
};

export default TimelineContextMenu;
