import { useDrag } from "@use-gesture/react";
import type { CanvasNode } from "@/studio/project/types";
import { ChevronRight } from "lucide-react";
import type React from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import {
	buildLayerTreeOrder,
	compareSiblingOrderDesc,
} from "@/studio/canvas/layerOrderCoordinator";
import { resolveCanvasNodeTypeIcon } from "../canvasNodeIconLabel";
import CanvasElementLibrary from "./CanvasElementLibrary";

export type CanvasSidebarMode = "canvas" | "focus";
export type CanvasSidebarTab = "nodes" | "element";

type DropPosition = "before" | "inside" | "after";

export interface CanvasSidebarNodeSelectOptions {
	toggle?: boolean;
}

export interface CanvasSidebarNodeReorderRequest {
	dragNodeIds: string[];
	targetNodeId: string | null;
	position: DropPosition;
}

interface CanvasSidebarProps {
	mode: CanvasSidebarMode;
	nodes: CanvasNode[];
	activeNodeId: string | null;
	selectedNodeIds: string[];
	activeTab: CanvasSidebarTab;
	onTabChange: (tab: CanvasSidebarTab) => void;
	onNodeSelect: (
		node: CanvasNode,
		options?: CanvasSidebarNodeSelectOptions,
	) => void;
	onNodeReorder?: (request: CanvasSidebarNodeReorderRequest) => void;
	onCollapse?: () => void;
}

interface NodeListProps {
	nodes: CanvasNode[];
	activeNodeId: string | null;
	selectedNodeIds: string[];
	disabled: boolean;
	onDraggingChange?: (isDragging: boolean) => void;
	onNodeSelect: (
		node: CanvasNode,
		options?: CanvasSidebarNodeSelectOptions,
	) => void;
	onNodeReorder?: (request: CanvasSidebarNodeReorderRequest) => void;
}

interface NestedNodeItem {
	node: CanvasNode;
	children: NestedNodeItem[];
	isCollapsed: boolean;
	hasChildren: boolean;
}

interface DropIntent {
	targetNodeId: string | null;
	position: DropPosition;
}

interface NodeListDragState {
	dragNodeIds: string[];
	overIntent: DropIntent | null;
}

interface NodeRowLayout {
	nodeId: string | null;
	rect: DOMRect;
}

interface ResolveDropIntentFromLayoutsOptions {
	clientY: number;
	containerRect: DOMRect;
	rowLayouts: NodeRowLayout[];
	previousIntent: DropIntent | null;
	dragNodeIds: string[];
	nodeById: Map<string, CanvasNode>;
}

interface ResolveDropLineTopOptions {
	overIntent: DropIntent | null;
	container: HTMLElement;
	rowLayouts: NodeRowLayout[];
}

const NODE_ROW_SELECTOR = "[data-node-row-container='true']";
const ROW_INSIDE_TOP_RATIO = 0.25;
const ROW_INSIDE_BOTTOM_RATIO = 0.75;
const AUTO_EXPAND_DELAY_MS = 500;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_SPEED = 14;
const ROOT_DROP_EDGE_PX = 18;
const INTENT_HYSTERESIS_PX = 2;
const ROW_BOUNDARY_HYSTERESIS_PX = 4;
const NODE_ROW_INDENT_PX = 21;

const isSameDropIntent = (
	left: DropIntent | null,
	right: DropIntent | null,
): boolean => {
	return (
		left?.targetNodeId === right?.targetNodeId &&
		left?.position === right?.position
	);
};

const collectNodeRowLayouts = (container: HTMLElement): NodeRowLayout[] => {
	return [...container.querySelectorAll<HTMLElement>(NODE_ROW_SELECTOR)].map(
		(element) => ({
			nodeId: element.dataset.nodeId ?? null,
			rect: element.getBoundingClientRect(),
		}),
	);
};

