// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
	AudioCanvasNode,
	BoardCanvasNode,
	ImageCanvasNode,
	StudioProject,
	TextCanvasNode,
	VideoCanvasNode,
} from "@/studio/project/types";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeOverlayLayer } from "./CanvasNodeOverlayLayer";
import { CanvasTriDotGridBackground } from "./CanvasTriDotGridBackground";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { TILE_MAX_TASKS_PER_TICK_DRAG } from "./tile/constants";
import { StaticTileScheduler } from "./tile/scheduler";
import type { TileDrawItem, TileFrameResult, TileInput } from "./tile/types";

interface SkiaSurfaceMockRecord {
	width: number;
	height: number;
	pixelRatio?: number;
	resolvedPixelRatio: number;
	canvas: {
		drawPicture: ReturnType<typeof vi.fn>;
		drawImageRect: ReturnType<typeof vi.fn>;
	};
	image: {
		width: ReturnType<typeof vi.fn>;
		height: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
}

const { rootRenderSpy } = vi.hoisted(() => ({
	rootRenderSpy: vi.fn(),
}));
const { tilePipelineMockState } = vi.hoisted(() => ({
	tilePipelineMockState: {
		enabled: false,
	},
}));
const { skiaSurfaceMockState } = vi.hoisted(() => ({
	skiaSurfaceMockState: {
		defaultPixelRatio: 1,
		surfaces: [] as SkiaSurfaceMockRecord[],
	},
}));
const { runtimeManagerMock } = vi.hoisted(() => ({
	runtimeManagerMock: {},
}));
const { acquireImageAssetMock } = vi.hoisted(() => ({
	acquireImageAssetMock: vi.fn(),
}));
const { renderNodeToPictureMock } = vi.hoisted(() => ({
	renderNodeToPictureMock: vi.fn(() => ({
		dispose: vi.fn(),
	})),
}));
const { textTilePictureSourceSignatureMock } = vi.hoisted(() => ({
	textTilePictureSourceSignatureMock: vi.fn(
		(context: { node: TextCanvasNode }) =>
			`${context.node.id}:${context.node.updatedAt}:${context.node.text}`,
	),
}));
const { textTilePictureGenerateMock } = vi.hoisted(() => ({
	textTilePictureGenerateMock: vi.fn(
		async (context: { node: TextCanvasNode }) => {
			return {
				picture: {
					dispose: vi.fn(),
				},
				sourceWidth: Math.max(1, Math.round(Math.abs(context.node.width))),
				sourceHeight: Math.max(1, Math.round(Math.abs(context.node.height))),
				dispose: vi.fn(),
			};
		},
	),
}));
const {
	focusLayerPointerDownSpy,
	focusLayerDoubleClickSpy,
	focusLayerPointerMoveSpy,
	focusLayerPointerUpSpy,
	focusLayerPointerLeaveSpy,
} = vi.hoisted(() => ({
	focusLayerPointerDownSpy: vi.fn(),
	focusLayerDoubleClickSpy: vi.fn(),
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
	const createSurface = (width = 1, height = 1, pixelRatio?: number) => {
		const safeWidth = Math.max(1, Math.ceil(width));
		const safeHeight = Math.max(1, Math.ceil(height));
		const resolvedPixelRatio =
			pixelRatio ?? skiaSurfaceMockState.defaultPixelRatio;
		const canvas = {
			clear: vi.fn(),
			save: vi.fn(),
			restore: vi.fn(),
			translate: vi.fn(),
			scale: vi.fn(),
			clipRect: vi.fn(),
			drawPicture: vi.fn(),
			drawImageRect: vi.fn(),
		};
		const image = {
			width: vi.fn(() =>
				Math.max(1, Math.ceil(safeWidth * resolvedPixelRatio)),
			),
			height: vi.fn(() =>
				Math.max(1, Math.ceil(safeHeight * resolvedPixelRatio)),
			),
			dispose: vi.fn(),
		};
		skiaSurfaceMockState.surfaces.push({
			width: safeWidth,
			height: safeHeight,
			pixelRatio,
			resolvedPixelRatio,
			canvas,
			image,
		});
		return {
			getCanvas: () => canvas,
			flush: vi.fn(),
			asImageCopy: () => image,
			makeImageSnapshot: () => image,
			dispose: vi.fn(),
		};
	};
	const skiaMock = {
		Color: (value: string) => value,
		ParagraphBuilder: {
			Make: () => {
				const paragraph = {
					layout: vi.fn(),
					dispose: vi.fn(),
				};
				return {
					pushStyle() {
						return this;
					},
					addText() {
						return this;
					},
					pop() {
						return this;
					},
					build: () => paragraph,
					dispose: vi.fn(),
				};
			},
		},
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
				return (width: number, height: number, pixelRatio?: number) =>
					createSurface(width, height, pixelRatio);
			},
		},
	};

	return {
		Canvas,
		ClipOp: {
			Intersect: "intersect",
			Difference: "difference",
		},
		Group: "group",
		Image: "image",
		Paragraph: "paragraph",
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
		scheduleSkiaDispose: () => 0,
		markSkiaRuntimeActivity: () => {},
		getSkiaDisposalStats: () => ({
			pendingAnimationFrame: 0,
			pendingIdle: 0,
			pendingManual: 0,
		}),
		drainSkiaDisposals: () => 0,
		Skia: skiaMock,
	};
});

