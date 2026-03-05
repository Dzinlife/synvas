// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import type { CanvasNode, StudioProject } from "core/studio/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { NodeInteractionWrapper } from "./NodeInteractionWrapper";

const { rootRenderSpy } = vi.hoisted(() => ({
	rootRenderSpy: vi.fn(),
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

const createVideoNode = (id: string, zIndex: number): CanvasNode => ({
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
});
