// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { StudioProject, VideoCanvasNode } from "core/studio/types";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { TILE_MAX_TASKS_PER_TICK_DRAG } from "./tile/constants";
import { StaticTileScheduler } from "./tile/scheduler";

const { rootRenderSpy } = vi.hoisted(() => ({
	rootRenderSpy: vi.fn(),
}));
const { tilePipelineMockState } = vi.hoisted(() => ({
	tilePipelineMockState: {
		enabled: false,
	},
}));
const { runtimeManagerMock } = vi.hoisted(() => ({
	runtimeManagerMock: {},
}));
const { acquireImageAssetMock } = vi.hoisted(() => ({
	acquireImageAssetMock: vi.fn(),
}));
const {
	focusLayerPointerDownSpy,
	focusLayerPointerMoveSpy,
	focusLayerPointerUpSpy,
	focusLayerPointerLeaveSpy,
} = vi.hoisted(() => ({
	focusLayerPointerDownSpy: vi.fn(),
	focusLayerPointerMoveSpy: vi.fn(),
	focusLayerPointerUpSpy: vi.fn(),
	focusLayerPointerLeaveSpy: vi.fn(),
}));
const { focusLayerMockState } = vi.hoisted(() => ({
	focusLayerMockState: {
		handleItems: [] as Array<{
			id: string;
			handle: string;
			kind: string;
			screenX: number;
			screenY: number;
			rectLocal: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			cursor: string;
			visibleCornerMarker: boolean;
		}>,
		activeHandle: null as string | null,
		selectedIds: [] as string[],
		selectionFrameScreen: null as {
			cx: number;
			cy: number;
			width: number;
			height: number;
			rotationRad: number;
		} | null,
	},
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
	const createSharedValue = <T,>(value: T) => {
		const listeners = new Map<number, (nextValue: T) => void>();
		return {
			value,
			_isSharedValue: true as const,
			addListener: (listenerId: number, listener: (nextValue: T) => void) => {
				listeners.set(listenerId, listener);
			},
			removeListener: (listenerId: number) => {
				listeners.delete(listenerId);
			},
		};
	};
	const createSurface = () => {
		const canvas = {
			clear: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			translate: vi.fn(),
			scale: vi.fn(),
			drawPicture: vi.fn(),
			drawImageRect: vi.fn(),
		};
		return {
			getCanvas: () => canvas,
			flush: vi.fn(),
			asImageCopy: () => ({
				dispose: vi.fn(),
			}),
			makeImageSnapshot: () => ({
				dispose: vi.fn(),
			}),
			dispose: vi.fn(),
		};
	};
	const skiaMock = {
		RuntimeEffect: {
			Make: () => ({ type: "runtime-effect" }),
		},
		Font: () => ({
			getTextWidth: (text: string) => text.length * 6,
			getMetrics: () => ({
				ascent: -9,
				descent: 2,
				leading: 0,
			}),
		}),
		get Paint() {
			if (!tilePipelineMockState.enabled) return undefined;
			return () => ({
				dispose: vi.fn(),
			});
		},
		Surface: {
			get MakeOffscreen() {
				if (!tilePipelineMockState.enabled) return undefined;
				return () => createSurface();
			},
		},
	};

	return {
		Canvas,
		Group: "group",
		Image: "image",
		Rect: "rect",
		RoundedRect: "rrect",
		Text: "text",
		Path: "path",
		Shader: "shader",
		cancelAnimation: vi.fn(),
		Easing: {
			cubic: (value: number) => value ** 3,
			out: (easing: (value: number) => number) => {
				return (value: number) => 1 - easing(1 - value);
			},
		},
		makeMutable: <T,>(initialValue: T) => createSharedValue(initialValue),
		useSharedValue: <T,>(initialValue: T) => {
			const ref = ReactModule.useRef(createSharedValue(initialValue));
			return ref.current;
		},
		useDerivedValue: <T,>(updater: () => T) => {
			const ref = ReactModule.useRef(createSharedValue(updater()));
			ref.current.value = updater();
			return ref.current;
		},
		withTiming: <T,>(value: T) => value,
		withSpring: <T,>(value: T) => value,
		useFont: () => ({
			getTextWidth: (text: string) => text.length * 6,
			getMetrics: () => ({
				ascent: -9,
				descent: 2,
				leading: 0,
			}),
		}),
		Skia: skiaMock,
	};
});

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useStudioRuntimeManager: () => runtimeManagerMock,
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: acquireImageAssetMock,
}));

