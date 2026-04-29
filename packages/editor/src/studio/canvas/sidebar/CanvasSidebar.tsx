import { useDrag } from "@use-gesture/react";
import type { TimelineAsset } from "core/timeline-system/types";
import {
	ChevronRight,
	FileImage,
	FileQuestionMark,
	Music2,
	Plus,
	VideoIcon,
} from "lucide-react";
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
import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import {
	buildLayerTreeOrder,
	compareSiblingOrderDesc,
} from "@/studio/canvas/layerOrderCoordinator";
import type { CanvasNode } from "@/studio/project/types";
import { resolveCanvasNodeTypeIcon } from "../canvasNodeIconLabel";

export type CanvasSidebarMode = "canvas" | "focus";

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
	assets?: TimelineAsset[];
	projectId?: string | null;
	activeNodeId: string | null;
	selectedNodeIds: string[];
	onNodeSelect: (
		node: CanvasNode,
		options?: CanvasSidebarNodeSelectOptions,
	) => void;
	onNodeReorder?: (request: CanvasSidebarNodeReorderRequest) => void;
	onAssetCreateNode?: (asset: TimelineAsset) => void;
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

type CanvasSidebarTab = "nodes" | "assets";
type ReusableAssetKind = Extract<
	TimelineAsset["kind"],
	"image" | "video" | "audio"
>;