const resolveDropLineTop = ({
	overIntent,
	container,
	rowLayouts,
}: ResolveDropLineTopOptions): number | null => {
	if (!overIntent || overIntent.position === "inside") return null;
	const clampLineTop = (value: number): number => {
		const maxTop = Math.max(container.clientHeight - 1, 0);
		return Math.max(0, Math.min(Math.round(value), maxTop));
	};
	if (!overIntent.targetNodeId) {
		if (overIntent.position === "before") return 0;
		return clampLineTop(container.clientHeight);
	}
	if (rowLayouts.length === 0) return null;
	const targetIndex = rowLayouts.findIndex((layout) => {
		return layout.nodeId === overIntent.targetNodeId;
	});
	if (targetIndex < 0) return null;
	const targetLayout = rowLayouts[targetIndex];
	if (!targetLayout) return null;
	let boundaryY =
		overIntent.position === "before"
			? targetLayout.rect.top
			: targetLayout.rect.bottom;
	if (overIntent.position === "before" && targetIndex > 0) {
		const previousLayout = rowLayouts[targetIndex - 1];
		if (previousLayout) {
			boundaryY = (previousLayout.rect.bottom + targetLayout.rect.top) * 0.5;
		}
	}
	if (overIntent.position === "after" && targetIndex < rowLayouts.length - 1) {
		const nextLayout = rowLayouts[targetIndex + 1];
		if (nextLayout) {
			boundaryY = (targetLayout.rect.bottom + nextLayout.rect.top) * 0.5;
		}
	}
	const containerRect = container.getBoundingClientRect();
	const viewportTop = boundaryY - containerRect.top;
	return clampLineTop(viewportTop);
};

const resolveDropIntentFromLayouts = ({
	clientY,
	containerRect,
	rowLayouts,
	previousIntent,
	dragNodeIds,
	nodeById,
}: ResolveDropIntentFromLayoutsOptions): DropIntent | null => {
	if (rowLayouts.length === 0) return null;
	const resolveSiblingIntentIfAllowed = (
		targetNodeId: string,
		position: "before" | "after",
	): DropIntent | null => {
		if (isNodeInsideDragSubtree(targetNodeId, dragNodeIds, nodeById)) {
			return null;
		}
		const targetNode = nodeById.get(targetNodeId);
		if (!targetNode) return null;
		return {
			targetNodeId,
			position,
		};
	};
	if (clientY <= containerRect.top + ROOT_DROP_EDGE_PX) {
		return {
			targetNodeId: null,
			position: "before",
		};
	}
	if (clientY >= containerRect.bottom - ROOT_DROP_EDGE_PX) {
		return {
			targetNodeId: null,
			position: "after",
		};
	}
	const firstRect = rowLayouts[0]?.rect;
	const lastRect = rowLayouts.at(-1)?.rect;
	if (!firstRect || !lastRect) return null;
	if (clientY < firstRect.top) {
		return {
			targetNodeId: null,
			position: "before",
		};
	}
	if (clientY > lastRect.bottom) {
		return {
			targetNodeId: null,
			position: "after",
		};
	}
	for (let index = 0; index < rowLayouts.length - 1; index += 1) {
		const currentRow = rowLayouts[index];
		const nextRow = rowLayouts[index + 1];
		if (!currentRow || !nextRow) continue;
		if (!currentRow.nodeId || !nextRow.nodeId) continue;
		const boundaryY = (currentRow.rect.bottom + nextRow.rect.top) * 0.5;
		if (Math.abs(clientY - boundaryY) > ROW_BOUNDARY_HYSTERESIS_PX) continue;
		const shouldKeepCurrentAfter =
			previousIntent?.targetNodeId === currentRow.nodeId &&
			previousIntent.position === "after";
		if (shouldKeepCurrentAfter) {
			const keepIntent = resolveSiblingIntentIfAllowed(
				currentRow.nodeId,
				"after",
			);
			if (keepIntent) return keepIntent;
		}
		const shouldKeepNextBefore =
			previousIntent?.targetNodeId === nextRow.nodeId &&
			previousIntent.position === "before";
		if (shouldKeepNextBefore) {
			const keepIntent = resolveSiblingIntentIfAllowed(
				nextRow.nodeId,
				"before",
			);
			if (keepIntent) return keepIntent;
		}
		const stableIntent = resolveSiblingIntentIfAllowed(
			currentRow.nodeId,
			"after",
		);
		if (stableIntent) return stableIntent;
		const fallbackIntent = resolveSiblingIntentIfAllowed(
			nextRow.nodeId,
			"before",
		);
		if (fallbackIntent) return fallbackIntent;
	}
	let targetLayout = rowLayouts[0];
	for (const layout of rowLayouts) {
		if (clientY <= layout.rect.bottom) {
			targetLayout = layout;
			break;
		}
	}
	if (!targetLayout?.nodeId) return null;
	if (isNodeInsideDragSubtree(targetLayout.nodeId, dragNodeIds, nodeById)) {
		return null;
	}
	const targetNode = nodeById.get(targetLayout.nodeId);
	if (!targetNode) return null;
	const relativeY = clientY - targetLayout.rect.top;
	const clampedRatio = Math.max(
		0,
		Math.min(1, relativeY / Math.max(targetLayout.rect.height, 1)),
	);
	if (targetNode.type === "frame") {
		const beforeBoundaryY = targetLayout.rect.height * ROW_INSIDE_TOP_RATIO;
		const afterBoundaryY = targetLayout.rect.height * ROW_INSIDE_BOTTOM_RATIO;
		const canKeepBeforeOrInside =
			previousIntent?.targetNodeId === targetLayout.nodeId &&
			(previousIntent.position === "before" ||
				previousIntent.position === "inside") &&
			Math.abs(relativeY - beforeBoundaryY) <= INTENT_HYSTERESIS_PX;
		if (canKeepBeforeOrInside) {
			return {
				targetNodeId: targetLayout.nodeId,
				position: previousIntent.position,
			};
		}
		const canKeepInsideOrAfter =
			previousIntent?.targetNodeId === targetLayout.nodeId &&
			(previousIntent.position === "inside" ||
				previousIntent.position === "after") &&
			Math.abs(relativeY - afterBoundaryY) <= INTENT_HYSTERESIS_PX;
		if (canKeepInsideOrAfter) {
			return {
				targetNodeId: targetLayout.nodeId,
				position: previousIntent.position,
			};
		}
		if (clampedRatio < ROW_INSIDE_TOP_RATIO) {
			return {
				targetNodeId: targetLayout.nodeId,
				position: "before",
			};
		}
		if (clampedRatio > ROW_INSIDE_BOTTOM_RATIO) {
			return {
				targetNodeId: targetLayout.nodeId,
				position: "after",
			};
		}
		return {
			targetNodeId: targetLayout.nodeId,
			position: "inside",
		};
	}
	const middleBoundaryY = targetLayout.rect.height * 0.5;
	const canKeepBeforeOrAfter =
		previousIntent?.targetNodeId === targetLayout.nodeId &&
		(previousIntent.position === "before" ||
			previousIntent.position === "after") &&
		Math.abs(relativeY - middleBoundaryY) <= INTENT_HYSTERESIS_PX;
	if (canKeepBeforeOrAfter) {
		return {
			targetNodeId: targetLayout.nodeId,
			position: previousIntent.position,
		};
	}
	return {
		targetNodeId: targetLayout.nodeId,
		position: clampedRatio < 0.5 ? "before" : "after",
	};
};