vi.mock("@/scene-editor/runtime/EditorRuntimeProvider", () => ({
	useStudioRuntimeManager: () => runtimeManagerMock,
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: acquireImageAssetMock,
}));

vi.mock("core/render-system/renderNodeSnapshot", () => ({
	renderNodeToPicture: renderNodeToPictureMock,
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
			bridgeProps: null,
			layerProps: enabled
				? {
						width,
						height,
						elements: [],
						selectedIds: focusLayerMockState.selectedIds,
						hoveredId: null,
						draggingId: null,
						editingElementId: null,
						textEditingDecorations: null,
						selectionRectScreen: null,
						snapGuidesScreen: { vertical: [], horizontal: [] },
						selectionFrameScreen: focusLayerMockState.selectionFrameScreen,
						handleItems: focusLayerMockState.handleItems,
						activeHandle: focusLayerMockState.activeHandle,
						labelItems: [],
						disabled: suspendHover ?? false,
						onLayerPointerDown: focusLayerPointerDownSpy,
						onLayerDoubleClick: focusLayerDoubleClickSpy,
						onLayerPointerMove: focusLayerPointerMoveSpy,
						onLayerPointerUp: focusLayerPointerUpSpy,
						onLayerPointerLeave: focusLayerPointerLeaveSpy,
					}
				: null,
		};
	},
}));

vi.mock("@/node-system/registry", async () => {
	const { FocusSceneSkiaLayer } = await import(
		"@/scene-editor/focus-editor/FocusSceneSkiaLayer"
	);
	const { SceneFocusEditorBridge } = await import(
		"@/scene-editor/focus-editor/SceneFocusEditorBridge"
	);
	const thumbnailCapability = {
		getSourceSignature: () => null,
		generate: async () => null,
	};
	const textTilePictureCapability = {
		getSourceSignature: textTilePictureSourceSignatureMock,
		generate: textTilePictureGenerateMock,
	};
	return {
		getCanvasNodeDefinition: (type: string) => ({
			skiaRenderer: () => null,
			thumbnail:
				type === "scene" || type === "video" ? thumbnailCapability : undefined,
			tilePicture: type === "text" ? textTilePictureCapability : undefined,
			focusEditorLayer: type === "scene" ? FocusSceneSkiaLayer : undefined,
			focusEditorBridge: type === "scene" ? SceneFocusEditorBridge : undefined,
		}),
	};
});

type AnyElement = React.ReactElement<
	Record<string, unknown>,
	React.ElementType
>;
const mockGroupType = "group" as unknown as React.ElementType;

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

const getCanvasNodeFrozenRenderItems = (
	tree: React.ReactNode,
): AnyElement[] => {
	return collectElements(tree, (element) => {
		return resolveComponentNames(element.type).includes(
			"CanvasNodeFrozenRenderItem",
		);
	});
};

const getLiveRenderedNodeIds = (
	tree: React.ReactNode,
): Array<string | undefined> => {
	return getCanvasNodeRenderItems(tree).map((nodeItem) => {
		return getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id;
	});
};

