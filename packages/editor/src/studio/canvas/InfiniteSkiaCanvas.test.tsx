// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import type { StudioProject, VideoCanvasNode } from "core/studio/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { NodeInteractionWrapper } from "./NodeInteractionWrapper";

const { rootRenderSpy } = vi.hoisted(() => ({
	rootRenderSpy: vi.fn(),
}));

vi.mock("@use-gesture/react", () => ({
	useDrag: (handler: (state: Record<string, unknown>) => void) => {
		return () => ({
			onPointerDown: (event: Record<string, unknown>) => {
				const clientX = Number(event.clientX ?? 0);
				const clientY = Number(event.clientY ?? 0);
				handler({
					first: true,
					last: false,
					tap: false,
					movement: [0, 0],
					xy: [clientX, clientY],
					event: {
						button: Number(event.button ?? 0),
						buttons: Number(event.buttons ?? 1),
					},
				});
				handler({
					first: false,
					last: false,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						button: Number(event.button ?? 0),
						buttons: Number(event.buttons ?? 1),
					},
				});
				handler({
					first: false,
					last: true,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						button: Number(event.button ?? 0),
						buttons: 0,
					},
				});
			},
		});
	},
}));

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	const Canvas = ReactModule.forwardRef((_props: unknown, ref) => {
		ReactModule.useImperativeHandle(
			ref,
			() =>
				({
					getRoot: () => ({
						render: rootRenderSpy,
					}),
				}) as unknown,
			[],
		);
		return ReactModule.createElement("div", { "data-testid": "canvas" });
	});
	Canvas.displayName = "MockCanvas";

	return {
		Canvas,
		Group: "group",
		Rect: "rect",
		Path: "path",
		Shader: "shader",
		Skia: {
			RuntimeEffect: {
				Make: () => ({ type: "runtime-effect" }),
			},
		},
	};
});

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useStudioRuntimeManager: () => ({}),
}));

vi.mock("./node-system/registry", () => ({
	getCanvasNodeDefinition: () => ({
		skiaRenderer: () => null,
	}),
}));

type AnyElement = React.ReactElement<Record<string, any>, any>;

const isElement = (node: React.ReactNode): node is AnyElement => {
	return React.isValidElement(node);
};

const collectElements = (
	node: React.ReactNode,
	predicate: (element: AnyElement) => boolean,
): AnyElement[] => {
	const result: AnyElement[] = [];

	const walk = (current: React.ReactNode) => {
		if (!current) return;
		if (Array.isArray(current)) {
			for (const item of current) {
				walk(item);
			}
			return;
		}
		if (!isElement(current)) return;

		if (predicate(current)) {
			result.push(current);
		}
		walk(current.props.children as React.ReactNode);
	};

	walk(node);
	return result;
};

const getLatestRenderTree = (): React.ReactNode => {
	const latestCall = rootRenderSpy.mock.calls.at(-1);
	if (!latestCall) {
		throw new Error("未捕获到 Skia render 调用");
	}
	return latestCall[0] as React.ReactNode;
};

const collectAnchorGroups = (tree: React.ReactNode): AnyElement[] => {
	return collectElements(
		tree,
		(element) =>
			element.type === "group" &&
			Boolean(element.props.hitRect) &&
			typeof element.props.onPointerDown === "function" &&
			collectElements(
				element.props.children as React.ReactNode,
				(child) => child.type === "path",
			).length > 0,
	);
};

const createVideoNode = (
	id: string,
	zIndex: number,
	patch: Partial<VideoCanvasNode> = {},
): VideoCanvasNode => ({
	id,
	type: "video",
	name: id,
	x: 20,
	y: 30,
	width: 160,
	height: 90,
	zIndex,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: `${id}-asset`,
	...patch,
});

const emptyScenes: StudioProject["scenes"] = {};