const resolveParentId = (
	node: CanvasNode,
	nodeById: Map<string, CanvasNode>,
): string | null => {
	const rawParentId = node.parentId ?? null;
	if (!rawParentId) return null;
	const parent = nodeById.get(rawParentId);
	if (!parent || parent.type !== "frame") return null;
	return parent.id;
};

const buildNestedNodeItems = (
	nodes: CanvasNode[],
	collapsedFrameIds: Set<string>,
): NestedNodeItem[] => {
	if (nodes.length === 0) return [];
	const layerTreeOrder = buildLayerTreeOrder(nodes);
	const compareNodeTreePaintOrder = (
		left: CanvasNode,
		right: CanvasNode,
	): number => {
		const leftIndex =
			layerTreeOrder.paintOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			layerTreeOrder.paintOrderByNodeId.get(right.id) ??
			Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.id.localeCompare(right.id);
	};
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const childrenByParentId = new Map<string | null, CanvasNode[]>();
	for (const node of nodes) {
		const parentId = resolveParentId(node, nodeById);
		const siblings = childrenByParentId.get(parentId) ?? [];
		siblings.push(node);
		childrenByParentId.set(parentId, siblings);
	}
	for (const [parentId, siblings] of childrenByParentId) {
		childrenByParentId.set(
			parentId,
			[...siblings].sort(compareSiblingOrderDesc),
		);
	}
	const visited = new Set<string>();
	const items: NestedNodeItem[] = [];
	const visit = (parentId: string | null): NestedNodeItem[] => {
		const childNodes = childrenByParentId.get(parentId) ?? [];
		const children: NestedNodeItem[] = [];
		for (const childNode of childNodes) {
			if (visited.has(childNode.id)) continue;
			visited.add(childNode.id);
			const isCollapsed = collapsedFrameIds.has(childNode.id);
			const hasChildren =
				childNode.type === "frame" &&
				(childrenByParentId.get(childNode.id)?.length ?? 0) > 0;
			const nextChildren =
				childNode.type === "frame" && hasChildren ? visit(childNode.id) : [];
			const nestedChildren = !isCollapsed ? nextChildren : [];
			children.push({
				node: childNode,
				children: nestedChildren,
				isCollapsed,
				hasChildren,
			});
		}
		return children;
	};
	items.push(...visit(null));
	for (const node of [...nodes].sort(compareNodeTreePaintOrder).reverse()) {
		if (visited.has(node.id)) continue;
		const isCollapsed = collapsedFrameIds.has(node.id);
		const hasChildren =
			node.type === "frame" &&
			(childrenByParentId.get(node.id)?.length ?? 0) > 0;
		const nextChildren =
			node.type === "frame" && hasChildren ? visit(node.id) : [];
		items.push({
			node,
			children: !isCollapsed ? nextChildren : [],
			isCollapsed,
			hasChildren,
		});
	}
	return items;
};