const getFrozenRenderedNodeIds = (
	tree: React.ReactNode,
): Array<string | undefined> => {
	return getCanvasNodeFrozenRenderItems(tree).map((nodeItem) => {
		return getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id;
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
			if (element.type !== mockGroupType) return false;
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
	return (
		collectElements(tree, (element) => {
			return resolveComponentNames(element.type).includes(name);
		}).length > 0
	);
};

const createVideoNode = (
	id: string,
	siblingOrder: number,
	patch: Partial<VideoCanvasNode> = {},
): VideoCanvasNode => ({
	id,
	type: "video",
	name: id,
	x: 20,
	y: 30,
	width: 160,
	height: 90,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: `${id}-asset`,
	...patch,
});

const createSceneNode = (id: string, siblingOrder: number) => ({
	id,
	type: "scene" as const,
	name: id,
	x: 20,
	y: 30,
	width: 320,
	height: 180,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
});

const createBoardNode = (
	id: string,
	siblingOrder: number,
	patch: Partial<BoardCanvasNode> = {},
): BoardCanvasNode => ({
	id,
	type: "board",
	name: id,
	x: 20,
	y: 30,
	width: 320,
	height: 180,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

const createTextNode = (
	id: string,
	siblingOrder: number,
	patch: Partial<TextCanvasNode> = {},
): TextCanvasNode => ({
	id,
	type: "text",
	name: id,
	text: "Hello",
	fontSize: 48,
	x: 20,
	y: 30,
	width: 240,
	height: 120,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

const createAudioNode = (
	id: string,
	siblingOrder: number,
	patch: Partial<AudioCanvasNode> = {},
): AudioCanvasNode => ({
	id,
	type: "audio",
	name: id,
	x: 20,
	y: 30,
	width: 240,
	height: 120,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: `${id}-asset`,
	...patch,
});

const createImageNode = (
	id: string,
	siblingOrder: number,
	patch: Partial<ImageCanvasNode> = {},
): ImageCanvasNode => ({
	id,
	type: "image",
	name: id,
	x: 20,
	y: 30,
	width: 240,
	height: 120,
	siblingOrder,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: `${id}-asset`,
	...patch,
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

const createDeferred = <T,>() => {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {
		promise,
		resolve,
		reject,
	};
};

const emptyScenes: StudioProject["scenes"] = {};

const createEmptyTileFrameResult = (): TileFrameResult => ({
	drawItems: [],
	debugItems: [],
	fallbackNodeIds: [],
	hasPendingWork: false,
	stats: {
		visibleCount: 0,
		readyVisibleCount: 0,
		fallbackNodeCount: 0,
		coverFallbackCount: 0,
		queuedCount: 0,
		renderingCount: 0,
		readyCount: 0,
		staleCount: 0,
		frameTaskCount: 0,
		targetLod: 0,
		composeLod: 0,
	},
});

describe("InfiniteSkiaCanvas", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		rootRenderSpy.mockReset();
		tilePipelineMockState.enabled = false;
		skiaSurfaceMockState.defaultPixelRatio = 1;
		skiaSurfaceMockState.surfaces.length = 0;
		acquireImageAssetMock.mockReset();
		renderNodeToPictureMock.mockReset();
		textTilePictureSourceSignatureMock.mockReset();
		textTilePictureSourceSignatureMock.mockImplementation(
			(context: { node: TextCanvasNode }) =>
				`${context.node.id}:${context.node.updatedAt}:${context.node.text}`,
		);
		textTilePictureGenerateMock.mockReset();
		textTilePictureGenerateMock.mockImplementation(
			async (context: { node: TextCanvasNode }) => ({
				picture: {
					dispose: vi.fn(),
				},
				sourceWidth: Math.max(1, Math.round(Math.abs(context.node.width))),
				sourceHeight: Math.max(1, Math.round(Math.abs(context.node.height))),
				dispose: vi.fn(),
			}),
		);
		renderNodeToPictureMock.mockReturnValue({
			dispose: vi.fn(),
		});
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
		focusLayerDoubleClickSpy.mockReset();
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
			const opacityGroup = getStaticTileOpacityGroupElement(
				getLatestRenderTree(),
			);
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
		const beginFrameSpy = vi
			.spyOn(StaticTileScheduler.prototype, "beginFrame")
			.mockImplementation(() => createEmptyTileFrameResult());
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

			rerender(
				<InfiniteSkiaCanvas {...baseProps} focusedNodeId="node-scene" />,
			);
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
		expect(hasNamedComponent(tree, "SelectionBoundsInteractionLayer")).toBe(
			false,
		);
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

	it("active board 不走 live 且仍保留在 tile 输入中", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const boardNode = {
				...createBoardNode("node-board-active", 1),
				thumbnail: {
					assetId: "board-thumb",
					sourceSignature: "board-v1",
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
					nodes={[
						{
							...createSceneNode("node-scene-under", 0),
							thumbnail: {
								assetId: "scene-under-thumb",
								sourceSignature: "scene-under-v1",
								frame: 0,
								generatedAt: 1,
								version: 1 as const,
							},
						},
						boardNode,
					]}
					scenes={emptyScenes}
					assets={[
						createImageAsset("scene-under-thumb"),
						createImageAsset("board-thumb"),
					]}
					activeNodeId="node-board-active"
					selectedNodeIds={["node-board-active"]}
					focusedNodeId={null}
				/>,
			);
			await waitFor(() => {
				expect(setInputsSpy).toHaveBeenCalled();
			});
			await waitFor(() => {
				const liveNodeIds = getCanvasNodeRenderItems(getLatestRenderTree()).map(
					(nodeItem) =>
						getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id,
				);
				expect(liveNodeIds).toEqual([]);
			});
			const containsBoardInput = setInputsSpy.mock.calls.some((call) => {
				const inputs = call[0] as Array<{ nodeId?: string }>;
				return inputs.some((input) => input.nodeId === "node-board-active");
			});
			expect(containsBoardInput).toBe(true);
		} finally {
			setInputsSpy.mockRestore();
		}
	});

	it("tile pipeline 不可用时非 active 节点不会走 live 渲染", async () => {
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					createTextNode("node-text", 0),
					createVideoNode("node-video", 1),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		const liveNodeIds = getCanvasNodeRenderItems(getLatestRenderTree()).map(
			(nodeItem) =>
				getElementProps<{ node?: { id: string } }>(nodeItem)?.node?.id,
		);
		expect(liveNodeIds).toEqual([]);
	});

	it("非 active 的 text/audio 会进入 tile picture 输入且不走 live", async () => {
		tilePipelineMockState.enabled = true;
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					createTextNode("node-text", 0),
					createAudioNode("node-audio", 1),
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				selectedNodeIds={[]}
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
			expect(liveNodeIds).toEqual([]);
		});
		expect(textTilePictureGenerateMock).toHaveBeenCalled();
		expect(renderNodeToPictureMock).toHaveBeenCalled();
	});

	it("text 节点会通过 node-system tilePicture capability 生成 tile 输入", async () => {
		tilePipelineMockState.enabled = true;
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[createTextNode("node-text", 0)]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(rootRenderSpy).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(textTilePictureGenerateMock).toHaveBeenCalled();
		});
		expect(renderNodeToPictureMock).not.toHaveBeenCalled();
		await waitFor(() => {
			const staticTileLayerProps = getElementProps<{
				drawItems?: Array<unknown>;
			}>(getStaticTileLayerElement(getLatestRenderTree()));
			expect(staticTileLayerProps?.drawItems?.length ?? 0).toBeGreaterThan(0);
		});
	});

	it("text 节点仅位置变化时不会重复生成 tile picture", async () => {
		tilePipelineMockState.enabled = true;
		textTilePictureSourceSignatureMock.mockImplementation(
			({ node }: { node: TextCanvasNode }) =>
				`${node.id}:${node.text}:${node.fontSize}:${Math.max(
					1,
					Math.round(Math.abs(node.width)),
				)}:${Math.max(1, Math.round(Math.abs(node.height)))}`,
		);
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const initialNode = createTextNode("node-text", 0, {
			x: 20,
			y: 30,
			updatedAt: 1,
		});
		const { rerender } = render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={camera}
				nodes={[initialNode]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(textTilePictureGenerateMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			const staticTileLayerProps = getElementProps<{
				drawItems?: Array<unknown>;
			}>(getStaticTileLayerElement(getLatestRenderTree()));
			expect(staticTileLayerProps?.drawItems?.length ?? 0).toBeGreaterThan(0);
		});

		rerender(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={camera}
				nodes={[
					{
						...initialNode,
						x: 220,
						y: 140,
						updatedAt: 2,
					},
				]}
				scenes={emptyScenes}
				assets={[]}
				activeNodeId={null}
				selectedNodeIds={[]}
				focusedNodeId={null}
			/>,
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(textTilePictureGenerateMock).toHaveBeenCalledTimes(1);
	});

	it("tilePicture 重算 pending 时会保留上一帧输入，避免闪烁", async () => {
		tilePipelineMockState.enabled = true;
		textTilePictureSourceSignatureMock.mockImplementation(
			({ node }: { node: TextCanvasNode }) =>
				`${node.id}:${Math.max(1, Math.round(Math.abs(node.width)))}:${Math.max(
					1,
					Math.round(Math.abs(node.height)),
				)}`,
		);
		const firstPictureDispose = vi.fn();
		const firstResultDispose = vi.fn();
		const secondPictureDispose = vi.fn();
		const secondResultDispose = vi.fn();
		const firstDeferred = createDeferred<{
			picture: { dispose: typeof firstPictureDispose };
			sourceWidth: number;
			sourceHeight: number;
			dispose: typeof firstResultDispose;
		}>();
		const secondDeferred = createDeferred<{
			picture: { dispose: typeof secondPictureDispose };
			sourceWidth: number;
			sourceHeight: number;
			dispose: typeof secondResultDispose;
		}>();
		let generateCount = 0;
		textTilePictureGenerateMock.mockImplementation(() => {
			if (generateCount === 0) {
				generateCount += 1;
				return firstDeferred.promise;
			}
			generateCount += 1;
			return secondDeferred.promise;
		});
		const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
		const initialNode = createTextNode("node-text", 0, {
			width: 240,
			height: 120,
			updatedAt: 1,
		});
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const { rerender } = render(
				<InfiniteSkiaCanvas
					width={128}
					height={128}
					camera={camera}
					nodes={[initialNode]}
					scenes={emptyScenes}
					assets={[]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
				/>,
			);
			await waitFor(() => {
				expect(textTilePictureGenerateMock).toHaveBeenCalledTimes(1);
			});
			await act(async () => {
				firstDeferred.resolve({
					picture: {
						dispose: firstPictureDispose,
					},
					sourceWidth: 240,
					sourceHeight: 120,
					dispose: firstResultDispose,
				});
				await Promise.resolve();
				await Promise.resolve();
			});
			await waitFor(() => {
				const hasNodeInput = setInputsSpy.mock.calls.some((call) => {
					const inputs = call[0] as Array<{ nodeId?: string }>;
					return inputs.some((input) => input.nodeId === "node-text");
				});
				expect(hasNodeInput).toBe(true);
			});
			const setInputsCountAfterFirstReady = setInputsSpy.mock.calls.length;

			rerender(
				<InfiniteSkiaCanvas
					width={128}
					height={128}
					camera={camera}
					nodes={[
						{
							...initialNode,
							width: 320,
							height: 160,
							updatedAt: 2,
						},
					]}
					scenes={emptyScenes}
					assets={[]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
				/>,
			);
			await waitFor(() => {
				expect(textTilePictureGenerateMock).toHaveBeenCalledTimes(2);
			});
			await waitFor(() => {
				expect(setInputsSpy.mock.calls.length).toBeGreaterThan(
					setInputsCountAfterFirstReady,
				);
			});
			const latestInputs = (setInputsSpy.mock.calls.at(-1)?.[0] ??
				[]) as Array<{ nodeId?: string }>;
			expect(latestInputs.some((input) => input.nodeId === "node-text")).toBe(
				true,
			);

			await act(async () => {
				secondDeferred.resolve({
					picture: {
						dispose: secondPictureDispose,
					},
					sourceWidth: 320,
					sourceHeight: 160,
					dispose: secondResultDispose,
				});
				await Promise.resolve();
				await Promise.resolve();
			});

			await waitFor(() => {
				expect(firstResultDispose).toHaveBeenCalledTimes(1);
				expect(firstPictureDispose).toHaveBeenCalledTimes(1);
			});
			expect(secondResultDispose).not.toHaveBeenCalled();
			expect(secondPictureDispose).not.toHaveBeenCalled();
		} finally {
			setInputsSpy.mockRestore();
		}
	});

	it("image 节点存在 legacy thumbnail 时仍只使用主 image asset", async () => {
		tilePipelineMockState.enabled = true;
		render(
			<InfiniteSkiaCanvas
				width={128}
				height={128}
				camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
				nodes={[
					createImageNode("node-image", 0, {
						assetId: "image-main",
						thumbnail: {
							assetId: "image-thumb",
							sourceSignature: "legacy-image-thumb",
							frame: 0,
							generatedAt: 1,
							version: 1 as const,
						},
					}),
				]}
				scenes={emptyScenes}
				assets={[
					createImageAsset("image-main"),
					createImageAsset("image-thumb"),
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
			expect(calledUris.some((uri) => uri.includes("image-main.png"))).toBe(
				true,
			);
			expect(calledUris.some((uri) => uri.includes("image-thumb.png"))).toBe(
				false,
			);
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

	it("active raster 节点 layout 变化会标记 tile 脏区", async () => {
		tilePipelineMockState.enabled = true;
		const dirtyUnionSpy = vi.spyOn(
			StaticTileScheduler.prototype,
			"markDirtyUnion",
		);
		try {
			const activeNodeId = "node-active";
			const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
			const { rerender } = render(
				<InfiniteSkiaCanvas
					width={256}
					height={256}
					camera={camera}
					nodes={[createVideoNode(activeNodeId, 0)]}
					scenes={emptyScenes}
					assets={[]}
					activeNodeId={activeNodeId}
					selectedNodeIds={[activeNodeId]}
					focusedNodeId={null}
				/>,
			);

			await waitFor(() => {
				expect(rootRenderSpy).toHaveBeenCalled();
			});
			dirtyUnionSpy.mockClear();

			rerender(
				<InfiniteSkiaCanvas
					width={256}
					height={256}
					camera={camera}
					nodes={[
						createVideoNode(activeNodeId, 0, {
							x: 180,
							y: 140,
							updatedAt: 2,
						}),
					]}
					scenes={emptyScenes}
					assets={[]}
					activeNodeId={activeNodeId}
					selectedNodeIds={[activeNodeId]}
					focusedNodeId={null}
				/>,
			);

			await waitFor(() => {
				expect(dirtyUnionSpy).toHaveBeenCalled();
			});
			const lastCall = dirtyUnionSpy.mock.calls.at(-1);
			expect(lastCall?.[1]).toMatchObject({
				left: 180,
				top: 140,
				right: 340,
				bottom: 230,
			});
		} finally {
			dirtyUnionSpy.mockRestore();
		}
	});

	it("tile 输入会使用当帧节点位置，不会滞后一帧", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const nodeId = "node-scene-latest-aabb";
			const camera = createCameraShared({ x: 0, y: 0, zoom: 1 });
			const { rerender } = render(
				<InfiniteSkiaCanvas
					width={256}
					height={256}
					camera={camera}
					nodes={[
						{
							...createSceneNode(nodeId, 0),
							thumbnail: {
								assetId: "scene-thumb-latest-aabb",
								sourceSignature: "scene-latest-aabb-v1",
								frame: 0,
								generatedAt: 1,
								version: 1 as const,
							},
						},
					]}
					scenes={emptyScenes}
					assets={[createImageAsset("scene-thumb-latest-aabb")]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
				/>,
			);

			await waitFor(() => {
				expect(setInputsSpy).toHaveBeenCalled();
			});
			setInputsSpy.mockClear();

			rerender(
				<InfiniteSkiaCanvas
					width={256}
					height={256}
					camera={camera}
					nodes={[
						{
							...createSceneNode(nodeId, 0),
							x: 180,
							y: 140,
							thumbnail: {
								assetId: "scene-thumb-latest-aabb",
								sourceSignature: "scene-latest-aabb-v1",
								frame: 0,
								generatedAt: 1,
								version: 1 as const,
							},
						},
					]}
					scenes={emptyScenes}
					assets={[createImageAsset("scene-thumb-latest-aabb")]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
				/>,
			);

			await waitFor(() => {
				expect(setInputsSpy).toHaveBeenCalled();
			});
			const lastCall = setInputsSpy.mock.calls.at(-1);
			const inputs = (lastCall?.[0] ?? []) as Array<{
				nodeId: string;
				aabb: {
					left: number;
					top: number;
					right: number;
					bottom: number;
				};
			}>;
			const targetInput = inputs.find((item) => item.nodeId === nodeId);
			expect(targetInput?.aabb).toMatchObject({
				left: 180,
				top: 140,
				right: 500,
				bottom: 320,
			});
		} finally {
			setInputsSpy.mockRestore();
		}
	});

	it("board 子节点 tile 输入带有裁剪后的可见边界和祖先裁剪链", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const childNode = createImageNode("node-image-clipped", 1, {
				parentId: "node-board",
				x: 80,
				y: 120,
				width: 160,
				height: 80,
			});
			render(
				<InfiniteSkiaCanvas
					width={256}
					height={256}
					camera={createCameraShared({ x: 0, y: 0, zoom: 1 })}
					nodes={[
						createBoardNode("node-board", 0, {
							x: 100,
							y: 100,
							width: 100,
							height: 100,
						}),
						childNode,
					]}
					scenes={emptyScenes}
					assets={[createImageAsset(childNode.assetId)]}
					activeNodeId={null}
					selectedNodeIds={[]}
					focusedNodeId={null}
				/>,
			);

			await waitFor(() => {
				const matchingInput = setInputsSpy.mock.calls
					.flatMap((call) => call[0] as TileInput[])
					.find(
						(input) =>
							input.nodeId === "node-image-clipped" && input.visibleAabb,
					);
				expect(matchingInput?.visibleAabb).toMatchObject({
					left: 100,
					top: 120,
					right: 200,
					bottom: 200,
					width: 100,
					height: 80,
				});
				expect(matchingInput?.clipAabbs).toEqual([
					expect.objectContaining({
						left: 100,
						top: 100,
						right: 200,
						bottom: 200,
						width: 100,
						height: 100,
					}),
				]);
			});
		} finally {
			setInputsSpy.mockRestore();
		}
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
			expect(calledUris.some((uri) => uri.includes("scene-thumb-a.png"))).toBe(
				true,
			);
			expect(calledUris.some((uri) => uri.includes("scene-thumb-b.png"))).toBe(
				true,
			);
		});
	});

	it("auto layout 动画节点渲染 frozen layer 时不会进入 live layer 和静态 tile 输入", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const animatedNode = createImageNode("node-image-animated-layout", 0);
			const baseProps = {
				width: 128,
				height: 128,
				camera: createCameraShared({ x: 0, y: 0, zoom: 1 }),
				nodes: [animatedNode],
				scenes: emptyScenes,
				assets: [createImageAsset(animatedNode.assetId)],
				activeNodeId: null,
				selectedNodeIds: [],
				focusedNodeId: null,
			};
			const { rerender } = render(<InfiniteSkiaCanvas {...baseProps} />);

			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(true);
			});

			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					animatedLayoutNodeIds={[animatedNode.id]}
				/>,
			);

			await waitFor(() => {
				expect(getLiveRenderedNodeIds(getLatestRenderTree())).not.toContain(
					animatedNode.id,
				);
				expect(getFrozenRenderedNodeIds(getLatestRenderTree())).toContain(
					animatedNode.id,
				);
			});
			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(false);
			});
		} finally {
			setInputsSpy.mockRestore();
		}
	});

	it("auto layout 动画节点复用已加载 tile cache，避免 live renderer 重新加载闪烁", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		const releaseMock = vi.fn();
		const image = {
			id: "cached-image",
			width: 256,
			height: 144,
			dispose: vi.fn(),
		};
		acquireImageAssetMock.mockResolvedValue({
			asset: { image },
			release: releaseMock,
		});
		try {
			const animatedNode = createImageNode("node-image-animated-layout", 0);
			const baseProps = {
				width: 128,
				height: 128,
				camera: createCameraShared({ x: 0, y: 0, zoom: 1 }),
				nodes: [animatedNode],
				scenes: emptyScenes,
				assets: [createImageAsset(animatedNode.assetId)],
				activeNodeId: null,
				selectedNodeIds: [],
				focusedNodeId: null,
			};
			const { rerender } = render(<InfiniteSkiaCanvas {...baseProps} />);

			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(true);
			});
			expect(acquireImageAssetMock).toHaveBeenCalledTimes(1);

			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					activeNodeId={animatedNode.id}
					selectedNodeIds={[animatedNode.id]}
				/>,
			);
			await waitFor(() => {
				expect(getLiveRenderedNodeIds(getLatestRenderTree())).toContain(
					animatedNode.id,
				);
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(false);
			});

			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					activeNodeId={animatedNode.id}
					selectedNodeIds={[animatedNode.id]}
					animatedLayoutNodeIds={[animatedNode.id]}
				/>,
			);

			await waitFor(() => {
				expect(getFrozenRenderedNodeIds(getLatestRenderTree())).toContain(
					animatedNode.id,
				);
				expect(getLiveRenderedNodeIds(getLatestRenderTree())).not.toContain(
					animatedNode.id,
				);
			});
			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(false);
			});
			expect(acquireImageAssetMock).toHaveBeenCalledTimes(1);
			expect(releaseMock).not.toHaveBeenCalled();
		} finally {
			setInputsSpy.mockRestore();
		}
	});

	it("auto layout frozen snapshot 从 tile 裁剪时会使用真实纹理像素尺寸", async () => {
		tilePipelineMockState.enabled = true;
		skiaSurfaceMockState.defaultPixelRatio = 2;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		const tileImage = {
			width: vi.fn(() => 768),
			height: vi.fn(() => 768),
			dispose: vi.fn(),
		};
		const beginFrameSpy = vi
			.spyOn(StaticTileScheduler.prototype, "beginFrame")
			.mockReturnValue({
				...createEmptyTileFrameResult(),
				drawItems: [
					{
						key: 1,
						lod: 0,
						sourceLod: 0,
						tx: 0,
						ty: 0,
						left: 0,
						top: 0,
						size: 512,
						image: tileImage as unknown as TileDrawItem["image"],
					},
				],
			});
		try {
			const animatedNode = createImageNode("node-image-dpr-layout", 0, {
				x: 128,
				y: 64,
				width: 160,
				height: 80,
			});
			const baseProps = {
				width: 512,
				height: 512,
				camera: createCameraShared({ x: 0, y: 0, zoom: 1 }),
				nodes: [animatedNode],
				scenes: emptyScenes,
				assets: [createImageAsset(animatedNode.assetId)],
				activeNodeId: null,
				selectedNodeIds: [],
				focusedNodeId: null,
			};
			const { rerender } = render(<InfiniteSkiaCanvas {...baseProps} />);

			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === animatedNode.id),
				).toBe(true);
			});

			skiaSurfaceMockState.surfaces.length = 0;
			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					animatedLayoutNodeIds={[animatedNode.id]}
				/>,
			);

			await waitFor(() => {
				expect(getFrozenRenderedNodeIds(getLatestRenderTree())).toContain(
					animatedNode.id,
				);
			});
			const snapshotSurface = skiaSurfaceMockState.surfaces.find(
				(surface) => surface.pixelRatio === 2,
			);
			expect(snapshotSurface).toBeTruthy();
			const drawCall = snapshotSurface?.canvas.drawImageRect.mock.calls[0];
			expect(drawCall).toBeTruthy();
			const sourceRect = drawCall?.[1] as
				| { x: number; y: number; width: number; height: number }
				| undefined;
			const bleed = (512 / 384) * 0.5;
			const drawSize = 512 + bleed * 2;
			expect(sourceRect?.x).toBeCloseTo(
				((animatedNode.x + bleed) / drawSize) * 768,
			);
			expect(sourceRect?.y).toBeCloseTo(
				((animatedNode.y + bleed) / drawSize) * 768,
			);
			expect(sourceRect?.width).toBeCloseTo(
				(animatedNode.width / drawSize) * 768,
			);
			expect(sourceRect?.height).toBeCloseTo(
				(animatedNode.height / drawSize) * 768,
			);
		} finally {
			setInputsSpy.mockRestore();
			beginFrameSpy.mockRestore();
		}
	});

	it("auto layout frozen board snapshot 不会从合成 tile 裁出 children", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		const tileImage = {
			width: vi.fn(() => 384),
			height: vi.fn(() => 384),
			dispose: vi.fn(),
		};
		const beginFrameSpy = vi
			.spyOn(StaticTileScheduler.prototype, "beginFrame")
			.mockReturnValue({
				...createEmptyTileFrameResult(),
				drawItems: [
					{
						key: 1,
						lod: 0,
						sourceLod: 0,
						tx: 0,
						ty: 0,
						left: 0,
						top: 0,
						size: 512,
						image: tileImage as unknown as TileDrawItem["image"],
					},
				],
			});
		try {
			const boardNode = createBoardNode("node-board-animated-layout", 0, {
				x: 0,
				y: 0,
				width: 320,
				height: 180,
			});
			const childNode = createTextNode("node-board-child", 1, {
				parentId: boardNode.id,
				x: 64,
				y: 64,
				width: 120,
				height: 60,
			});
			const baseProps = {
				width: 512,
				height: 512,
				camera: createCameraShared({ x: 0, y: 0, zoom: 1 }),
				nodes: [boardNode, childNode],
				scenes: emptyScenes,
				assets: [],
				activeNodeId: null,
				selectedNodeIds: [],
				focusedNodeId: null,
			};
			const { rerender } = render(<InfiniteSkiaCanvas {...baseProps} />);

			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === boardNode.id),
				).toBe(true);
			});

			skiaSurfaceMockState.surfaces.length = 0;
			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					animatedLayoutNodeIds={[boardNode.id]}
				/>,
			);

			await waitFor(() => {
				expect(getFrozenRenderedNodeIds(getLatestRenderTree())).toContain(
					boardNode.id,
				);
			});
			expect(
				skiaSurfaceMockState.surfaces.some((surface) =>
					surface.canvas.drawImageRect.mock.calls.some((call) => {
						return call[0] === tileImage;
					}),
				),
			).toBe(false);
			expect(
				skiaSurfaceMockState.surfaces.some((surface) => {
					return surface.canvas.drawPicture.mock.calls.length > 0;
				}),
			).toBe(true);
		} finally {
			setInputsSpy.mockRestore();
			beginFrameSpy.mockRestore();
		}
	});

	it("auto layout 动画中的 scene 节点不会进入 live renderer", async () => {
		tilePipelineMockState.enabled = true;
		const setInputsSpy = vi.spyOn(StaticTileScheduler.prototype, "setInputs");
		try {
			const sceneNode = {
				...createSceneNode("node-scene-animated-layout", 0),
				thumbnail: {
					assetId: "scene-thumb-auto-layout",
					sourceSignature: "scene-auto-layout-v1",
					frame: 0,
					generatedAt: 1,
					version: 1 as const,
				},
			};
			const baseProps = {
				width: 128,
				height: 128,
				camera: createCameraShared({ x: 0, y: 0, zoom: 1 }),
				nodes: [sceneNode],
				scenes: emptyScenes,
				assets: [createImageAsset("scene-thumb-auto-layout")],
				activeNodeId: null,
				selectedNodeIds: [],
				focusedNodeId: null,
			};
			const { rerender } = render(<InfiniteSkiaCanvas {...baseProps} />);

			await waitFor(() => {
				const latestInputs =
					(setInputsSpy.mock.calls.at(-1)?.[0] as TileInput[] | undefined) ??
					[];
				expect(
					latestInputs.some((input) => input.nodeId === sceneNode.id),
				).toBe(true);
			});

			rerender(
				<InfiniteSkiaCanvas
					{...baseProps}
					activeNodeId={sceneNode.id}
					selectedNodeIds={[sceneNode.id]}
					animatedLayoutNodeIds={[sceneNode.id]}
				/>,
			);

			await waitFor(() => {
				const tree = getLatestRenderTree();
				expect(getFrozenRenderedNodeIds(tree)).toContain(sceneNode.id);
				expect(getLiveRenderedNodeIds(tree)).not.toContain(sceneNode.id);
			});
		} finally {
			setInputsSpy.mockRestore();
		}
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
