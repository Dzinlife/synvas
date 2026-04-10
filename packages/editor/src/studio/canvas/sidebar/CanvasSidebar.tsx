import type { CanvasNode } from "core/studio/types";
import type React from "react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import CanvasElementLibrary from "./CanvasElementLibrary";

export type CanvasSidebarMode = "canvas" | "focus";
export type CanvasSidebarTab = "nodes" | "element";

interface CanvasSidebarProps {
	mode: CanvasSidebarMode;
	nodes: CanvasNode[];
	activeNodeId: string | null;
	activeTab: CanvasSidebarTab;
	onTabChange: (tab: CanvasSidebarTab) => void;
	onNodeSelect: (node: CanvasNode) => void;
	onCollapse?: () => void;
}

const NODE_TYPE_LABEL: Record<CanvasNode["type"], string> = {
	scene: "Scene",
	video: "Video",
	audio: "Audio",
	image: "Image",
	text: "Text",
	frame: "Frame",
};

interface NodeListProps {
	nodes: CanvasNode[];
	activeNodeId: string | null;
	disabled: boolean;
	onNodeSelect: (node: CanvasNode) => void;
}

interface FlattenedNodeItem {
	node: CanvasNode;
	depth: number;
}

const buildFlattenedNodeItems = (nodes: CanvasNode[]): FlattenedNodeItem[] => {
	if (nodes.length === 0) return [];
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const childrenByParentId = new Map<string | null, string[]>();
	for (const node of nodes) {
		const rawParentId = node.parentId ?? null;
		const parentNode = rawParentId ? nodeById.get(rawParentId) : null;
		const parentId = parentNode?.type === "frame" ? parentNode.id : null;
		const existing = childrenByParentId.get(parentId) ?? [];
		existing.push(node.id);
		childrenByParentId.set(parentId, existing);
	}

	const flattenedItems: FlattenedNodeItem[] = [];
	const visited = new Set<string>();
	const visit = (parentId: string | null, depth: number) => {
		const childNodeIds = childrenByParentId.get(parentId) ?? [];
		for (const childNodeId of childNodeIds) {
			if (visited.has(childNodeId)) continue;
			visited.add(childNodeId);
			const node = nodeById.get(childNodeId);
			if (!node) continue;
			flattenedItems.push({
				node,
				depth,
			});
			if (node.type === "frame") {
				visit(node.id, depth + 1);
			}
		}
	};
	visit(null, 0);
	for (const node of nodes) {
		if (visited.has(node.id)) continue;
		flattenedItems.push({
			node,
			depth: 0,
		});
	}
	return flattenedItems;
};

const NodeList: React.FC<NodeListProps> = ({
	nodes,
	activeNodeId,
	disabled,
	onNodeSelect,
}) => {
	const empty = nodes.length === 0;
	const flattenedItems = useMemo(() => {
		return buildFlattenedNodeItems(nodes);
	}, [nodes]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
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
					data-testid="canvas-sidebar-node-list"
					className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
				>
					{flattenedItems.map(({ node, depth }) => {
						const isActive = node.id === activeNodeId;
						return (
							<button
								key={node.id}
								type="button"
								data-testid={`canvas-sidebar-node-item-${node.id}`}
								data-node-id={node.id}
								onClick={() => onNodeSelect(node)}
								disabled={disabled}
								aria-disabled={disabled}
								className={cn(
									"w-full rounded-md border px-2 py-1.5 text-left transition-colors",
									isActive
										? "border-blue-300/60 bg-blue-500/20 text-white"
										: "border-white/10 bg-black/20 text-white/90 hover:bg-white/10",
									disabled && "cursor-not-allowed opacity-60 hover:bg-black/20",
								)}
								style={{
									paddingLeft: `${8 + depth * 16}px`,
								}}
							>
								<div className="flex items-center justify-between gap-2">
									<div className="truncate text-xs font-medium">
										{node.name}
									</div>
									<div className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
										{NODE_TYPE_LABEL[node.type]}
									</div>
								</div>
								<div className="mt-1 flex items-center gap-1">
									{node.hidden && (
										<span className="rounded bg-neutral-700/60 px-1.5 py-0.5 text-[10px] text-neutral-200">
											隐藏
										</span>
									)}
									{node.locked && (
										<span className="rounded bg-amber-700/50 px-1.5 py-0.5 text-[10px] text-amber-100">
											锁定
										</span>
									)}
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
};

const CanvasSidebar: React.FC<CanvasSidebarProps> = ({
	mode,
	nodes,
	activeNodeId,
	activeTab,
	onTabChange,
	onNodeSelect,
	onCollapse,
}) => {
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
			className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl [corner-shape:superellipse(1.2)] ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
		>
			<div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
				<div className="text-xs font-medium text-white/90">{title}</div>
				{onCollapse && (
					<button
						type="button"
						aria-label="收起侧边栏"
						onClick={onCollapse}
						className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/90 hover:bg-white/20"
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
									: "text-neutral-300 hover:text-white",
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
									: "text-neutral-300 hover:text-white",
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
						disabled={nodeTabDisabled}
						onNodeSelect={onNodeSelect}
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