const hasAncestorInSet = (
	nodeId: string,
	nodeById: Map<string, CanvasNode>,
	nodeIdSet: Set<string>,
): boolean => {
	let currentNodeId = nodeById.get(nodeId)?.parentId ?? null;
	while (currentNodeId) {
		if (nodeIdSet.has(currentNodeId)) return true;
		currentNodeId = nodeById.get(currentNodeId)?.parentId ?? null;
	}
	return false;
};

const resolveRootDragNodeIds = (
	nodes: CanvasNode[],
	candidateNodeIds: string[],
): string[] => {
	if (candidateNodeIds.length === 0) return [];
	const layerTreeOrder = buildLayerTreeOrder(nodes);
	const compareNodeTreePaintOrder = (
		left: CanvasNode,
		right: CanvasNode,
	): number => {
		const leftIndex =
			layerTreeOrder.paintOrderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			layerTreeOrder.paintOrderByNodeId.get(right.id) ??
			Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.id.localeCompare(right.id);
	};
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const nodeIdSet = new Set(candidateNodeIds);
	const rootNodes = candidateNodeIds
		.map((nodeId) => nodeById.get(nodeId) ?? null)
		.filter((node): node is CanvasNode => Boolean(node))
		.sort(compareNodeTreePaintOrder)
		.filter((node) => {
			return !hasAncestorInSet(node.id, nodeById, nodeIdSet);
		});
	return rootNodes.map((node) => node.id);
};

const isNodeInsideDragSubtree = (
	nodeId: string,
	dragRootNodeIds: string[],
	nodeById: Map<string, CanvasNode>,
): boolean => {
	for (const dragRootNodeId of dragRootNodeIds) {
		if (nodeId === dragRootNodeId) return true;
		let currentNodeId = nodeById.get(nodeId)?.parentId ?? null;
		while (currentNodeId) {
			if (currentNodeId === dragRootNodeId) return true;
			currentNodeId = nodeById.get(currentNodeId)?.parentId ?? null;
		}
	}
	return false;
};

interface NodeListRowProps {
	item: NestedNodeItem;
	depth: number;
	isActive: boolean;
	isSelected: boolean;
	isDragging: boolean;
	disabled: boolean;
	overIntent: DropIntent | null;
	onToggleCollapse: (nodeId: string) => void;
	onNodeSelect: (
		node: CanvasNode,
		options?: CanvasSidebarNodeSelectOptions,
	) => void;
	onRowDragStart: (
		node: CanvasNode,
		clientX: number,
		clientY: number,
	) => boolean;
	onRowDragMove: (clientX: number, clientY: number) => void;
	onRowDragEnd: () => void;
}