vi.mock("@/scene-editor/focus-editor/useSceneFocusEditorLayer", () => ({
	useSceneFocusEditorLayer: ({
		width,
		height,
		focusedNode,
		suspendHover,
	}: {
		width: number;
		height: number;
		focusedNode: { id: string; type: string } | null;
		suspendHover?: boolean;
	}) => {
		const enabled = Boolean(focusedNode);
		return {
			enabled,
			layerProps: enabled
				? {
						width,
						height,
						elements: [],
						selectedIds: focusLayerMockState.selectedIds,
						hoveredId: null,
						draggingId: null,
						selectionRectScreen: null,
						snapGuidesScreen: { vertical: [], horizontal: [] },
						selectionFrameScreen: focusLayerMockState.selectionFrameScreen,
						handleItems: focusLayerMockState.handleItems,
						activeHandle: focusLayerMockState.activeHandle,
						labelItems: [],
						disabled: suspendHover ?? false,
						onLayerPointerDown: focusLayerPointerDownSpy,
						onLayerPointerMove: focusLayerPointerMoveSpy,
						onLayerPointerUp: focusLayerPointerUpSpy,
						onLayerPointerLeave: focusLayerPointerLeaveSpy,
					}
				: null,
		};
	},
}));

vi.mock("./node-system/registry", async () => {
	const { FocusSceneSkiaLayer } = await import(
		"@/scene-editor/focus-editor/FocusSceneSkiaLayer"
	);
	const { SceneFocusEditorBridge } = await import(
		"@/scene-editor/focus-editor/SceneFocusEditorBridge"
	);
	return {
		getCanvasNodeDefinition: (type: string) => ({
			skiaRenderer: () => null,
			focusEditorLayer: type === "scene" ? FocusSceneSkiaLayer : undefined,
			focusEditorBridge: type === "scene" ? SceneFocusEditorBridge : undefined,
		}),
	};
});

type AnyElement = React.ReactElement<
	Record<string, unknown>,
	React.ElementType
>;

const getElementProps = <T extends Record<string, unknown>>(
	element: AnyElement | null | undefined,
): T | null => {
	if (!element) return null;
	return element.props as T;
};

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

const getOverlayElement = (tree: React.ReactNode): AnyElement | null => {
	return (
		collectElements(
			tree,
			(element) => element.type === CanvasNodeOverlayLayer,
		)[0] ?? null
	);
};

const resolveComponentNames = (type: React.ElementType): string[] => {
	if (typeof type === "function") {
		return [type.displayName, type.name].filter(Boolean) as string[];
	}
	if (typeof type === "object" && type !== null) {
		const componentType = type as {
			displayName?: string;
			name?: string;
			type?: {
				displayName?: string;
				name?: string;
			};
			render?: {
				displayName?: string;
				name?: string;
			};
		};
		return [
			componentType.displayName,
			componentType.name,
			componentType.type?.displayName,
			componentType.type?.name,
			componentType.render?.displayName,
			componentType.render?.name,
		].filter(Boolean) as string[];
	}
	return [];
};

const getCanvasNodeRenderItems = (tree: React.ReactNode): AnyElement[] => {
	return collectElements(tree, (element) => {
		return resolveComponentNames(element.type).includes("CanvasNodeRenderItem");
	});
};

const getStaticTileLayerElement = (
	tree: React.ReactNode,
): AnyElement | null => {
	return (
		collectElements(tree, (element) => {
			return resolveComponentNames(element.type).includes("StaticTileLayer");
		})[0] ?? null
	);
};

const getStaticTileOpacityGroupElement = (
	tree: React.ReactNode,
): AnyElement | null => {
	return (
		collectElements(tree, (element) => {
			if (element.type !== "group") return false;
			const props = getElementProps<{
				opacity?: { _isSharedValue?: boolean; value?: number };
				children?: React.ReactNode;
			}>(element);
			if (!props?.opacity?._isSharedValue) return false;
			return (
				collectElements(props.children ?? null, (child) => {
					return resolveComponentNames(child.type).includes("StaticTileLayer");
				}).length > 0
			);
		})[0] ?? null
	);
};

const getTileDebugLayerElement = (tree: React.ReactNode): AnyElement | null => {
	return (
		collectElements(tree, (element) => {
			return resolveComponentNames(element.type).includes("TileDebugLayer");
		})[0] ?? null
	);
};