describe("InfiniteSkiaCanvas", () => {
	beforeEach(() => {
		rootRenderSpy.mockReset();
	});

	it("active 边框会在 overlay 顶层渲染并关闭主通道描边", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 2 }}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const wrappers = collectElements(
			tree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const activeWrapper = wrappers.find(
			(element) => element.props.node.id === "node-a",
		);
		const otherWrapper = wrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(activeWrapper?.props.cameraZoom).toBe(2);
		expect(activeWrapper?.props.showBorder).toBe(false);
		expect(otherWrapper?.props.showBorder).toBe(true);

		const overlayGroup = collectElements(
			tree,
			(element) =>
				element.type === "group" &&
				element.props.pointerEvents === "none" &&
				element.props.zIndex === 1_000_000,
		)[0];
		expect(overlayGroup).toBeTruthy();

		const overlayRects = collectElements(
			overlayGroup,
			(element) => element.type === "rect" && element.props.style === "stroke",
		);
		expect(overlayRects).toHaveLength(1);
		expect(overlayRects[0]?.props.strokeWidth).toBe(1);
		expect(overlayRects[0]?.props.color).toBe("rgba(251,146,60,1)");
	});

	it("hover 与 active 会共同进入 overlay 且线宽按 zoom 补偿", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 0.5 }}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const wrappers = collectElements(
			tree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const hoveredWrapper = wrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(hoveredWrapper).toBeTruthy();

		act(() => {
			hoveredWrapper?.props.onPointerEnter("node-b");
		});

		const updatedTree = getLatestRenderTree();
		const updatedWrappers = collectElements(
			updatedTree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const activeWrapper = updatedWrappers.find(
			(element) => element.props.node.id === "node-a",
		);
		const hoverWrapper = updatedWrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(activeWrapper?.props.showBorder).toBe(false);
		expect(hoverWrapper?.props.showBorder).toBe(false);

		const overlayGroup = collectElements(
			updatedTree,
			(element) =>
				element.type === "group" &&
				element.props.pointerEvents === "none" &&
				element.props.zIndex === 1_000_000,
		)[0];
		expect(overlayGroup).toBeTruthy();

		const overlayRects = collectElements(
			overlayGroup,
			(element) => element.type === "rect" && element.props.style === "stroke",
		);
		expect(overlayRects).toHaveLength(2);
		expect(overlayRects.every((element) => element.props.strokeWidth === 4)).toBe(
			true,
		);
		const colors = new Set(overlayRects.map((element) => element.props.color));
		expect(colors).toEqual(
			new Set(["rgba(251,146,60,1)", "rgba(56,189,248,0.95)"]),
		);
	});

	it("拖拽过程中不会切换到其他节点的 hover 高亮", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const baseTree = getLatestRenderTree();
		const baseWrappers = collectElements(
			baseTree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const nodeAWrapper = baseWrappers.find(
			(element) => element.props.node.id === "node-a",
		);
		const nodeBWrapper = baseWrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(nodeAWrapper).toBeTruthy();
		expect(nodeBWrapper).toBeTruthy();

		act(() => {
			nodeAWrapper?.props.onDragStart?.(nodeAWrapper.props.node, {
				movementX: 0,
				movementY: 0,
				clientX: 100,
				clientY: 100,
				first: true,
				last: false,
				tap: false,
				button: 0,
				buttons: 1,
			});
			nodeBWrapper?.props.onPointerEnter?.("node-b");
		});

		const dragTree = getLatestRenderTree();
		const dragWrappers = collectElements(
			dragTree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const dragNodeAWrapper = dragWrappers.find(
			(element) => element.props.node.id === "node-a",
		);
		const dragNodeBWrapper = dragWrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(dragNodeAWrapper?.props.showBorder).toBe(false);
		expect(dragNodeBWrapper?.props.showBorder).toBe(true);

		act(() => {
			dragNodeAWrapper?.props.onDragEnd?.(dragNodeAWrapper.props.node, {
				movementX: 0,
				movementY: 0,
				clientX: 100,
				clientY: 100,
				first: false,
				last: true,
				tap: false,
				button: 0,
				buttons: 0,
			});
			dragNodeBWrapper?.props.onPointerEnter?.("node-b");
		});

		const endTree = getLatestRenderTree();
		const endWrappers = collectElements(
			endTree,
			(element) => element.type === NodeInteractionWrapper,
		);
		const endNodeBWrapper = endWrappers.find(
			(element) => element.props.node.id === "node-b",
		);
		expect(endNodeBWrapper?.props.showBorder).toBe(false);
	});

	it("active 节点渲染两个 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(2);
	});

	it("locked active 节点不渲染 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0, { locked: true })]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(0);
	});

	it("focus 状态下不显示 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId="node-a"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(0);
	});

	it("anchor pointer down 会透传 resize start/drag/end 回调并包含 anchor", async () => {
		const onNodeResizeStart = vi.fn();
		const onNodeResize = vi.fn();
		const onNodeResizeEnd = vi.fn();

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				focusedNodeId={null}
				onNodeResizeStart={onNodeResizeStart}
				onNodeResize={onNodeResize}
				onNodeResizeEnd={onNodeResizeEnd}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const anchorGroups = collectAnchorGroups(tree);
		expect(anchorGroups).toHaveLength(2);

		act(() => {
			anchorGroups[0]?.props.onPointerDown?.({
				button: 0,
				buttons: 1,
				clientX: 120,
				clientY: 80,
			});
		});

		expect(onNodeResizeStart).toHaveBeenCalled();
		expect(onNodeResize).toHaveBeenCalled();
		expect(onNodeResizeEnd).toHaveBeenCalled();
		expect(onNodeResizeStart.mock.calls[0]?.[0]?.id).toBe("node-a");
		expect(onNodeResizeStart.mock.calls[0]?.[1]).toBe("top-left");
	});

});