const NodeListRow: React.FC<NodeListRowProps> = ({
	item,
	depth,
	isActive,
	isSelected,
	isDragging,
	disabled,
	overIntent,
	onToggleCollapse,
	onNodeSelect,
	onRowDragStart,
	onRowDragMove,
	onRowDragEnd,
}) => {
	const dragActivatedRef = useRef(false);
	const suppressClickRef = useRef(false);
	const showInsideIndicator =
		overIntent?.targetNodeId === item.node.id &&
		overIntent.position === "inside";
	const bindRowDrag = useDrag(
		({ first, last, intentional, xy: [clientX, clientY] }) => {
			if (first) {
				dragActivatedRef.current = false;
			}
			if (!dragActivatedRef.current && intentional) {
				const started = onRowDragStart(item.node, clientX, clientY);
				if (started) {
					dragActivatedRef.current = true;
					suppressClickRef.current = true;
				}
			}
			if (!dragActivatedRef.current) return;
			if (last) {
				onRowDragEnd();
				window.setTimeout(() => {
					suppressClickRef.current = false;
				}, 0);
				return;
			}
			onRowDragMove(clientX, clientY);
		},
		{
			enabled: !disabled,
			pointer: { capture: true },
			filterTaps: true,
			threshold: 1,
		},
	);

	return (
		<button
			type="button"
			className={cn(
				"group relative w-full py-1 text-left",
				!disabled && "cursor-pointer",
				disabled && "cursor-not-allowed",
			)}
			data-testid={`canvas-sidebar-node-item-${item.node.id}`}
			data-node-id={item.node.id}
			data-node-row-container="true"
			disabled={disabled}
			onClick={(event) => {
				const target = event.target as HTMLElement;
				if (target.closest("[data-node-toggle='true']")) {
					return;
				}
				if (suppressClickRef.current) {
					suppressClickRef.current = false;
					return;
				}
				onNodeSelect(item.node, {
					toggle: event.shiftKey || event.metaKey || event.ctrlKey,
				});
			}}
			{...bindRowDrag()}
		>
			<div
				className={cn(
					"relative w-full rounded-md py-1.5 pl-0.5 pr-2 text-left",
					isActive && "bg-mauve-500/15 text-white",
					!isActive && isSelected && "bg-mauve-500/20 text-white",
					!isActive && !isSelected && "bg-transparent text-white/90",
					!isDragging &&
						!disabled &&
						!isActive &&
						!isSelected &&
						"group-hover:bg-white/5",
					disabled && "opacity-60",
					showInsideIndicator &&
						item.node.type === "frame" &&
						"ring-1 ring-white ring-inset rounded-none",
				)}
				style={{
					paddingLeft: depth * NODE_ROW_INDENT_PX,
				}}
			>
				<div className="flex items-center justify-between">
					<div
						className={cn(
							"flex min-w-0 items-center relative",
							item.node.type === "scene" && "text-lime-300",
						)}
					>
						{item.node.type === "frame" && item.hasChildren ? (
							<span
								data-node-toggle="true"
								data-testid={`canvas-sidebar-node-toggle-${item.node.id}`}
								onPointerDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									onToggleCollapse(item.node.id);
								}}
								className={cn(
									"group/toggle pl-1.5 pr-0 py-0.5 absolute -left-[22px]",
									{
										"absolute -left-[18px]": depth === 0,
									},
								)}
							>
								<div
									className={cn(
										"rounded p-0.5 text-white/65",
										!isDragging && "group-hover/toggle:text-white",
									)}
								>
									<ChevronRight
										className={cn(
											"size-2.5 transition-transform",
											!item.isCollapsed && "rotate-90",
										)}
									/>
								</div>
							</span>
						) : null}
						<span
							data-testid={`canvas-sidebar-node-icon-${item.node.id}`}
							className="canvas-sidebar-node-icon ml-1.5 mr-2"
							aria-hidden="true"
						>
							{resolveCanvasNodeTypeIcon(item.node.type)}
						</span>
						<div className="truncate text-xs font-medium">{item.node.name}</div>
					</div>
				</div>
			</div>
		</button>
	);
};

