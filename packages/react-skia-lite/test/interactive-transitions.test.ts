import { describe, expect, it, vi } from "vitest";
import { withTiming } from "../src/animation/runtime";
import { NodeType } from "../src/dom/types";
import {
	prepareInteractiveTransitionProps,
	setNodeActiveState,
	setNodeHoverState,
} from "../src/sksg/InteractiveTransitions";
import type { Node } from "../src/sksg/Node";
import { StaticContainer } from "../src/sksg/StaticContainer";
import { installRafStub } from "./testUtils";

const { flushFrame } = installRafStub();

const advanceFrames = (count: number, deltaMs = 16) => {
	for (let index = 0; index < count; index += 1) {
		flushFrame(deltaMs);
	}
};

class TestStaticContainer extends StaticContainer {
	rebuildCount = 0;
	presentCount = 0;

	override rebuildRecording() {
		this.rebuildCount += 1;
		super.rebuildRecording();
	}

	override present() {
		this.presentCount += 1;
	}
}

const createNode = (props: Record<string, unknown>): Node => {
	return {
		type: NodeType.Group,
		props,
		children: [],
	};
};

describe("InteractiveTransitions motion runtime", () => {
	it("applies active > hover > animate priority", () => {
		const container = new TestStaticContainer({} as never, -1);
		const node = createNode({
			opacity: 0.2,
			motion: {
				animate: {
					opacity: withTiming(0.4, { duration: 32 }),
				},
				hover: {
					opacity: withTiming(0.6, { duration: 32 }),
				},
				active: {
					opacity: withTiming(0.8, { duration: 32 }),
				},
			},
		});
		node.props = prepareInteractiveTransitionProps({
			node,
			previousNode: null,
			props: node.props as Record<string, unknown>,
			container,
		});

		container.root = [node];
		container.redraw();
		const opacity = node.props.opacity as {
			value: number;
		};

		advanceFrames(3, 16);
		expect(opacity.value).toBeCloseTo(0.4, 2);

		setNodeHoverState(node, true);
		advanceFrames(3, 16);
		expect(opacity.value).toBeCloseTo(0.6, 2);

		setNodeActiveState(node, true);
		advanceFrames(3, 16);
		expect(opacity.value).toBeCloseTo(0.8, 2);

		setNodeActiveState(node, false);
		advanceFrames(3, 16);
		expect(opacity.value).toBeCloseTo(0.6, 2);

		setNodeHoverState(node, false);
		advanceFrames(3, 16);
		expect(opacity.value).toBeCloseTo(0.4, 2);

		expect(container.rebuildCount).toBe(1);
		expect(container.presentCount).toBeGreaterThan(1);
	});

	it("does not restart the same active descriptor across commits", () => {
		const container = new TestStaticContainer({} as never, -1);
		const callback = vi.fn();
		const createProps = () => ({
			translateX: 0,
			motion: {
				animate: {
					translateX: withTiming(10, { duration: 64 }, callback),
				},
			},
		});

		const firstNode = createNode(createProps());
		firstNode.props = prepareInteractiveTransitionProps({
			node: firstNode,
			previousNode: null,
			props: firstNode.props as Record<string, unknown>,
			container,
		});
		container.root = [firstNode];
		container.redraw();

		advanceFrames(2, 16);
		const firstValue = (firstNode.props.translateX as { value: number }).value;

		const secondNode = createNode(createProps());
		secondNode.props = prepareInteractiveTransitionProps({
			node: secondNode,
			previousNode: firstNode,
			props: secondNode.props as Record<string, unknown>,
		});
		container.root = [secondNode];
		container.redraw();

		const secondShared = secondNode.props.translateX as { value: number };
		expect(secondShared.value).toBeCloseTo(firstValue, 4);

		advanceFrames(5, 16);

		expect(secondShared.value).toBeCloseTo(10, 2);
		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenLastCalledWith(true, expect.any(Number));
	});

	it("stops present updates when motion node leaves the tree", () => {
		const container = new TestStaticContainer({} as never, -1);
		const node = createNode({
			translateX: 0,
			motion: {
				animate: {
					translateX: withTiming(100, { duration: 200 }),
				},
			},
		});
		node.props = prepareInteractiveTransitionProps({
			node,
			previousNode: null,
			props: node.props as Record<string, unknown>,
			container,
		});

		container.root = [node];
		container.redraw();
		advanceFrames(2, 16);
		expect(container.presentCount).toBeGreaterThan(1);

		container.root = [];
		container.redraw();
		const presentCountAfterRemoval = container.presentCount;

		advanceFrames(4, 32);

		expect(container.presentCount).toBe(presentCountAfterRemoval);
	});

	it("silently drops removed legacy props", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const container = new TestStaticContainer({} as never, -1);
		const node = createNode({
			opacity: 0.5,
			transition: { duration: 120, easing: "easeOutCubic" },
			animate: { opacity: 1 },
			whileHover: { opacity: 0.8 },
			whileActive: { opacity: 0.6 },
		});
		const nextProps = prepareInteractiveTransitionProps({
			node,
			previousNode: null,
			props: node.props as Record<string, unknown>,
			container,
		});

		expect(nextProps.transition).toBeUndefined();
		expect(nextProps.animate).toBeUndefined();
		expect(nextProps.whileHover).toBeUndefined();
		expect(nextProps.whileActive).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
	});
});