const hasNamedComponent = (tree: React.ReactNode, name: string): boolean => {
	return collectElements(tree, (element) => {
		return resolveComponentNames(element.type).includes(name);
	}).length > 0;
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

const createSceneNode = (id: string, zIndex: number) => ({
	id,
	type: "scene" as const,
	name: id,
	x: 20,
	y: 30,
	width: 320,
	height: 180,
	zIndex,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
});

const createImageAsset = (id: string): StudioProject["assets"][number] => ({
	id,
	kind: "image",
	name: id,
	locator: {
		type: "linked-remote",
		uri: `https://example.com/${id}.png`,
	},
});

const createCameraShared = (camera: { x: number; y: number; zoom: number }) => {
	let currentValue = camera;
	const listeners = new Map<
		number,
		(nextCamera: { x: number; y: number; zoom: number }) => void
	>();
	return {
		_isSharedValue: true as const,
		get value() {
			return currentValue;
		},
		set value(nextValue: { x: number; y: number; zoom: number }) {
			currentValue = nextValue;
			for (const listener of listeners.values()) {
				listener(nextValue);
			}
		},
		addListener: (
			listenerId: number,
			listener: (nextCamera: { x: number; y: number; zoom: number }) => void,
		) => {
			listeners.set(listenerId, listener);
		},
		removeListener: (listenerId: number) => {
			listeners.delete(listenerId);
		},
	};
};

const emptyScenes: StudioProject["scenes"] = {};

describe("InfiniteSkiaCanvas", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		rootRenderSpy.mockReset();
		tilePipelineMockState.enabled = false;
		acquireImageAssetMock.mockReset();
		acquireImageAssetMock.mockImplementation(async (uri: string) => {
			return {
				asset: {
					image: {
						id: uri,
						width: 256,
						height: 144,
						dispose: vi.fn(),
					},
				},
				release: vi.fn(),
			};
		});
		focusLayerPointerDownSpy.mockReset();
		focusLayerPointerMoveSpy.mockReset();
		focusLayerPointerUpSpy.mockReset();
		focusLayerPointerLeaveSpy.mockReset();
		focusLayerMockState.handleItems = [];
		focusLayerMockState.activeHandle = null;
		focusLayerMockState.selectedIds = [];
		focusLayerMockState.selectionFrameScreen = null;
	});

	it("active 节点渲染四个 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		const overlayProps = getElementProps<{
			activeNode?: { id: string };
			hoverNode?: { id: string } | null;
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.id).toBe("node-a");
		expect(overlayProps?.hoverNode ?? null).toBeNull();
	});

	it("会把 snapGuidesScreen 透传给 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				snapGuidesScreen={{ vertical: [320], horizontal: [180] }}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const overlayProps = getElementProps<{
			snapGuidesScreen?: {
				vertical: number[];
				horizontal: number[];
			};
		}>(getOverlayElement(getLatestRenderTree()));
		expect(overlayProps?.snapGuidesScreen).toEqual({
			vertical: [320],
			horizontal: [180],
		});
	});

	it("会把 marqueeRectScreen 透传给 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				marqueeRectScreen={{
					visible: true,
					x1: 120,
					y1: 80,
					x2: 300,
					y2: 240,
				}}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const overlayProps = getElementProps<{
			marqueeRectScreen?: {
				visible: boolean;
				x1: number;
				y1: number;
				x2: number;
				y2: number;
			} | null;
		}>(getOverlayElement(getLatestRenderTree()));
		expect(overlayProps?.marqueeRectScreen).toEqual({
			visible: true,
			x1: 120,
			y1: 80,
			x2: 300,
			y2: 240,
		});
	});

	it("hover 节点会透传到 overlay", async () => {
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const nodes = [createVideoNode("node-a", 0), createVideoNode("node-b", 1)];
		const { rerender } = render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={nodes}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				hoveredNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		const initialOverlayProps = getElementProps<{
			hoverNode?: { id: string } | null;
		}>(getOverlayElement(getLatestRenderTree()));
		expect(initialOverlayProps?.hoverNode ?? null).toBeNull();
		rerender(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={nodes}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				hoveredNodeId="node-b"
			/>,
		);

		const nextTree = getLatestRenderTree();
		const overlayElement = getOverlayElement(nextTree);
		const overlayProps = getElementProps<{
			activeNode?: { id: string };
			hoverNode?: { id: string } | null;
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.id).toBe("node-a");
		expect(overlayProps?.hoverNode?.id).toBe("node-b");
	});

	it("多选状态会透传到 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					createVideoNode("node-a", 0),
					createVideoNode("node-b", 1),
					createVideoNode("node-c", 2),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-b"
				selectedNodeIds={["node-a", "node-b"]}
				focusedNodeId={null}
				hoveredNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayProps = getElementProps<{
			selectedNodes?: Array<{ id: string }>;
		}>(getOverlayElement(tree));
		expect(overlayProps?.selectedNodes?.map((node) => node.id)).toEqual([
			"node-a",
			"node-b",
		]);
	});

	it("locked active 节点不渲染 resize anchor", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0, { locked: true })]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		const overlayProps = getElementProps<{
			activeNode?: { locked?: boolean };
		}>(overlayElement);
		expect(overlayElement).toBeTruthy();
		expect(overlayProps?.activeNode?.locked).toBe(true);
	});

	it("focus 状态下不挂载 overlay", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId="node-a"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		expect(overlayElement).toBeNull();
	});

	it("focus 状态下不挂载 CanvasNodeLabelLayer", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId="node-a"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		expect(hasNamedComponent(tree, "CanvasNodeLabelLayer")).toBe(false);
	});

	it("focus 进出场会驱动 StaticTileLayer 透明度动画", async () => {
		const node = createVideoNode("node-a", 0);
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const { rerender } = render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={[node]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		await waitFor(() => {
			const opacityGroup = getStaticTileOpacityGroupElement(getLatestRenderTree());
			expect(opacityGroup).toBeTruthy();
			const opacity = getElementProps<{
				opacity?: { _isSharedValue?: boolean; value?: number };
			}>(opacityGroup)?.opacity;
			expect(opacity?._isSharedValue).toBe(true);
			expect(opacity?.value).toBeCloseTo(1, 6);
		});

		rerender(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={[node]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId="node-a"
			/>,
		);
		await waitFor(() => {
			const opacity = getElementProps<{
				opacity?: { value?: number };
			}>(getStaticTileOpacityGroupElement(getLatestRenderTree()))?.opacity;
			expect(opacity?.value).toBeCloseTo(0, 6);
		});

		rerender(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={[node]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			const opacity = getElementProps<{
				opacity?: { value?: number };
			}>(getStaticTileOpacityGroupElement(getLatestRenderTree()))?.opacity;
			expect(opacity?.value).toBeCloseTo(1, 6);
		});
	});

	it("focus 期间会暂停 tile tick 调度，退出后恢复", async () => {
		tilePipelineMockState.enabled = true;
		const beginFrameSpy = vi.spyOn(StaticTileScheduler.prototype, "beginFrame");
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const sceneNode = {
			...createSceneNode("node-scene", 0),
			thumbnail: {
				assetId: "scene-thumb",
				sourceSignature: "scene-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		const baseProps = {
			width: 256,
			height: 144,
			camera,
			nodes: [sceneNode],
			scenes: emptyScenes,
			assets: [createImageAsset("scene-thumb")],
			activeNodeId: null,
			selectedNodeIds: [] as string[],
		};
		try {
			const { rerender } = render(
				<InfiniteSkiaCanvas {...baseProps} focusedNodeId={null} />,
			);
			await waitFor(() => {
				expect(beginFrameSpy).toHaveBeenCalled();
			});
			const beforeFocusCalls = beginFrameSpy.mock.calls.length;

			rerender(<InfiniteSkiaCanvas {...baseProps} focusedNodeId="node-scene" />);
			await waitFor(() => {
				expect(rootRenderSpy).toHaveBeenCalled();
			});
			const focusedCalls = beginFrameSpy.mock.calls.length;
			expect(focusedCalls).toBe(beforeFocusCalls);

			act(() => {
				camera.value = { x: 48, y: -24, zoom: 1.25 };
			});
			await act(async () => {
				await Promise.resolve();
			});
			expect(beginFrameSpy.mock.calls.length).toBe(focusedCalls);

			rerender(<InfiniteSkiaCanvas {...baseProps} focusedNodeId={null} />);
			await waitFor(() => {
				expect(beginFrameSpy.mock.calls.length).toBeGreaterThan(focusedCalls);
			});
		} finally {
			beginFrameSpy.mockRestore();
		}
	});

	it("LOD freeze 过渡期间不挂载 CanvasNodeLabelLayer", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				tileLodTransition={{ mode: "freeze" }}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		expect(hasNamedComponent(tree, "CanvasNodeLabelLayer")).toBe(false);
	});

	it("不渲染基础节点交互层", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				hoveredNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		expect(hasNamedComponent(tree, "CanvasNodeInteractionItem")).toBe(false);
		expect(hasNamedComponent(tree, "SelectionBoundsInteractionLayer")).toBe(false);
		expect(hasNamedComponent(tree, "DragProxyLayer")).toBe(false);
	});

	it("摄像机动画中 overlay 走 shared camera 快通道", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 24, y: -12, zoom: 1.25 })}
				nodes={[createVideoNode("node-a", 0), createVideoNode("node-b", 1)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				hoveredNodeId={null}
				suspendHover
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		expect(overlayElement).toBeTruthy();
		expect(
			(overlayElement?.props.camera as { _isSharedValue?: boolean } | undefined)
				?._isSharedValue,
		).toBe(true);

		const backgroundElement = collectElements(tree, (element) => {
			return element.type === CanvasTriDotGridBackground;
		})[0];
		expect(backgroundElement).toBeTruthy();
		expect(
			(
				backgroundElement?.props.uniforms as
					| { _isSharedValue?: boolean }
					| undefined
			)?._isSharedValue,
		).toBe(true);

		const fastWorldGroup = collectElements(tree, (element) => {
			if (element.type !== ("group" as React.ElementType)) return false;
			const transform = element.props.transform as
				| { _isSharedValue?: boolean }
				| undefined;
			return transform?._isSharedValue === true;
		})[0];
		expect(fastWorldGroup).toBeTruthy();
		expect(
			(fastWorldGroup?.props.transform as { value?: unknown } | undefined)
				?.value,
		).toEqual([
			{
				matrix: [1.25, 0, 0, 30, 0, 1.25, 0, -15, 0, 0, 1, 0, 0, 0, 0, 1],
			},
		]);
	});

	it("camera-only 更新不会重建 Skia 树", async () => {
		const nodes = [createVideoNode("node-a", 0)];
		const selectedNodeIds = ["node-a"];
		const assets: StudioProject["assets"] = [];
		const snapGuidesScreen = { vertical: [], horizontal: [] };
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const { rerender } = render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={nodes}
				scenes={emptyScenes}
				assets={assets}
				activeNodeId="node-a"
				selectedNodeIds={selectedNodeIds}
				focusedNodeId={null}
				snapGuidesScreen={snapGuidesScreen}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const initialRenderCount = rootRenderSpy.mock.calls.length;

		camera.value = { x: 48, y: -24, zoom: 1.5 };
		rerender(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={nodes}
				scenes={emptyScenes}
				assets={assets}
				activeNodeId="node-a"
				selectedNodeIds={selectedNodeIds}
				focusedNodeId={null}
				snapGuidesScreen={snapGuidesScreen}
			/>,
		);

		await act(async () => {
			await Promise.resolve();
		});

		expect(rootRenderSpy.mock.calls.length).toBe(initialRenderCount);
	});

	it("layout-only 更新不会重建 Skia 树", async () => {
		const nodes = [createVideoNode("node-a", 0)];
		const assets: StudioProject["assets"] = [];
		const selectedNodeIds = ["node-a"];
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const { rerender } = render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={nodes}
				scenes={emptyScenes}
				assets={assets}
				activeNodeId="node-a"
				selectedNodeIds={selectedNodeIds}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const initialRenderCount = rootRenderSpy.mock.calls.length;
		rerender(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={camera}
				nodes={[
					createVideoNode("node-a", 0, {
						x: 180,
						y: 140,
						width: 240,
						height: 160,
						updatedAt: 2,
					}),
				]}
				scenes={emptyScenes}
				assets={assets}
				activeNodeId="node-a"
				selectedNodeIds={selectedNodeIds}
				focusedNodeId={null}
			/>,
		);

		await act(async () => {
			await Promise.resolve();
		});

			expect(rootRenderSpy.mock.calls.length).toBe(initialRenderCount);

			const tree = getLatestRenderTree();
			const nodeItems = getCanvasNodeRenderItems(tree);
		const targetNodeItem = nodeItems.find((nodeItem) => {
			return (
				getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id ===
				"node-a"
			);
		});
		const nodeItemProps = getElementProps<{
			layout?: {
				_isSharedValue?: boolean;
				value?: {
					x: number;
					y: number;
					width: number;
					height: number;
				};
			};
		}>(targetNodeItem);
		expect(nodeItemProps?.layout?._isSharedValue).toBe(true);
		expect(nodeItemProps?.layout?.value).toEqual({
			x: 180,
			y: 140,
			width: 240,
			height: 160,
		});
	});

	it("tile 命中后仅 active 节点保持 live", async () => {
		tilePipelineMockState.enabled = true;
		const sceneNode = {
			...createSceneNode("node-scene", 0),
			thumbnail: {
				assetId: "scene-thumb",
				sourceSignature: "scene-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		const activeNode = {
			...createVideoNode("node-active", 1),
			thumbnail: {
				assetId: "video-thumb",
				sourceSignature: "video-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[sceneNode, activeNode]}
				scenes={emptyScenes}
				assets={[
					createImageAsset("scene-thumb"),
					createImageAsset("video-thumb"),
				]}
				activeNodeId="node-active"
				selectedNodeIds={["node-active"]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		await waitFor(() => {
			const staticTileLayerProps = getElementProps<{
				drawItems?: Array<unknown>;
			}>(getStaticTileLayerElement(getLatestRenderTree()));
			expect(staticTileLayerProps?.drawItems?.length ?? 0).toBeGreaterThan(0);
		});
		await waitFor(() => {
			const liveNodeIds = getCanvasNodeRenderItems(getLatestRenderTree()).map(
				(nodeItem) =>
					getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id,
			);
			expect(liveNodeIds).toEqual(["node-active"]);
		});
	});

	it("tile 调度参数会透传给 scheduler.beginFrame", async () => {
		tilePipelineMockState.enabled = true;
		const beginFrameSpy = vi.spyOn(StaticTileScheduler.prototype, "beginFrame");
		try {
			render(
				<InfiniteSkiaCanvas
					width={128}
					height={128}
					camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
					nodes={[
						{
							...createSceneNode("node-scene", 0),
							thumbnail: {
								assetId: "scene-thumb",
								sourceSignature: "scene-v1",
								frame: 0,
								generatedAt: 1,
								version: 1 as const,
							},
						},
					]}
					scenes={emptyScenes}
					assets={[createImageAsset("scene-thumb")]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
					tileMaxTasksPerTick={TILE_MAX_TASKS_PER_TICK_DRAG}
					tileLodTransition={{ mode: "snap", zoom: 0.5 }}
				/>,
			);
			await waitFor(() => {
				expect(beginFrameSpy).toHaveBeenCalled();
			});
			expect(
				beginFrameSpy.mock.calls.some((call) => {
					return (
						(
							call[0] as
								| {
										maxTasksPerTick?: number;
										lodTransitionMode?: string;
										lodAnchorZoom?: number;
								  }
								| undefined
						)?.maxTasksPerTick === TILE_MAX_TASKS_PER_TICK_DRAG
					);
				}),
			).toBe(true);
			expect(
				beginFrameSpy.mock.calls.some((call) => {
					const input = call[0] as
						| {
								lodTransitionMode?: string;
								lodAnchorZoom?: number;
						  }
						| undefined;
					return (
						input?.lodTransitionMode === "snap" && input.lodAnchorZoom === 0.5
					);
				}),
			).toBe(true);
		} finally {
			beginFrameSpy.mockRestore();
		}
	});

	it("tile miss 时不会把非 active 节点回退到 live", async () => {
		tilePipelineMockState.enabled = true;
		acquireImageAssetMock.mockRejectedValueOnce(new Error("missing raster"));
		const sceneNode = {
			...createSceneNode("node-scene", 0),
			thumbnail: {
				assetId: "scene-thumb",
				sourceSignature: "scene-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[sceneNode]}
				scenes={emptyScenes}
				assets={[createImageAsset("scene-thumb")]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		const firstTree = getLatestRenderTree();
		const firstLiveNodeIds = getCanvasNodeRenderItems(firstTree).map(
			(nodeItem) => {
				return getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id;
			},
		);
		expect(firstLiveNodeIds).not.toContain("node-scene");
	});

	it("tile 输入会使用 tileSourceNodes，而不是仅依赖 nodes(cull 子集)", async () => {
		tilePipelineMockState.enabled = true;
		const nodeInRender = {
			...createSceneNode("node-scene-visible", 0),
			thumbnail: {
				assetId: "scene-thumb-a",
				sourceSignature: "scene-a-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		const nodeOnlyInTileSource = {
			...createSceneNode("node-scene-cull-only", 1),
			x: 4096,
			y: 4096,
			thumbnail: {
				assetId: "scene-thumb-b",
				sourceSignature: "scene-b-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[nodeInRender]}
				tileSourceNodes={[nodeInRender, nodeOnlyInTileSource]}
				scenes={emptyScenes}
				assets={[
					createImageAsset("scene-thumb-a"),
					createImageAsset("scene-thumb-b"),
				]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		await waitFor(() => {
			const calledUris = acquireImageAssetMock.mock.calls.map((call) =>
				String(call[0] ?? ""),
			);
			expect(
				calledUris.some((uri) => uri.includes("scene-thumb-a.png")),
			).toBe(true);
			expect(
				calledUris.some((uri) => uri.includes("scene-thumb-b.png")),
			).toBe(true);
		});
	});

	it("默认不渲染 TileDebugLayer", async () => {
		tilePipelineMockState.enabled = true;
		render(
			<InfiniteSkiaCanvas
				width={256}
				height={256}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					{
						...createSceneNode("node-scene", 0),
						thumbnail: {
							assetId: "scene-thumb",
							sourceSignature: "scene-v1",
							frame: 0,
							generatedAt: 1,
							version: 1 as const,
						},
					},
				]}
				scenes={emptyScenes}
				assets={[createImageAsset("scene-thumb")]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		expect(getTileDebugLayerElement(getLatestRenderTree())).toBeNull();
	});

	it("tileDebugEnabled 开启时渲染 TileDebugLayer", async () => {
		tilePipelineMockState.enabled = true;
		render(
			<InfiniteSkiaCanvas
				width={256}
				height={256}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					{
						...createSceneNode("node-scene", 0),
						thumbnail: {
							assetId: "scene-thumb",
							sourceSignature: "scene-v1",
							frame: 0,
							generatedAt: 1,
							version: 1 as const,
						},
					},
				]}
				scenes={emptyScenes}
				assets={[createImageAsset("scene-thumb")]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
				tileDebugEnabled={true}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		await waitFor(() => {
			expect(getTileDebugLayerElement(getLatestRenderTree())).toBeTruthy();
		});
	});

	it("多选状态下不会出现旧交互层组件", async () => {
		tilePipelineMockState.enabled = true;
		const nodeA = {
			...createVideoNode("node-a", 0),
			thumbnail: {
				assetId: "thumb-a",
				sourceSignature: "a-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		const nodeB = {
			...createVideoNode("node-b", 1),
			thumbnail: {
				assetId: "thumb-b",
				sourceSignature: "b-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		const nodeC = {
			...createVideoNode("node-c", 2),
			thumbnail: {
				assetId: "thumb-c",
				sourceSignature: "c-v1",
				frame: 0,
				generatedAt: 1,
				version: 1 as const,
			},
		};
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[nodeA, nodeB, nodeC]}
				scenes={emptyScenes}
				assets={[
					createImageAsset("thumb-a"),
					createImageAsset("thumb-b"),
					createImageAsset("thumb-c"),
					]}
					activeNodeId="node-c"
					selectedNodeIds={["node-a", "node-b", "node-c"]}
					focusedNodeId={null}
					hoveredNodeId={null}
				/>,
			);
			await waitFor(() => {
				expect(rootRenderSpy).toHaveBeenCalled();
			});
			const tree = getLatestRenderTree();
			expect(hasNamedComponent(tree, "SelectionBoundsInteractionLayer")).toBe(
				false,
			);
			expect(hasNamedComponent(tree, "DragProxyLayer")).toBe(false);
			expect(hasNamedComponent(tree, "CanvasNodeInteractionItem")).toBe(false);
		});

	it("focus scene 模式会抑制普通 node 交互并接管 Focus 层事件", async () => {
		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					createSceneNode("node-scene", 0),
					createVideoNode("node-video", 1),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				selectedNodeIds={["node-scene"]}
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const focusLayer = collectElements(
			tree,
			(element) =>
				element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		expect(focusLayer).toBeTruthy();
		const focusLayerProps = getElementProps<{
			onLayerPointerDown?: (event: Record<string, unknown>) => void;
		}>(focusLayer);

		act(() => {
			focusLayerProps?.onLayerPointerDown?.({
				x: 240,
				y: 120,
				button: 0,
				buttons: 1,
			});
		});
		expect(focusLayerPointerDownSpy).toHaveBeenCalledTimes(1);
	});

	it("focus resize handles 会携带对应 cursor", async () => {
		focusLayerMockState.handleItems = [
			{
				id: "rotate-top-left",
				handle: "rotate-top-left",
				kind: "rotate-corner",
				screenX: 90,
				screenY: 90,
				rectLocal: { x: -55, y: -55, width: 10, height: 10 },
				cursor: "rotate-cursor-top-left",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-top-right",
				handle: "rotate-top-right",
				kind: "rotate-corner",
				screenX: 190,
				screenY: 90,
				rectLocal: { x: 45, y: -55, width: 10, height: 10 },
				cursor: "rotate-cursor-top-right",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-bottom-right",
				handle: "rotate-bottom-right",
				kind: "rotate-corner",
				screenX: 190,
				screenY: 190,
				rectLocal: { x: 45, y: 45, width: 10, height: 10 },
				cursor: "rotate-cursor-bottom-right",
				visibleCornerMarker: false,
			},
			{
				id: "rotate-bottom-left",
				handle: "rotate-bottom-left",
				kind: "rotate-corner",
				screenX: 90,
				screenY: 190,
				rectLocal: { x: -55, y: 45, width: 10, height: 10 },
				cursor: "rotate-cursor-bottom-left",
				visibleCornerMarker: false,
			},
			{
				id: "top-left",
				handle: "top-left",
				kind: "resize-corner",
				screenX: 100,
				screenY: 100,
				rectLocal: { x: -44, y: -44, width: 8, height: 8 },
				cursor: "nwse-resize",
				visibleCornerMarker: true,
			},
			{
				id: "top-right",
				handle: "top-right",
				kind: "resize-corner",
				screenX: 180,
				screenY: 100,
				rectLocal: { x: 36, y: -44, width: 8, height: 8 },
				cursor: "nesw-resize",
				visibleCornerMarker: true,
			},
			{
				id: "bottom-right",
				handle: "bottom-right",
				kind: "resize-corner",
				screenX: 180,
				screenY: 180,
				rectLocal: { x: 36, y: 36, width: 8, height: 8 },
				cursor: "nwse-resize",
				visibleCornerMarker: true,
			},
			{
				id: "bottom-left",
				handle: "bottom-left",
				kind: "resize-corner",
				screenX: 100,
				screenY: 180,
				rectLocal: { x: -44, y: 36, width: 8, height: 8 },
				cursor: "nesw-resize",
				visibleCornerMarker: true,
			},
			{
				id: "top-center",
				handle: "top-center",
				kind: "resize-edge",
				screenX: 140,
				screenY: 100,
				rectLocal: { x: -40, y: -43, width: 80, height: 6 },
				cursor: "ns-resize",
				visibleCornerMarker: false,
			},
			{
				id: "middle-right",
				handle: "middle-right",
				kind: "resize-edge",
				screenX: 180,
				screenY: 140,
				rectLocal: { x: 37, y: -40, width: 6, height: 80 },
				cursor: "ew-resize",
				visibleCornerMarker: false,
			},
			{
				id: "bottom-center",
				handle: "bottom-center",
				kind: "resize-edge",
				screenX: 140,
				screenY: 180,
				rectLocal: { x: -40, y: 37, width: 80, height: 6 },
				cursor: "ns-resize",
				visibleCornerMarker: false,
			},
			{
				id: "middle-left",
				handle: "middle-left",
				kind: "resize-edge",
				screenX: 100,
				screenY: 140,
				rectLocal: { x: -43, y: -40, width: 6, height: 80 },
				cursor: "ew-resize",
				visibleCornerMarker: false,
			},
		];
		focusLayerMockState.selectedIds = ["element-a"];
		focusLayerMockState.selectionFrameScreen = {
			cx: 140,
			cy: 140,
			width: 80,
			height: 80,
			rotationRad: 0,
		};

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createSceneNode("node-scene", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-scene"
				selectedNodeIds={["node-scene"]}
				focusedNodeId="node-scene"
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		await waitFor(() => {
			const focusLayerElement = collectElements(
				getLatestRenderTree(),
				(element) =>
					element.props.onLayerPointerDown === focusLayerPointerDownSpy,
			)[0];
			expect(focusLayerElement).toBeTruthy();
		});
		const tree = getLatestRenderTree();
		const focusLayerElement = collectElements(
			tree,
			(element) =>
				element.props.onLayerPointerDown === focusLayerPointerDownSpy,
		)[0];
		if (!focusLayerElement) return;
		const handleItems = focusLayerElement.props.handleItems as Array<{
			kind: string;
			cursor: string;
			visibleCornerMarker: boolean;
		}>;
		const cursorValues = handleItems.map((item) => item.cursor);
		const visibleCornerMarkers = handleItems.filter(
			(item) => item.visibleCornerMarker,
		);
		expect(visibleCornerMarkers).toHaveLength(4);
		expect(cursorValues).toEqual(
			expect.arrayContaining([
				"rotate-cursor-top-left",
				"rotate-cursor-top-right",
				"rotate-cursor-bottom-right",
				"rotate-cursor-bottom-left",
				"nwse-resize",
				"ns-resize",
				"nesw-resize",
				"ew-resize",
			]),
		);
		expect(cursorValues).toHaveLength(12);
		const rotateCursors = cursorValues.filter((cursor) =>
			/^rotate-cursor-/.test(String(cursor)),
		);
		expect(rotateCursors.every((cursor) => typeof cursor === "string")).toBe(
			true,
		);
		expect(new Set(rotateCursors).size).toBe(4);
		expect(
			rotateCursors.some((cursor) => /grab|hand/i.test(String(cursor))),
		).toBe(false);
	});

	it("会把 resize 回调透传到 overlay", async () => {
		const onNodeResize = vi.fn();

		render(
			<InfiniteSkiaCanvas
				width={800}
				height={600}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createVideoNode("node-a", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId="node-a"
				selectedNodeIds={["node-a"]}
				focusedNodeId={null}
				hoveredNodeId={null}
				onNodeResize={onNodeResize}
			/>,
		);

		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});

		const tree = getLatestRenderTree();
		const overlayElement = getOverlayElement(tree);
		expect(overlayElement).toBeTruthy();
		const overlayProps = getElementProps<{
			onNodeResize?: (event: {
				phase: "start" | "move" | "end";
				node: VideoCanvasNode;
				anchor: "top-left";
				event: Record<string, unknown>;
			}) => void;
		}>(overlayElement);
		expect(typeof overlayProps?.onNodeResize).toBe("function");

		act(() => {
			overlayProps?.onNodeResize?.({
				phase: "move",
				node: createVideoNode("node-a", 0, { x: 999 }),
				anchor: "top-left",
				event: {
					clientX: 0,
					clientY: 0,
					button: 0,
					buttons: 1,
					shiftKey: false,
					altKey: false,
					metaKey: false,
					ctrlKey: false,
					movementX: 0,
					movementY: 0,
					first: false,
					last: false,
					tap: false,
				},
			});
		});
		expect(onNodeResize).toHaveBeenCalledWith(
			expect.objectContaining({
				node: expect.objectContaining({
					id: "node-a",
					x: 20,
				}),
			}),
		);
	});
});
