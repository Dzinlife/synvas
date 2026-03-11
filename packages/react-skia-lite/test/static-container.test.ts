import { describe, expect, it } from "vitest";
import { makeMutable } from "../src/animation/runtime";
import { NodeType } from "../src/dom/types";
import { StaticContainer } from "../src/sksg/StaticContainer";
import { installRafStub } from "./testUtils";

const { flushFrame } = installRafStub();

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

describe("StaticContainer shared value integration", () => {
	it("rebuilds recording once and only presents on animation frames", () => {
		const translateX = makeMutable(0);
		const container = new TestStaticContainer({} as never, -1);
		container.root = [
			{
				type: NodeType.Group,
				props: {},
				children: [
					{
						type: NodeType.Circle,
						props: {
							cx: translateX,
							cy: 0,
							r: 10,
						},
						children: [],
					},
				],
			},
		];

		container.redraw();
		expect(container.rebuildCount).toBe(1);
		expect(container.presentCount).toBe(1);

		translateX.value = 20;
		flushFrame(16);
		expect(container.rebuildCount).toBe(1);
		expect(container.presentCount).toBe(2);

		translateX.value = 30;
		translateX.value = 40;
		flushFrame(16);
		expect(container.rebuildCount).toBe(1);
		expect(container.presentCount).toBe(3);
	});

	it("cleans listeners when animated props leave the tree or container unmounts", () => {
		const translateX = makeMutable(0);
		const container = new TestStaticContainer({} as never, -1);
		container.root = [
			{
				type: NodeType.Circle,
				props: {
					cx: translateX,
					cy: 0,
					r: 10,
				},
				children: [],
			},
		];

		container.redraw();
		expect(container.presentCount).toBe(1);

		container.root = [
			{
				type: NodeType.Circle,
				props: {
					cx: 5,
					cy: 0,
					r: 10,
				},
				children: [],
			},
		];
		container.redraw();
		expect(container.rebuildCount).toBe(2);
		expect(container.presentCount).toBe(2);

		translateX.value = 10;
		flushFrame(16);
		expect(container.presentCount).toBe(2);

		container.unmount();
		translateX.value = 12;
		flushFrame(16);
		expect(container.presentCount).toBe(2);
	});
});
