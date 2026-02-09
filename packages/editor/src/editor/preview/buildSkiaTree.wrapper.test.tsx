import React from "react";
import type { TimelineElement, TransformMeta } from "core/dsl/types";
import type { TimelineTrack } from "core/editor/timeline/types";
import {
	buildSkiaRenderStateCore,
	type BuildSkiaDeps,
} from "core/editor/preview/buildSkiaTree";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	const Group = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement("group", rest, children as React.ReactNode);
	};
	const Fill = (props: Record<string, unknown>) => {
		const { children, ...rest } = props;
		return ReactModule.createElement("fill", rest, children as React.ReactNode);
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
		Skia,
	};
});

const PlainRenderer: React.FC<{ id: string }> = ({ id }) => {
	return <div data-testid={`plain-${id}`} />;
};

const FilterRenderer: React.FC<{ id: string }> = ({ id }) => {
	return <div data-testid={`filter-${id}`} />;
};

const TransitionRenderer: React.FC<{
	id: string;
	fromNode?: React.ReactNode;
	toNode?: React.ReactNode;
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
		if (componentId === "filter/test") {
			return { Renderer: FilterRenderer };
		}
		if (componentId === "transition/test") {
			return { Renderer: TransitionRenderer };
		}
		return undefined;
	},
	renderNodeToPicture: async () => null,
	isTransitionElement: (element) => element.type === "Transition",
};

const tracks: TimelineTrack[] = [
	{ id: "main", role: "clip", hidden: false, locked: false, muted: false, solo: false },
	{ id: "track-1", role: "effect", hidden: false, locked: false, muted: false, solo: false },
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

const createTransform = (partial: Partial<TransformMeta> = {}): TransformMeta => ({
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
			},
			deps,
		);

		const contentNode = children[1];
		expect(isElement(contentNode)).toBe(true);
		if (!isElement(contentNode)) return;
		expect(contentNode.props.opacity).toBeCloseTo(0.4);

		const transformGroups = collectElements(
			contentNode,
			(candidate) => Boolean(candidate.props.matrix),
		);
		expect(transformGroups.length).toBeGreaterThanOrEqual(1);

		const matrix = transformGroups[0].props.matrix as {
			__ops?: Array<Record<string, number | string>>;
		};
		const matrixOps = matrix.__ops ?? [];
		expect(matrixOps.length).toBe(6);
		expect(matrixOps[0]).toEqual({ type: "translate", x: 300, y: 400 });
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

		const renderedChildren = children.slice(1).filter(Boolean);
		const transitionNode = renderedChildren.find(
			(node) => isElement(node) && node.type === TransitionRenderer,
		);
		const filterNode = renderedChildren.find(
			(node) => isElement(node) && node.type === FilterRenderer,
		);

		expect(transitionNode).toBeTruthy();
		expect(filterNode).toBeTruthy();

		if (!isElement(transitionNode)) return;
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
});