interface AssetListProps {
	assets: TimelineAsset[];
	projectId?: string | null;
	disabled: boolean;
	onAssetCreateNode?: (asset: TimelineAsset) => void;
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

interface VirtualNodeRow {
	item: NestedNodeItem;
	depth: number;
	index: number;
}

interface ResolveDropIntentFromVirtualRowsOptions {
	clientY: number;
	containerRect: DOMRect;
	scrollTop: number;
	rows: VirtualNodeRow[];
	previousIntent: DropIntent | null;
	dragNodeIds: string[];
	nodeById: Map<string, CanvasNode>;
}

interface ResolveDropLineTopOptions {
	overIntent: DropIntent | null;
	scrollContainer: HTMLElement;
	positioningContainer: HTMLElement;
	rowByNodeId: Map<string, VirtualNodeRow>;
	rowCount: number;
}

const ROW_INSIDE_TOP_RATIO = 0.25;
const ROW_INSIDE_BOTTOM_RATIO = 0.75;
const AUTO_EXPAND_DELAY_MS = 500;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_SPEED = 14;
const ROOT_DROP_EDGE_PX = 18;
const INTENT_HYSTERESIS_PX = 2;
const ROW_BOUNDARY_HYSTERESIS_PX = 4;
const NODE_ROW_INDENT_PX = 21;
const NODE_ROW_HEIGHT_PX = 36;
const NODE_LIST_PADDING_PX = 12;
const VIRTUAL_OVERSCAN_ROWS = 8;

const ASSET_KIND_LABELS: Record<TimelineAsset["kind"], string> = {
	video: "Video",
	audio: "Audio",
	image: "Image",
	lottie: "Lottie",
	unknown: "Unknown",
};

const REUSABLE_ASSET_KIND_SET = new Set<TimelineAsset["kind"]>([
	"image",
	"video",
	"audio",
]);

const isReusableAssetKind = (
	kind: TimelineAsset["kind"],
): kind is ReusableAssetKind => REUSABLE_ASSET_KIND_SET.has(kind);

const resolveAssetKindIcon = (kind: TimelineAsset["kind"]) => {
	if (kind === "image") return FileImage;
	if (kind === "video") return VideoIcon;
	if (kind === "audio") return Music2;
	return FileQuestionMark;
};

const resolveShortAssetLocatorLabel = (
	asset: TimelineAsset,
	projectId?: string | null,
): string => {
	const label = resolveAssetDisplayLabel(asset, { projectId }) ?? "";
	const normalized = label.replace(/\\/g, "/");
	const chunks = normalized.split("/").filter(Boolean);
	return chunks[chunks.length - 1] ?? label;
};

const isSameDropIntent = (
	left: DropIntent | null,
	right: DropIntent | null,
): boolean => {
	return (
		left?.targetNodeId === right?.targetNodeId &&
		left?.position === right?.position
	);
};

const resolveDropLineTop = ({
	overIntent,
	scrollContainer,
	positioningContainer,
	rowByNodeId,
	rowCount,
}: ResolveDropLineTopOptions): number | null => {
	if (!overIntent || overIntent.position === "inside") return null;
	const clampLineTop = (value: number): number => {
		const viewportHeight =
			positioningContainer.clientHeight ||
			positioningContainer.getBoundingClientRect().height;
		const maxTop = Math.max(viewportHeight - 1, 0);
		return Math.max(0, Math.min(Math.round(value), maxTop));
	};
	const scrollRect = scrollContainer.getBoundingClientRect();
	const positioningRect = positioningContainer.getBoundingClientRect();
	const viewportOffsetTop = scrollRect.top - positioningRect.top;
	const resolveViewportTop = (contentY: number): number => {
		return contentY - scrollContainer.scrollTop + viewportOffsetTop;
	};
	if (!overIntent.targetNodeId) {
		if (overIntent.position === "before") return 0;
		return clampLineTop(
			resolveViewportTop(NODE_LIST_PADDING_PX + rowCount * NODE_ROW_HEIGHT_PX),
		);
	}
	const targetRow = rowByNodeId.get(overIntent.targetNodeId);
	if (!targetRow) return null;
	const targetTop = NODE_LIST_PADDING_PX + targetRow.index * NODE_ROW_HEIGHT_PX;
	const boundaryY =
		overIntent.position === "before"
			? targetTop
			: targetTop + NODE_ROW_HEIGHT_PX;
	return clampLineTop(resolveViewportTop(boundaryY));
};

const resolveDropIntentFromVirtualRows = ({
	clientY,
	containerRect,
	scrollTop,
	rows,
	previousIntent,
	dragNodeIds,
	nodeById,
}: ResolveDropIntentFromVirtualRowsOptions): DropIntent | null => {
	if (rows.length === 0) return null;
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
	const contentY =
		clientY - containerRect.top + scrollTop - NODE_LIST_PADDING_PX;
	const listHeight = rows.length * NODE_ROW_HEIGHT_PX;
	if (contentY < 0) {
		return {
			targetNodeId: null,
			position: "before",
		};
	}
	if (contentY > listHeight) {
		return {
			targetNodeId: null,
			position: "after",
		};
	}
	const boundaryIndex = Math.round(contentY / NODE_ROW_HEIGHT_PX);
	if (boundaryIndex > 0 && boundaryIndex < rows.length) {
		const boundaryY = boundaryIndex * NODE_ROW_HEIGHT_PX;
		const currentRow = rows[boundaryIndex - 1];
		const nextRow = rows[boundaryIndex];
		if (
			currentRow &&
			nextRow &&
			Math.abs(contentY - boundaryY) <= ROW_BOUNDARY_HYSTERESIS_PX
		) {
			const currentNodeId = currentRow.item.node.id;
			const nextNodeId = nextRow.item.node.id;
			const shouldKeepCurrentAfter =
				previousIntent?.targetNodeId === currentNodeId &&
				previousIntent.position === "after";
			if (shouldKeepCurrentAfter) {
				const keepIntent = resolveSiblingIntentIfAllowed(
					currentNodeId,
					"after",
				);
				if (keepIntent) return keepIntent;
			}
			const shouldKeepNextBefore =
				previousIntent?.targetNodeId === nextNodeId &&
				previousIntent.position === "before";
			if (shouldKeepNextBefore) {
				const keepIntent = resolveSiblingIntentIfAllowed(nextNodeId, "before");
				if (keepIntent) return keepIntent;
			}
			const stableIntent = resolveSiblingIntentIfAllowed(
				currentNodeId,
				"after",
			);
			if (stableIntent) return stableIntent;
			const fallbackIntent = resolveSiblingIntentIfAllowed(
				nextNodeId,
				"before",
			);
			if (fallbackIntent) return fallbackIntent;
		}
	}
	const targetIndex = Math.min(
		rows.length - 1,
		Math.max(0, Math.floor(contentY / NODE_ROW_HEIGHT_PX)),
	);
	const targetRow = rows[targetIndex];
	if (!targetRow) return null;
	const targetNodeId = targetRow.item.node.id;
	if (isNodeInsideDragSubtree(targetNodeId, dragNodeIds, nodeById)) {
		return null;
	}
	const targetNode = nodeById.get(targetNodeId);
	if (!targetNode) return null;
	const relativeY = contentY - targetIndex * NODE_ROW_HEIGHT_PX;
	const clampedRatio = Math.max(0, Math.min(1, relativeY / NODE_ROW_HEIGHT_PX));
	if (targetNode.type === "board") {
		const beforeBoundaryY = NODE_ROW_HEIGHT_PX * ROW_INSIDE_TOP_RATIO;
		const afterBoundaryY = NODE_ROW_HEIGHT_PX * ROW_INSIDE_BOTTOM_RATIO;
		const canKeepBeforeOrInside =
			previousIntent?.targetNodeId === targetNodeId &&
			(previousIntent.position === "before" ||
				previousIntent.position === "inside") &&
			Math.abs(relativeY - beforeBoundaryY) <= INTENT_HYSTERESIS_PX;
		if (canKeepBeforeOrInside) {
			return {
				targetNodeId,
				position: previousIntent.position,
			};
		}
		const canKeepInsideOrAfter =
			previousIntent?.targetNodeId === targetNodeId &&
			(previousIntent.position === "inside" ||
				previousIntent.position === "after") &&
			Math.abs(relativeY - afterBoundaryY) <= INTENT_HYSTERESIS_PX;
		if (canKeepInsideOrAfter) {
			return {
				targetNodeId,
				position: previousIntent.position,
			};
		}
		if (clampedRatio < ROW_INSIDE_TOP_RATIO) {
			return {
				targetNodeId,
				position: "before",
			};
		}
		if (clampedRatio > ROW_INSIDE_BOTTOM_RATIO) {
			return {
				targetNodeId,
				position: "after",
			};
		}
		return {
			targetNodeId,
			position: "inside",
		};
	}
	const middleBoundaryY = NODE_ROW_HEIGHT_PX * 0.5;
	const canKeepBeforeOrAfter =
		previousIntent?.targetNodeId === targetNodeId &&
		(previousIntent.position === "before" ||
			previousIntent.position === "after") &&
		Math.abs(relativeY - middleBoundaryY) <= INTENT_HYSTERESIS_PX;
	if (canKeepBeforeOrAfter) {
		return {
			targetNodeId,
			position: previousIntent.position,
		};
	}
	return {
		targetNodeId,
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
	if (!parent || parent.type !== "board") return null;
	return parent.id;
};

const buildNestedNodeItems = (
	nodes: CanvasNode[],
	collapsedBoardIds: Set<string>,
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
			const isCollapsed = collapsedBoardIds.has(childNode.id);
			const hasChildren =
				childNode.type === "board" &&
				(childrenByParentId.get(childNode.id)?.length ?? 0) > 0;
			const nextChildren =
				childNode.type === "board" && hasChildren ? visit(childNode.id) : [];
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
		const isCollapsed = collapsedBoardIds.has(node.id);
		const hasChildren =
			node.type === "board" &&
			(childrenByParentId.get(node.id)?.length ?? 0) > 0;
		const nextChildren =
			node.type === "board" && hasChildren ? visit(node.id) : [];
		items.push({
			node,
			children: !isCollapsed ? nextChildren : [],
			isCollapsed,
			hasChildren,
		});
	}
	return items;
};

const flattenNestedNodeItems = (
	items: NestedNodeItem[],
	depth = 0,
	rows: VirtualNodeRow[] = [],
): VirtualNodeRow[] => {
	for (const item of items) {
		rows.push({
			item,
			depth,
			index: rows.length,
		});
		if (item.children.length > 0 && !item.isCollapsed) {
			flattenNestedNodeItems(item.children, depth + 1, rows);
		}
	}
	return rows;
};

const resolveVirtualViewportHeight = (container: HTMLElement): number => {
	return container.clientHeight || container.getBoundingClientRect().height;
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
				"group relative w-full touch-none py-1 text-left",
				!disabled && "cursor-pointer",
				disabled && "cursor-not-allowed",
			)}
			data-testid={`canvas-sidebar-node-item-${item.node.id}`}
			data-node-id={item.node.id}
			data-node-row-container="true"
			disabled={disabled}
			style={{ height: NODE_ROW_HEIGHT_PX }}
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
						item.node.type === "board" &&
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
						{item.node.type === "board" && item.hasChildren ? (
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
	const dropLineContainerRef = useRef<HTMLDivElement | null>(null);
	const autoExpandTimerRef = useRef<number | null>(null);
	const pointerRef = useRef<{ x: number; y: number } | null>(null);
	const dragStateRef = useRef<NodeListDragState | null>(null);
	const [collapsedBoardIds, setCollapsedBoardIds] = useState<Set<string>>(
		new Set(),
	);
	const [dragState, setDragState] = useState<NodeListDragState | null>(null);
	const [globalDropLineTop, setGlobalDropLineTop] = useState<number | null>(
		null,
	);
	const [virtualViewport, setVirtualViewport] = useState({
		scrollTop: 0,
		viewportHeight: 0,
	});
	const empty = nodes.length === 0;
	const nodeById = useMemo(() => {
		return new Map(nodes.map((node) => [node.id, node]));
	}, [nodes]);
	const selectedNodeIdSet = useMemo(() => {
		return new Set(selectedNodeIds);
	}, [selectedNodeIds]);

	const nestedItems = useMemo(() => {
		return buildNestedNodeItems(nodes, collapsedBoardIds);
	}, [collapsedBoardIds, nodes]);
	const flattenedRows = useMemo(() => {
		return flattenNestedNodeItems(nestedItems);
	}, [nestedItems]);
	const rowByNodeId = useMemo(() => {
		return new Map(
			flattenedRows.map((row) => [row.item.node.id, row] as const),
		);
	}, [flattenedRows]);
	const virtualTotalHeight =
		NODE_LIST_PADDING_PX * 2 + flattenedRows.length * NODE_ROW_HEIGHT_PX;
	const rawVirtualStartIndex = Math.max(
		0,
		Math.floor(
			(virtualViewport.scrollTop - NODE_LIST_PADDING_PX) / NODE_ROW_HEIGHT_PX,
		) - VIRTUAL_OVERSCAN_ROWS,
	);
	const virtualStartIndex = Math.min(
		flattenedRows.length,
		rawVirtualStartIndex,
	);
	const virtualEndIndex = Math.max(
		virtualStartIndex,
		Math.min(
			flattenedRows.length,
			Math.ceil(
				(virtualViewport.scrollTop +
					virtualViewport.viewportHeight -
					NODE_LIST_PADDING_PX) /
					NODE_ROW_HEIGHT_PX,
			) + VIRTUAL_OVERSCAN_ROWS,
		),
	);
	const virtualRows = flattenedRows.slice(virtualStartIndex, virtualEndIndex);

	const syncVirtualViewport = useCallback(
		(container: HTMLElement | null = listRef.current) => {
			if (!container) return;
			const viewportHeight = resolveVirtualViewportHeight(container);
			const scrollTop = container.scrollTop;
			setVirtualViewport((prev) => {
				if (
					prev.scrollTop === scrollTop &&
					prev.viewportHeight === viewportHeight
				) {
					return prev;
				}
				return {
					scrollTop,
					viewportHeight,
				};
			});
		},
		[],
	);

	useLayoutEffect(() => {
		const container = listRef.current;
		if (!container) return;
		syncVirtualViewport(container);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			syncVirtualViewport(container);
		});
		observer.observe(container);
		return () => {
			observer.disconnect();
		};
	}, [syncVirtualViewport]);

	useEffect(() => {
		dragStateRef.current = dragState;
	}, [dragState]);

	useEffect(() => {
		if (collapsedBoardIds.size === 0) return;
		const boardIdSet = new Set(
			nodes.filter((node) => node.type === "board").map((node) => node.id),
		);
		setCollapsedBoardIds((prev) => {
			const next = new Set<string>();
			for (const nodeId of prev) {
				if (boardIdSet.has(nodeId)) {
					next.add(nodeId);
				}
			}
			if (next.size === prev.size) return prev;
			return next;
		});
	}, [collapsedBoardIds.size, nodes]);

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
			const positioningContainer = dropLineContainerRef.current;
			if (!container || !positioningContainer) return null;
			return resolveDropLineTop({
				overIntent,
				scrollContainer: container,
				positioningContainer,
				rowByNodeId,
				rowCount: flattenedRows.length,
			});
		},
		[flattenedRows.length, rowByNodeId],
	);

	useLayoutEffect(() => {
		if (disabled || !dragState?.overIntent) {
			setGlobalDropLineTop(null);
			return;
		}
		setGlobalDropLineTop(resolveGlobalDropLineTop(dragState.overIntent));
	}, [disabled, dragState?.overIntent, resolveGlobalDropLineTop]);

	const toggleCollapse = useCallback((nodeId: string) => {
		setCollapsedBoardIds((prev) => {
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
			return resolveDropIntentFromVirtualRows({
				clientY,
				containerRect,
				scrollTop: container.scrollTop,
				rows: flattenedRows,
				previousIntent: dragStateRef.current?.overIntent ?? null,
				dragNodeIds,
				nodeById,
			});
		},
		[flattenedRows, nodeById],
	);

	const scheduleAutoExpand = useCallback(
		(nextIntent: DropIntent | null) => {
			clearAutoExpandTimer();
			if (
				nextIntent?.targetNodeId &&
				nextIntent.position === "inside" &&
				collapsedBoardIds.has(nextIntent.targetNodeId)
			) {
				autoExpandTimerRef.current = window.setTimeout(() => {
					setCollapsedBoardIds((prev) => {
						if (!prev.has(nextIntent.targetNodeId as string)) return prev;
						const next = new Set(prev);
						next.delete(nextIntent.targetNodeId as string);
						return next;
					});
				}, AUTO_EXPAND_DELAY_MS);
			}
		},
		[clearAutoExpandTimer, collapsedBoardIds],
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

	const updateDragOverIntent = useCallback((nextIntent: DropIntent | null) => {
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
	}, []);

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
			updateDragOverIntent(nextIntent);
		},
		[resolveOverIntentFromPointer, scheduleAutoExpand, updateDragOverIntent],
	);

	useEffect(() => {
		if (!dragState) return;
		let frameHandle = 0;
		const tick = () => {
			const container = listRef.current;
			const pointer = pointerRef.current;
			const currentDragState = dragStateRef.current;
			if (container && pointer && currentDragState) {
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
					syncVirtualViewport(container);
				}
				const nextIntent = resolveOverIntentFromPointer(
					pointer.x,
					pointer.y,
					currentDragState.dragNodeIds,
				);
				scheduleAutoExpand(nextIntent);
				updateDragOverIntent(nextIntent);
				setGlobalDropLineTop(resolveGlobalDropLineTop(nextIntent));
			}
			frameHandle = window.requestAnimationFrame(tick);
		};
		frameHandle = window.requestAnimationFrame(tick);
		return () => {
			window.cancelAnimationFrame(frameHandle);
		};
	}, [
		dragState,
		resolveGlobalDropLineTop,
		resolveOverIntentFromPointer,
		scheduleAutoExpand,
		syncVirtualViewport,
		updateDragOverIntent,
	]);

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

	const renderVirtualRow = (row: VirtualNodeRow): React.ReactNode => {
		const item = row.item;
		const isSelected = selectedNodeIdSet.has(item.node.id);
		const highlightBoardGroup = item.node.type === "board" && isSelected;
		return (
			<div
				key={item.node.id}
				data-testid={`canvas-sidebar-node-group-${item.node.id}`}
				data-virtual-row-index={row.index}
				className="absolute"
				style={{
					top: NODE_LIST_PADDING_PX + row.index * NODE_ROW_HEIGHT_PX,
					left: NODE_LIST_PADDING_PX,
					right: NODE_LIST_PADDING_PX,
					height: NODE_ROW_HEIGHT_PX,
				}}
			>
				<div
					className={cn(
						highlightBoardGroup &&
							"absolute inset-0 inset-y-1 rounded-md bg-mauve-500/10",
					)}
				/>
				<NodeListRow
					item={item}
					depth={row.depth}
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
				<div
					ref={dropLineContainerRef}
					className="relative flex min-h-0 flex-1"
				>
					<div
						ref={listRef}
						data-testid="canvas-sidebar-node-list"
						className="relative min-h-0 flex-1 overflow-y-auto -m-3"
						onScroll={() => {
							syncVirtualViewport();
						}}
					>
						<div
							data-testid="canvas-sidebar-node-virtual-spacer"
							className="relative w-full"
							style={{ height: virtualTotalHeight }}
						>
							{virtualRows.map(renderVirtualRow)}
						</div>
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

const AssetList: React.FC<AssetListProps> = ({
	assets,
	projectId,
	disabled,
	onAssetCreateNode,
}) => {
	if (assets.length === 0) {
		return (
			<div className="rounded-md border border-white/10 bg-black/20 px-2 py-3 text-center text-xs text-neutral-400">
				暂无素材
			</div>
		);
	}

	return (
		<div
			data-testid="canvas-sidebar-asset-list"
			className="-m-3 flex h-full min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
		>
			{assets.map((asset) => {
				const Icon = resolveAssetKindIcon(asset.kind);
				const canCreate =
					isReusableAssetKind(asset.kind) &&
					!disabled &&
					typeof onAssetCreateNode === "function";
				const locatorLabel = resolveShortAssetLocatorLabel(asset, projectId);
				const createFromAsset = () => {
					if (!canCreate) return;
					onAssetCreateNode?.(asset);
				};
				const handleAssetRowClick = (
					event: React.MouseEvent<HTMLButtonElement>,
				) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					if (!target.closest("[data-asset-create-trigger]")) return;
					createFromAsset();
				};
				const handleAssetRowDoubleClick = (
					event: React.MouseEvent<HTMLButtonElement>,
				) => {
					const target = event.target;
					if (
						target instanceof Element &&
						target.closest("[data-asset-create-trigger]")
					) {
						return;
					}
					createFromAsset();
				};
				const handleAssetRowKeyDown = (
					event: React.KeyboardEvent<HTMLButtonElement>,
				) => {
					if (!canCreate) return;
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					createFromAsset();
				};
				return (
					<button
						type="button"
						key={asset.id}
						data-testid={`canvas-sidebar-asset-item-${asset.id}`}
						data-asset-id={asset.id}
						disabled={!canCreate}
						className={cn(
							"group flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
							"bg-transparent text-white/90",
							canCreate && "cursor-pointer hover:bg-white/5",
							!canCreate && "cursor-default",
						)}
						onClick={handleAssetRowClick}
						onDoubleClick={handleAssetRowDoubleClick}
						onKeyDown={handleAssetRowKeyDown}
					>
						<div className="flex size-8 shrink-0 items-center justify-center rounded bg-white/10 text-white/75">
							<Icon className="size-4" aria-hidden="true" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-xs font-medium">{asset.name}</div>
							<div className="flex min-w-0 items-center gap-1 text-[10px] text-white/45">
								<span className="shrink-0">
									{ASSET_KIND_LABELS[asset.kind]}
								</span>
								{locatorLabel ? (
									<>
										<span className="shrink-0">·</span>
										<span className="truncate">{locatorLabel}</span>
									</>
								) : null}
							</div>
						</div>
						<span
							data-asset-create-trigger="true"
							data-testid={`canvas-sidebar-asset-create-${asset.id}`}
							aria-disabled={!canCreate}
							className={cn(
								"flex size-7 shrink-0 items-center justify-center rounded text-white/75 transition",
								canCreate && "bg-white/10 hover:bg-white/20 hover:text-white",
								!canCreate && "cursor-not-allowed bg-white/5 text-white/25",
							)}
						>
							<Plus className="size-3.5" aria-hidden="true" />
						</span>
					</button>
				);
			})}
		</div>
	);
};

const CanvasSidebar: React.FC<CanvasSidebarProps> = ({
	mode,
	nodes,
	assets = [],
	projectId,
	activeNodeId,
	selectedNodeIds,
	onNodeSelect,
	onNodeReorder,
	onAssetCreateNode,
	onCollapse,
}) => {
	const [isNodeListDragging, setIsNodeListDragging] = useState(false);
	const [activeTab, setActiveTab] = useState<CanvasSidebarTab>("nodes");
	const nodeTabDisabled = mode === "focus";
	const assetCreateDisabled = mode === "focus";

	return (
		<div
			data-testid="canvas-sidebar"
			className="flex h-full min-h-0 w-full flex-col overflow-hidden ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
		>
			<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
				<div className="flex min-w-0 items-center rounded bg-white/5 p-0.5">
					<button
						type="button"
						data-testid="canvas-sidebar-tab-nodes"
						aria-pressed={activeTab === "nodes"}
						onClick={() => setActiveTab("nodes")}
						className={cn(
							"rounded px-2 py-1 text-[11px] font-medium transition",
							activeTab === "nodes"
								? "bg-white/15 text-white"
								: "text-white/60 hover:bg-white/10 hover:text-white",
						)}
					>
						Node 导航
					</button>
					<button
						type="button"
						data-testid="canvas-sidebar-tab-assets"
						aria-pressed={activeTab === "assets"}
						onClick={() => setActiveTab("assets")}
						className={cn(
							"rounded px-2 py-1 text-[11px] font-medium transition",
							activeTab === "assets"
								? "bg-white/15 text-white"
								: "text-white/60 hover:bg-white/10 hover:text-white",
						)}
					>
						Assets
					</button>
				</div>
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
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
				{activeTab === "nodes" ? (
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
					<AssetList
						assets={assets}
						projectId={projectId}
						disabled={assetCreateDisabled}
						onAssetCreateNode={onAssetCreateNode}
					/>
				)}
			</div>
		</div>
	);
};

export default CanvasSidebar;
