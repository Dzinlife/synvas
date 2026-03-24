import {
	type BuildSkiaDeps,
	buildSkiaFrameSnapshotCore,
	buildSkiaRenderStateCore,
} from "core/editor/preview/buildSkiaTree";
import type { TimelineTrack } from "core/editor/timeline/types";
import type { TimelineElement, TransformMeta } from "core/element/types";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSkiaRenderBackendMock } = vi.hoisted(() => ({
	getSkiaRenderBackendMock: vi.fn(),
}));

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	const Group = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement(
			"group",
			rest,
			children as React.ReactNode,
		);
	};
	const Fill = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement("fill", rest, children as React.ReactNode);
	};
	const Picture = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement(
			"picture",
			rest,
			children as React.ReactNode,
		);
	};
	const RenderTarget = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement(
			"render-target",
			rest,
			children as React.ReactNode,
		);
	};
	const Skia = {
		Matrix: () => {
			const ops: Array<Record<string, number | string>> = [];
			const matrix = {
				__ops: ops,
				translate: (x: number, y: number) => {
					ops.push({ type: "translate", x, y });
					return matrix;
				},
				rotate: (value: number) => {
					ops.push({ type: "rotate", value });
					return matrix;
				},
				scale: (x: number, y?: number) => {
					ops.push({ type: "scale", x, y: y ?? x });
					return matrix;
				},
			};
			return matrix;
		},
	};
	return {
		Group,
		Fill,
		Picture,
		RenderTarget,
		Skia,
		getSkiaRenderBackend: getSkiaRenderBackendMock,
	};
});

beforeEach(() => {
	getSkiaRenderBackendMock.mockReset();
	getSkiaRenderBackendMock.mockReturnValue({
		bundle: "webgl",
		kind: "webgl",
	});
});

const PlainRenderer: React.FC<{ id: string }> = ({ id }) => {
	return <div data-testid={`plain-${id}`} />;
};

const FilterRenderer: React.FC<{ id: string }> = ({ id }) => {
	return <div data-testid={`filter-${id}`} />;
};

const VideoRenderer: React.FC<{
	id: string;
	__frameChannel?: string;
	__disableRuntimePlaybackEffects?: boolean;
}> = ({ id, __frameChannel, __disableRuntimePlaybackEffects }) => {
	return (
		<div
			data-testid={`video-${id}`}
			data-frame-channel={__frameChannel}
			data-disable-runtime-effects={
				__disableRuntimePlaybackEffects ? "true" : "false"
			}
		/>
	);
};

const TransitionRenderer: React.FC<{
	id: string;
	fromNode?: React.ReactNode;
	toNode?: React.ReactNode;
	fromImage?: unknown;
	toImage?: unknown;
	progress?: number;
}> = ({ id, fromNode, toNode }) => {
	return (
		<div data-testid={`transition-${id}`}>
			{fromNode}
			{toNode}
		</div>
	);
};

const deps: BuildSkiaDeps = {
	resolveComponent: (componentId) => {
		if (componentId === "image") {
			return { Renderer: PlainRenderer };
		}
		if (componentId === "audio-clip") {
			return { Renderer: PlainRenderer };
		}
		if (componentId === "video-clip") {
			return { Renderer: VideoRenderer };
		}
		if (componentId === "filter/test") {
			return { Renderer: FilterRenderer };
		}
		if (componentId === "transition/test") {
			return {
				Renderer: TransitionRenderer,
				transitionInputMode: "texture",
			};
		}
		if (componentId === "transition/node") {
			return {
				Renderer: TransitionRenderer,
				transitionInputMode: "node",
			};
		}
		return undefined;
	},
	renderNodeToPicture: async () => null,
	isTransitionElement: (element) => element.type === "Transition",
};

const tracks: TimelineTrack[] = [
	{
		id: "main",
		role: "clip",
		hidden: false,
		locked: false,
		muted: false,
		solo: false,
	},
	{
		id: "track-1",
		role: "effect",
		hidden: false,
		locked: false,
		muted: false,
		solo: false,
	},
];

const getTrackIndexForElement = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const sortByTrackIndex = (elements: TimelineElement[]) => {
	return elements
		.map((element, index) => ({
			element,
			index,
			trackIndex: getTrackIndexForElement(element),
		}))
		.sort((a, b) => {
			if (a.trackIndex !== b.trackIndex) {
				return a.trackIndex - b.trackIndex;
			}
			return a.index - b.index;
		})
		.map((item) => item.element);
};