const NodeList: React.FC<NodeListProps> = ({
	nodes,
	activeNodeId,
	selectedNodeIds,
	disabled,
	onDraggingChange,
	onNodeSelect,
	onNodeReorder,
}) => {
	const listRef = useRef<HTMLDivElement | null>(null);
	const autoExpandTimerRef = useRef<number | null>(null);
	const pointerRef = useRef<{ x: number; y: number } | null>(null);
	const dragStateRef = useRef<NodeListDragState | null>(null);
	const [collapsedFrameIds, setCollapsedFrameIds] = useState<Set<string>>(
		new Set(),
	);
	const [dragState, setDragState] = useState<NodeListDragState | null>(null);
	const [globalDropLineTop, setGlobalDropLineTop] = useState<number | null>(
		null,
	);
	const empty = nodes.length === 0;
	const nodeById = useMemo(() => {
		return new Map(nodes.map((node) => [node.id, node]));
	}, [nodes]);
	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodeIds);
	}, [selectedNodeIds]);

	const nestedItems = useMemo(() => {
		return buildNestedNodeItems(nodes, collapsedFrameIds);
	}, [collapsedFrameIds, nodes]);

	useEffect(() => {
		dragStateRef.current = dragState;
	}, [dragState]);

	useEffect(() => {
		if (collapsedFrameIds.size === 0) return;
		const frameIdSet = new Set(
			nodes.filter((node) => node.type === "frame").map((node) => node.id),
		);
		setCollapsedFrameIds((prev) => {
			const next = new Set<string>();
			for (const nodeId of prev) {
				if (frameIdSet.has(nodeId)) {
					next.add(nodeId);
				}
			}
			if (next.size === prev.size) return prev;
			return next;
		});
	}, [collapsedFrameIds.size, nodes]);

	const clearAutoExpandTimer = useCallback(() => {
		if (autoExpandTimerRef.current === null) return;
		window.clearTimeout(autoExpandTimerRef.current);
		autoExpandTimerRef.current = null;
	}, []);

	useEffect(() => {
		return () => {
			clearAutoExpandTimer();
		};
	}, [clearAutoExpandTimer]);

	useEffect(() => {
		return () => {
			onDraggingChange?.(false);
		};
	}, [onDraggingChange]);

	const resolveGlobalDropLineTop = useCallback(
		(overIntent: DropIntent | null): number | null => {
			const container = listRef.current;
			if (!container) return null;
			return resolveDropLineTop({
				overIntent,
				container,
				rowLayouts: collectNodeRowLayouts(container),
			});
		},
		[],
	);

	useLayoutEffect(() => {
		if (disabled || !dragState?.overIntent) {
			setGlobalDropLineTop(null);
			return;
		}
		setGlobalDropLineTop(resolveGlobalDropLineTop(dragState.overIntent));
	}, [disabled, dragState?.overIntent, resolveGlobalDropLineTop]);

	useEffect(() => {
		if (!dragState) return;
		let frameHandle = 0;
		const tick = () => {
			const container = listRef.current;
			const pointer = pointerRef.current;
			if (container && pointer) {
				const rect = container.getBoundingClientRect();
				const topDistance = pointer.y - rect.top;
				const bottomDistance = rect.bottom - pointer.y;
				let delta = 0;
				if (topDistance >= 0 && topDistance < AUTO_SCROLL_EDGE_PX) {
					const ratio =
						(AUTO_SCROLL_EDGE_PX - topDistance) / AUTO_SCROLL_EDGE_PX;
					delta = -AUTO_SCROLL_MAX_SPEED * ratio;
				} else if (
					bottomDistance >= 0 &&
					bottomDistance < AUTO_SCROLL_EDGE_PX
				) {
					const ratio =
						(AUTO_SCROLL_EDGE_PX - bottomDistance) / AUTO_SCROLL_EDGE_PX;
					delta = AUTO_SCROLL_MAX_SPEED * ratio;
				}
				if (delta !== 0) {
					container.scrollTop += delta;
				}
				const currentIntent = dragStateRef.current?.overIntent ?? null;
				if (currentIntent) {
					setGlobalDropLineTop(resolveGlobalDropLineTop(currentIntent));
				}
			}
			frameHandle = window.requestAnimationFrame(tick);
		};
		frameHandle = window.requestAnimationFrame(tick);
		return () => {
			window.cancelAnimationFrame(frameHandle);
		};
	}, [dragState, resolveGlobalDropLineTop]);

	const toggleCollapse = useCallback((nodeId: string) => {
		setCollapsedFrameIds((prev) => {
			const next = new Set(prev);
			if (next.has(nodeId)) {
				next.delete(nodeId);
			} else {
				next.add(nodeId);
			}
			return next;
		});
	}, []);

	const resolveOverIntentFromPointer = useCallback(
		(
			clientX: number,
			clientY: number,
			dragNodeIds: string[],
		): DropIntent | null => {
			const container = listRef.current;
			if (!container) return null;
			const containerRect = container.getBoundingClientRect();
			if (
				clientX < containerRect.left ||
				clientX > containerRect.right ||
				clientY < containerRect.top ||
				clientY > containerRect.bottom
			) {
				return null;
			}
			return resolveDropIntentFromLayouts({
				clientY,
				containerRect,
				rowLayouts: collectNodeRowLayouts(container),
				previousIntent: dragStateRef.current?.overIntent ?? null,
				dragNodeIds,
				nodeById,
			});
		},
		[nodeById],
	);

	const scheduleAutoExpand = useCallback(
		(nextIntent: DropIntent | null) => {
			clearAutoExpandTimer();
			if (
				nextIntent?.targetNodeId &&
				nextIntent.position === "inside" &&
				collapsedFrameIds.has(nextIntent.targetNodeId)
			) {
				autoExpandTimerRef.current = window.setTimeout(() => {
					setCollapsedFrameIds((prev) => {
						if (!prev.has(nextIntent.targetNodeId as string)) return prev;
						const next = new Set(prev);
						next.delete(nextIntent.targetNodeId as string);
						return next;
					});
				}, AUTO_EXPAND_DELAY_MS);
			}
		},
		[clearAutoExpandTimer, collapsedFrameIds],
	);

	const clearDragState = useCallback(() => {
		clearAutoExpandTimer();
		pointerRef.current = null;
		dragStateRef.current = null;
		setDragState(null);
		setGlobalDropLineTop(null);
		onDraggingChange?.(false);
	}, [clearAutoExpandTimer, onDraggingChange]);

	const handleRowDragStart = useCallback(
		(activeNode: CanvasNode, clientX: number, clientY: number): boolean => {
			if (disabled || !onNodeReorder) return false;
			const activeNodeId = activeNode.id;
			const isSelected = selectedNodeIdSet.has(activeNodeId);
			const candidateNodeIds = isSelected ? selectedNodeIds : [activeNodeId];
			if (!isSelected) {
				onNodeSelect(activeNode, { toggle: false });
			}
			const dragNodeIds = resolveRootDragNodeIds(nodes, candidateNodeIds);
			if (dragNodeIds.length === 0) return false;
			pointerRef.current = { x: clientX, y: clientY };
			const initialIntent = resolveOverIntentFromPointer(
				clientX,
				clientY,
				dragNodeIds,
			);
			scheduleAutoExpand(initialIntent);
			onDraggingChange?.(true);
			const nextState: NodeListDragState = {
				dragNodeIds,
				overIntent: initialIntent,
			};
			dragStateRef.current = nextState;
			setDragState(nextState);
			return true;
		},
		[
			disabled,
			nodes,
			onNodeReorder,
			onNodeSelect,
			onDraggingChange,
			resolveOverIntentFromPointer,
			scheduleAutoExpand,
			selectedNodeIdSet,
			selectedNodeIds,
		],
	);

	const handleRowDragMove = useCallback(
		(clientX: number, clientY: number) => {
			const currentDragState = dragStateRef.current;
			if (!currentDragState) return;
			pointerRef.current = { x: clientX, y: clientY };
			const nextIntent = resolveOverIntentFromPointer(
				clientX,
				clientY,
				currentDragState.dragNodeIds,
			);
			scheduleAutoExpand(nextIntent);
			setDragState((prev) => {
				if (!prev) return prev;
				if (isSameDropIntent(prev.overIntent, nextIntent)) {
					return prev;
				}
				const nextState = {
					...prev,
					overIntent: nextIntent,
				};
				dragStateRef.current = nextState;
				return nextState;
			});
		},
		[resolveOverIntentFromPointer, scheduleAutoExpand],
	);

	const handleRowDragEnd = useCallback(() => {
		const currentDragState = dragStateRef.current;
		if (currentDragState?.overIntent && onNodeReorder) {
			onNodeReorder({
				dragNodeIds: currentDragState.dragNodeIds,
				targetNodeId: currentDragState.overIntent.targetNodeId,
				position: currentDragState.overIntent.position,
			});
		}
		clearDragState();
	}, [clearDragState, onNodeReorder]);

	const renderNestedItem = (
		item: NestedNodeItem,
		depth: number,
	): React.ReactNode => {
		const isSelected = selectedNodeIdSet.has(item.node.id);
		const highlightFrameGroup = item.node.type === "frame" && isSelected;
		return (
			<div
				key={item.node.id}
				data-testid={`canvas-sidebar-node-group-${item.node.id}`}
				className="relative"
			>
				<div
					className={cn(
						highlightFrameGroup &&
							"absolute inset-0 inset-y-1 rounded-md bg-mauve-500/10",
					)}
				/>
				<NodeListRow
					item={item}
					depth={depth}
					isActive={item.node.id === activeNodeId}
					isSelected={isSelected}
					isDragging={dragState !== null}
					disabled={disabled || !onNodeReorder}
					overIntent={disabled ? null : (dragState?.overIntent ?? null)}
					onToggleCollapse={toggleCollapse}
					onNodeSelect={onNodeSelect}
					onRowDragStart={handleRowDragStart}
					onRowDragMove={handleRowDragMove}
					onRowDragEnd={handleRowDragEnd}
				/>
				{item.children.length > 0 && !item.isCollapsed && (
					<div className="flex flex-col">
						{item.children.map((child) => renderNestedItem(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="flex min-h-0 h-full flex-col">
			{disabled && (
				<div className="rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
					拖拽 node asset 到时间线（待实现）
				</div>
			)}
			{empty ? (
				<div className="rounded-md border border-white/10 bg-black/20 px-2 py-3 text-center text-xs text-neutral-400">
					暂无节点
				</div>
			) : (
				<div className="relative flex min-h-0 flex-1">
					<div
						ref={listRef}
						data-testid="canvas-sidebar-node-list"
						className="flex min-h-0 flex-1 flex-col overflow-y-auto -m-3 p-3"
					>
						{nestedItems.map((item) => renderNestedItem(item, 0))}
					</div>
					{!disabled &&
						dragState?.overIntent?.position !== "inside" &&
						globalDropLineTop !== null && (
							<div
								className="pointer-events-none absolute inset-x-0 -mt-0.5 z-30 h-0.5 rounded bg-white"
								style={{ top: globalDropLineTop }}
							/>
						)}
				</div>
			)}
		</div>
	);
};

const CanvasSidebar: React.FC<CanvasSidebarProps> = ({
	mode,
	nodes,
	activeNodeId,
	selectedNodeIds,
	activeTab,
	onTabChange,
	onNodeSelect,
	onNodeReorder,
	onCollapse,
}) => {
	const [isNodeListDragging, setIsNodeListDragging] = useState(false);
	const showTabs = mode === "focus";
	const nodeTabDisabled = mode === "focus" && activeTab === "nodes";
	const visibleTab = showTabs ? activeTab : "nodes";
	const title = useMemo(() => {
		if (!showTabs) return "Node 导航";
		return visibleTab === "element" ? "元素组件" : "Node 导航";
	}, [showTabs, visibleTab]);

	return (
		<div
			data-testid="canvas-sidebar"
			className="flex h-full min-h-0 w-full flex-col overflow-hidden ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
		>
			<div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
				<div className="text-xs font-medium text-white/90">{title}</div>
				{onCollapse && (
					<button
						type="button"
						aria-label="收起侧边栏"
						onClick={onCollapse}
						className={cn(
							"rounded bg-white/10 px-2 py-1 text-[11px] text-white/90",
							!isNodeListDragging && "hover:bg-white/20",
						)}
					>
						收起
					</button>
				)}
			</div>
			{showTabs && (
				<div className="border-b border-white/10 px-3 py-2">
					<div className="flex rounded-md bg-black/30 p-1">
						<button
							type="button"
							data-testid="canvas-sidebar-tab-nodes"
							onClick={() => onTabChange("nodes")}
							className={cn(
								"h-7 flex-1 rounded px-2 text-xs",
								activeTab === "nodes"
									? "bg-white/15 text-white"
									: "text-neutral-300",
								!isNodeListDragging &&
									activeTab !== "nodes" &&
									"hover:text-white",
							)}
						>
							Node
						</button>
						<button
							type="button"
							data-testid="canvas-sidebar-tab-element"
							onClick={() => onTabChange("element")}
							className={cn(
								"h-7 flex-1 rounded px-2 text-xs",
								activeTab === "element"
									? "bg-white/15 text-white"
									: "text-neutral-300",
								!isNodeListDragging &&
									activeTab !== "element" &&
									"hover:text-white",
							)}
						>
							Element
						</button>
					</div>
				</div>
			)}
			<div className="min-h-0 flex-1 p-3">
				{visibleTab === "nodes" ? (
					<NodeList
						nodes={nodes}
						activeNodeId={activeNodeId}
						selectedNodeIds={selectedNodeIds}
						disabled={nodeTabDisabled}
						onDraggingChange={setIsNodeListDragging}
						onNodeSelect={onNodeSelect}
						onNodeReorder={onNodeReorder}
					/>
				) : (
					<div className="min-h-0 h-full overflow-y-auto">
						<CanvasElementLibrary />
					</div>
				)}
			</div>
		</div>
	);
};

export default CanvasSidebar;