const createTransform = (
	partial: Partial<TransformMeta> = {},
): TransformMeta => ({
	baseSize: { width: 200, height: 100 },
	position: { x: 100, y: 60, space: "canvas" },
	anchor: { x: 0.5, y: 0.5, space: "normalized" },
	scale: { x: 1, y: 1 },
	rotation: { value: 0, unit: "deg" },
	distort: { type: "none" },
	...partial,
});

const createElement = (
	partial: Partial<TimelineElement> & {
		id: string;
		type: TimelineElement["type"];
		component: string;
	},
): TimelineElement => ({
	id: partial.id,
	type: partial.type,
	component: partial.component,
	name: partial.name ?? partial.id,
	transform: partial.transform ?? createTransform(),
	timeline:
		partial.timeline ??
		({
			start: 0,
			end: 60,
			startTimecode: "00:00:00:00",
			endTimecode: "00:00:02:00",
			trackIndex: 0,
			trackId: "main",
			role: "clip",
		} satisfies TimelineElement["timeline"]),
	render: partial.render,
	props: partial.props ?? {},
	transition: partial.transition,
});

const createDeferred = () => {
	let resolve!: () => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

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

const isFrameRenderTargetElement = (node: React.ReactNode): node is AnyElement => {
	if (!isElement(node)) {
		return false;
	}
	const props = node.props as {
		debugLabel?: unknown;
		width?: unknown;
		height?: unknown;
	};
	return (
		props.debugLabel === "frame-root-webgpu-backdrop" &&
		typeof props.width === "number" &&
		typeof props.height === "number"
	);
};

const extractFrameChildren = (children: React.ReactNode[]) => {
	if (children.length !== 1) {
		return children;
	}
	const [rootNode] = children;
	if (!isFrameRenderTargetElement(rootNode)) {
		return children;
	}
	const nestedChildren = rootNode.props.children as React.ReactNode;
	if (Array.isArray(nestedChildren)) {
		return nestedChildren;
	}
	return nestedChildren ? [nestedChildren] : [];
};

describe("buildSkiaTree transform wrapper", () => {
	it("为普通元素套用统一 transform wrapper 并应用 opacity", async () => {
		const element = createElement({
			id: "clip-a",
			type: "Image",
			component: "image",
			transform: createTransform({
				baseSize: { width: 200, height: 100 },
				position: { x: 300, y: 400, space: "canvas" },
				anchor: { x: 0.25, y: 0.75, space: "normalized" },
				scale: { x: -1, y: 0.5 },
				rotation: { value: 30, unit: "deg" },
			}),
			render: {
				opacity: 0.4,
			},
		});

		const { children } = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				},
			},
			deps,
		);

		const contentNode = children[1];
		expect(isElement(contentNode)).toBe(true);
		if (!isElement(contentNode)) return;
		expect(contentNode.props.opacity).toBeCloseTo(0.4);

		const transformGroups = collectElements(contentNode, (candidate) =>
			Boolean(candidate.props.matrix),
		);
		expect(transformGroups.length).toBeGreaterThanOrEqual(1);

		const matrix = transformGroups[0].props.matrix as {
			__ops?: Array<Record<string, number | string>>;
		};
		const matrixOps = matrix.__ops ?? [];
		expect(matrixOps.length).toBe(6);
		expect(matrixOps[0]).toEqual({ type: "translate", x: 1260, y: 140 });
		expect(matrixOps[1]).toEqual({ type: "translate", x: 50, y: -25 });
		expect(matrixOps[2]?.type).toBe("rotate");
		expect(matrixOps[2]?.value).toBeCloseTo(Math.PI / 6, 6);
		expect(matrixOps[3]).toEqual({ type: "scale", x: -1, y: 0.5 });
		expect(matrixOps[4]).toEqual({ type: "translate", x: -50, y: 25 });
		expect(matrixOps[5]).toEqual({ type: "translate", x: -100, y: -50 });
	});

	it("Transition 与 Filter 主节点不套 transform wrapper，转场输入节点保留 wrapper", async () => {
		const clipA = createElement({
			id: "clip-a",
			type: "Image",
			component: "image",
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const clipB = createElement({
			id: "clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 30,
				end: 60,
				startTimecode: "00:00:01:00",
				endTimecode: "00:00:02:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const transition = createElement({
			id: "transition-1",
			type: "Transition",
			component: "transition/test",
			timeline: {
				start: 15,
				end: 45,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 30,
				fromId: "clip-a",
				toId: "clip-b",
			},
		});
		const filter = createElement({
			id: "filter-1",
			type: "Filter",
			component: "filter/test",
			timeline: {
				start: 0,
				end: 60,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:02:00",
				trackIndex: 1,
				trackId: "track-1",
				role: "effect",
			},
		});

		const { children } = await buildSkiaRenderStateCore(
			{
				elements: [clipA, clipB, transition, filter],
				displayTime: 20,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
			},
			deps,
		);

		const renderedChildren = extractFrameChildren(children).slice(1).filter(Boolean);
		const transitionNode = renderedChildren.find(
			(node) => isElement(node) && node.type === TransitionRenderer,
		);
		const filterNode = renderedChildren.find(
			(node) => isElement(node) && node.type === FilterRenderer,
		);

		expect(transitionNode).toBeTruthy();
		expect(filterNode).toBeTruthy();

		if (!isElement(transitionNode)) return;
		expect(transitionNode.props.progress).toBeCloseTo((20 - 15) / 30, 6);
		const fromTransforms = collectElements(
			transitionNode.props.fromNode,
			(candidate) => Boolean(candidate.props.matrix),
		);
		const toTransforms = collectElements(
			transitionNode.props.toNode,
			(candidate) => Boolean(candidate.props.matrix),
		);
		expect(fromTransforms.length).toBeGreaterThan(0);
		expect(toTransforms.length).toBeGreaterThan(0);
	});

	it("Transition 输入包含 Composition 时会构建 Composition 画面", async () => {
		const composition = createElement({
			id: "composition-1",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-2" },
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const clipB = createElement({
			id: "clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 30,
				end: 60,
				startTimecode: "00:00:01:00",
				endTimecode: "00:00:02:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const transition = createElement({
			id: "transition-1",
			type: "Transition",
			component: "transition/test",
			timeline: {
				start: 15,
				end: 45,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 30,
				fromId: "composition-1",
				toId: "clip-b",
			},
		});
		const childClip = createElement({
			id: "child-clip-1",
			type: "Image",
			component: "image",
		});
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async () => ({ dispose: vi.fn() }) as any),
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-2") return null;
				return {
					sceneId,
					elements: [childClip],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition, clipB, transition],
				displayTime: 20,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
			},
			localDeps,
		);

		const renderedChildren = extractFrameChildren(renderState.children)
			.slice(1)
			.filter(Boolean);
		const transitionNode = renderedChildren.find(
			(node) => isElement(node) && node.type === TransitionRenderer,
		);
		expect(transitionNode).toBeTruthy();
		if (!isElement(transitionNode)) return;
		expect(transitionNode.props.fromNode).toBeTruthy();
		const compositionPictureNodes = collectElements(
			transitionNode.props.fromNode,
			(node) => "picture" in node.props,
		);
		expect(compositionPictureNodes.length).toBeGreaterThan(0);
		renderState.dispose?.();
	});

	it("WebGPU 下会统一注入根级 RenderTarget", async () => {
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const clip = createElement({
			id: "clip-webgpu-rt",
			type: "Image",
			component: "image",
		});

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [clip],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				},
			},
			deps,
		);

		expect(renderState.children).toHaveLength(1);
		const rootNode = renderState.children[0];
		expect(isFrameRenderTargetElement(rootNode)).toBe(true);
		if (!isFrameRenderTargetElement(rootNode)) return;
		expect(rootNode.props.width).toBe(1920);
		expect(rootNode.props.height).toBe(1080);
		expect(rootNode.props.debugLabel).toBe("frame-root-webgpu-backdrop");

		renderState.dispose?.();
	});

	it("WebGL 下不会注入根级 RenderTarget", async () => {
		const clip = createElement({
			id: "clip-webgl-no-rt",
			type: "Image",
			component: "image",
		});

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [clip],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				},
			},
			deps,
		);

		expect(renderState.children).toHaveLength(2);
		const rootNode = renderState.children[0];
		expect(isElement(rootNode)).toBe(true);
		if (!isElement(rootNode)) return;
		expect(rootNode.props.color).toBe("black");
		expect(rootNode.props.debugLabel).toBeUndefined();

		renderState.dispose?.();
	});

	it("WebGPU texture transition 也会走 picture 录制", async () => {
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const clipA = createElement({
			id: "clip-a",
			type: "Image",
			component: "image",
		});
		const clipB = createElement({
			id: "clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 30,
				end: 60,
				startTimecode: "00:00:01:00",
				endTimecode: "00:00:02:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const transition = createElement({
			id: "transition-live-texture",
			type: "Transition",
			component: "transition/test",
			timeline: {
				start: 15,
				end: 45,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 30,
				fromId: "clip-a",
				toId: "clip-b",
			},
		});
		const renderNodeToImage = vi
			.fn()
			.mockResolvedValueOnce({ id: "from-image", dispose: vi.fn() } as any)
			.mockResolvedValueOnce({ id: "to-image", dispose: vi.fn() } as any);
		const renderNodeToPicture = vi
			.fn()
			.mockResolvedValueOnce({ id: "from-picture", dispose: vi.fn() } as any)
			.mockResolvedValueOnce({ id: "to-picture", dispose: vi.fn() } as any);
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToImage,
			renderNodeToPicture,
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [clipA, clipB, transition],
				displayTime: 20,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					prepareTransitionPictures: true,
				},
			},
			localDeps,
		);

		const renderedChildren = extractFrameChildren(renderState.children)
			.slice(1)
			.filter(Boolean);
		const transitionNode = renderedChildren.find(
			(node) => isElement(node) && node.type === TransitionRenderer,
		);

		expect(renderNodeToImage).not.toHaveBeenCalled();
		expect(renderNodeToPicture).toHaveBeenCalledTimes(2);
		expect(transitionNode).toBeTruthy();
		if (!isElement(transitionNode)) return;
		expect(transitionNode.props.fromImage).toBeUndefined();
		expect(transitionNode.props.toImage).toBeUndefined();
		expect(transitionNode.props.fromPicture).toBeTruthy();
		expect(transitionNode.props.toPicture).toBeTruthy();

		renderState.dispose?.();
	});

	it("node transition 即使开启转场预生成也不会额外生成纹理", async () => {
		const clipA = createElement({
			id: "clip-a",
			type: "Image",
			component: "image",
		});
		const clipB = createElement({
			id: "clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 30,
				end: 60,
				startTimecode: "00:00:01:00",
				endTimecode: "00:00:02:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const transition = createElement({
			id: "transition-live-node",
			type: "Transition",
			component: "transition/node",
			timeline: {
				start: 15,
				end: 45,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 30,
				fromId: "clip-a",
				toId: "clip-b",
			},
		});
		const renderNodeToImage = vi.fn();
		const renderNodeToPicture = vi.fn();
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToImage,
			renderNodeToPicture,
		};

		await buildSkiaRenderStateCore(
			{
				elements: [clipA, clipB, transition],
				displayTime: 20,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					prepareTransitionPictures: true,
				},
			},
			localDeps,
		);

		expect(renderNodeToImage).not.toHaveBeenCalled();
		expect(renderNodeToPicture).not.toHaveBeenCalled();
	});

	it("Composition 子场景的 Transition progress 跟随子场景 displayTime", async () => {
		const composition = createElement({
			id: "composition-child-transition",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-with-transition" },
		});
		const childClipA = createElement({
			id: "child-clip-a",
			type: "Image",
			component: "image",
			timeline: {
				start: 0,
				end: 15,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:00:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const childClipB = createElement({
			id: "child-clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 15,
				end: 30,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const childTransition = createElement({
			id: "child-transition",
			type: "Transition",
			component: "transition/test",
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 15,
				fromId: "child-clip-a",
				toId: "child-clip-b",
			},
		});
		const capturedProgress: number[] = [];
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async (node) => {
				const transitionNodes = collectElements(
					node,
					(candidate) => candidate.type === TransitionRenderer,
				);
				for (const transitionNode of transitionNodes) {
					const value = transitionNode.props.progress;
					if (typeof value === "number" && Number.isFinite(value)) {
						capturedProgress.push(value);
					}
				}
				return { dispose: vi.fn() } as any;
			}),
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-with-transition") return null;
				return {
					sceneId,
					elements: [childClipA, childClipB, childTransition],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					compositionPath: ["scene-root"],
				},
			},
			localDeps,
		);

		expect(capturedProgress.some((value) => Math.abs(value - 10 / 30) < 1e-9)).toBe(
			true,
		);
		renderState.dispose?.();
	});

	it("render.visible=false 的元素不会进入渲染结果", async () => {
		const visibleElement = createElement({
			id: "visible-element",
			type: "Image",
			component: "image",
		});
		const hiddenElement = createElement({
			id: "hidden-element",
			type: "Image",
			component: "image",
			render: {
				visible: false,
			},
		});

		const { children, orderedElements } = await buildSkiaRenderStateCore(
			{
				elements: [visibleElement, hiddenElement],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
			},
			deps,
		);

		expect(orderedElements.map((item) => item.id)).toEqual(["visible-element"]);

		const plainNodes = collectElements(
			children,
			(node) => node.type === PlainRenderer,
		);
		expect(plainNodes.length).toBe(1);
	});

	it("offscreen frameChannel 会透传到 VideoClip renderer", async () => {
		const element = createElement({
			id: "video-1",
			type: "VideoClip",
			component: "video-clip",
		});

		const { children } = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					forcePrepareFrames: true,
					frameChannel: "offscreen",
				},
			},
			deps,
		);

		const videoNodes = collectElements(
			children,
			(node) => node.type === VideoRenderer,
		);
		expect(videoNodes.length).toBe(1);
		expect(videoNodes[0]?.props.__frameChannel).toBe("offscreen");
		expect(videoNodes[0]?.props.__disableRuntimePlaybackEffects).toBe(true);
	});

	it("Composition 会递归构建子 scene picture 并进入当前帧", async () => {
		const composition = createElement({
			id: "composition-1",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-2" },
			transform: createTransform({
				baseSize: { width: 1920, height: 1080 },
			}),
		});
		const childClip = createElement({
			id: "child-clip-1",
			type: "Image",
			component: "image",
		});
		const childWrapSpy = vi.fn((node: React.ReactNode) => node);
		const childPictureDispose = vi.fn();
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async () => {
				return { dispose: childPictureDispose } as any;
			}),
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-2") return null;
				return {
					sceneId,
					elements: [childClip],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					wrapRenderNode: childWrapSpy,
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					compositionPath: ["scene-1"],
				},
			},
			localDeps,
		);

		const pictureNodes = collectElements(
			renderState.children,
			(node) => "picture" in node.props,
		);
		expect(pictureNodes.length).toBeGreaterThan(0);
		expect(pictureNodes[0]?.props.picture).toBeTruthy();
		expect(childWrapSpy).toHaveBeenCalled();

		renderState.dispose?.();
		expect(childPictureDispose).toHaveBeenCalledTimes(1);
	});

	it("WebGPU Composition 也会递归构建子 scene picture", async () => {
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		const composition = createElement({
			id: "composition-live",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-live" },
			transform: createTransform({
				baseSize: { width: 1920, height: 1080 },
			}),
		});
		const childClip = createElement({
			id: "child-live-clip",
			type: "Image",
			component: "image",
		});
		const childWrapSpy = vi.fn((node: React.ReactNode) => node);
		const renderNodeToPicture = vi.fn(async () => ({ dispose: vi.fn() }) as any);
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture,
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-live") return null;
				return {
					sceneId,
					elements: [childClip],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					wrapRenderNode: childWrapSpy,
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					compositionPath: ["scene-root"],
				},
			},
			localDeps,
		);

		const pictureNodes = collectElements(
			renderState.children,
			(node) => "picture" in node.props,
		);
		expect(pictureNodes.length).toBeGreaterThan(0);
		expect(renderNodeToPicture).toHaveBeenCalled();
		expect(childWrapSpy).toHaveBeenCalled();

		renderState.dispose?.();
	});

	it("Composition 计算子场景时间时会叠加 offset", async () => {
		const composition = createElement({
			id: "composition-offset",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-offset" },
			timeline: {
				start: 10,
				end: 80,
				startTimecode: "00:00:00:10",
				endTimecode: "00:00:02:20",
				offset: 15,
				trackIndex: 0,
				role: "clip",
			},
		});
		const childVideo = createElement({
			id: "child-video-offset",
			type: "VideoClip",
			component: "video-clip",
		});
		const prepareRenderFrame = vi.fn(async () => undefined);
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async () => ({ dispose: vi.fn() }) as any),
			resolveComponent: (componentId) => {
				if (componentId === "video-clip") {
					return {
						Renderer: VideoRenderer,
						prepareRenderFrame,
					};
				}
				return deps.resolveComponent(componentId);
			},
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-offset") return null;
				return {
					sceneId,
					elements: [childVideo],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 25,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					forcePrepareFrames: true,
					compositionPath: ["scene-root"],
				},
			},
			localDeps,
		);
		await renderState.ready;
		expect(prepareRenderFrame).toHaveBeenCalledWith(
			expect.objectContaining({
				displayTime: 30,
				frameChannel: "offscreen",
			}),
		);
		renderState.dispose?.();
	});

	it("Composition 子树 prepareRenderFrame 使用 offscreen frameChannel", async () => {
		const composition = createElement({
			id: "composition-prepare-channel",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-child" },
		});
		const childVideo = createElement({
			id: "child-video",
			type: "VideoClip",
			component: "video-clip",
		});
		const prepareRenderFrame = vi.fn(async () => undefined);
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async () => ({ dispose: vi.fn() }) as any),
			resolveComponent: (componentId) => {
				if (componentId === "video-clip") {
					return {
						Renderer: VideoRenderer,
						prepareRenderFrame,
					};
				}
				return deps.resolveComponent(componentId);
			},
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-child") return null;
				return {
					sceneId,
					elements: [childVideo],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				};
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					forcePrepareFrames: true,
					compositionPath: ["scene-root"],
				},
			},
			localDeps,
		);
		await renderState.ready;
		expect(prepareRenderFrame).toHaveBeenCalled();
		expect(prepareRenderFrame).toHaveBeenCalledWith(
			expect.objectContaining({
				frameChannel: "offscreen",
			}),
		);
		renderState.dispose?.();
	});

	it("Composition 循环引用会被跳过，避免递归死循环", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const composition = createElement({
			id: "composition-root",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-2" },
		});
		const nestedCycle = createElement({
			id: "composition-cycle",
			type: "Composition",
			component: "composition",
			props: { sceneId: "scene-1" },
		});
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi.fn(async () => ({ dispose: vi.fn() }) as any),
			resolveCompositionTimeline: (sceneId) => {
				if (sceneId !== "scene-2") return null;
				return {
					sceneId,
					elements: [nestedCycle],
					tracks,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
				};
			},
		};

		await buildSkiaRenderStateCore(
			{
				elements: [composition],
				displayTime: 10,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					compositionPath: ["scene-1"],
				},
			},
			localDeps,
		);

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("awaitReady 会等待 model.waitForReady 完成", async () => {
		const element = createElement({
			id: "ready-image",
			type: "Image",
			component: "image",
		});
		const deferred = createDeferred();
		const waitForReady = vi.fn(() => deferred.promise);
		const modelStore = {
			getState: () => ({
				waitForReady,
			}),
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					awaitReady: true,
					getModelStore: (id) =>
						id === element.id ? (modelStore as any) : undefined,
				},
			},
			deps,
		);

		let readyResolved = false;
		void renderState.ready.then(() => {
			readyResolved = true;
		});
		await Promise.resolve();

		expect(waitForReady).toHaveBeenCalledTimes(1);
		expect(readyResolved).toBe(false);

		deferred.resolve();
		await renderState.ready;
		expect(readyResolved).toBe(true);
	});

	it("awaitReady 不会被缺失 waitForReady 的组件阻塞", async () => {
		const element = createElement({
			id: "audio-clip-1",
			type: "AudioClip",
			component: "audio-clip",
		});
		const modelStore = {
			getState: () => ({}),
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					awaitReady: true,
					getModelStore: (id) =>
						id === element.id ? (modelStore as any) : undefined,
				},
			},
			deps,
		);

		await expect(renderState.ready).resolves.toBeUndefined();
	});

	it("prepareRenderFrame 会在 waitForReady 之后执行", async () => {
		const element = createElement({
			id: "video-like-element",
			type: "Image",
			component: "image",
		});
		const deferred = createDeferred();
		const waitForReady = vi.fn(() => deferred.promise);
		const prepareRenderFrame = vi.fn(async () => undefined);
		const modelStore = {
			getState: () => ({
				waitForReady,
			}),
		};
		const localDeps: BuildSkiaDeps = {
			...deps,
			resolveComponent: (componentId) => {
				if (componentId === "image") {
					return {
						Renderer: PlainRenderer,
						prepareRenderFrame,
					};
				}
				return deps.resolveComponent(componentId);
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					forcePrepareFrames: true,
					awaitReady: true,
					getModelStore: (id) =>
						id === element.id ? (modelStore as any) : undefined,
				},
			},
			localDeps,
		);

		await Promise.resolve();
		expect(waitForReady).toHaveBeenCalledTimes(1);
		expect(prepareRenderFrame).not.toHaveBeenCalled();

		deferred.resolve();
		await renderState.ready;
		expect(prepareRenderFrame).toHaveBeenCalledTimes(1);
	});

	it("forcePrepareFrames 会等待 prepareRenderFrame 完成，即使 awaitReady=false", async () => {
		const element = createElement({
			id: "force-prepare-element",
			type: "Image",
			component: "image",
		});
		const deferred = createDeferred();
		const prepareRenderFrame = vi.fn(() => deferred.promise);
		const localDeps: BuildSkiaDeps = {
			...deps,
			resolveComponent: (componentId) => {
				if (componentId === "image") {
					return {
						Renderer: PlainRenderer,
						prepareRenderFrame,
					};
				}
				return deps.resolveComponent(componentId);
			},
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					forcePrepareFrames: true,
					awaitReady: false,
				},
			},
			localDeps,
		);

		let readyResolved = false;
		void renderState.ready.then(() => {
			readyResolved = true;
		});
		await Promise.resolve();

		expect(prepareRenderFrame).toHaveBeenCalledTimes(1);
		expect(readyResolved).toBe(false);

		deferred.resolve();
		await renderState.ready;
		expect(readyResolved).toBe(true);
	});

	it("waitForReady 失败时 ready 会直接失败，不会挂起", async () => {
		const element = createElement({
			id: "ready-failed-element",
			type: "Image",
			component: "image",
		});
		const modelStore = {
			getState: () => ({
				waitForReady: () => Promise.reject(new Error("waitForReady failed")),
			}),
		};

		const renderState = await buildSkiaRenderStateCore(
			{
				elements: [element],
				displayTime: 0,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					awaitReady: true,
					getModelStore: (id) =>
						id === element.id ? (modelStore as any) : undefined,
				},
			},
			deps,
		);

		await expect(renderState.ready).rejects.toThrow("waitForReady failed");
	});

	it("统一 dispose 会同时释放整帧 picture 与 transition pictures", async () => {
		const clipA = createElement({
			id: "clip-a",
			type: "Image",
			component: "image",
			timeline: {
				start: 0,
				end: 30,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:01:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const clipB = createElement({
			id: "clip-b",
			type: "Image",
			component: "image",
			timeline: {
				start: 30,
				end: 60,
				startTimecode: "00:00:01:00",
				endTimecode: "00:00:02:00",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
		});
		const transition = createElement({
			id: "transition-1",
			type: "Transition",
			component: "transition/test",
			timeline: {
				start: 15,
				end: 45,
				startTimecode: "00:00:00:15",
				endTimecode: "00:00:01:15",
				trackIndex: 0,
				trackId: "main",
				role: "clip",
			},
			transition: {
				duration: 30,
				boundry: 30,
				fromId: "clip-a",
				toId: "clip-b",
			},
		});

		const fromDispose = vi.fn();
		const toDispose = vi.fn();
		const frameDispose = vi.fn();
		const localDeps: BuildSkiaDeps = {
			...deps,
			renderNodeToPicture: vi
				.fn()
				.mockResolvedValueOnce({ dispose: fromDispose } as any)
				.mockResolvedValueOnce({ dispose: toDispose } as any)
				.mockResolvedValueOnce({ dispose: frameDispose } as any),
		};

		const frameSnapshot = await buildSkiaFrameSnapshotCore(
			{
				elements: [clipA, clipB, transition],
				displayTime: 20,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: false,
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					prepareTransitionPictures: true,
					forcePrepareFrames: true,
					awaitReady: true,
				},
			},
			localDeps,
		);

		frameSnapshot.dispose?.();
		frameSnapshot.dispose?.();

		expect(fromDispose).toHaveBeenCalledTimes(1);
		expect(toDispose).toHaveBeenCalledTimes(1);
		expect(frameDispose).toHaveBeenCalledTimes(1);
	});
});
