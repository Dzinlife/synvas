import { describe, expect, it, vi } from "vitest";
import { makeMutable } from "../src/animation/runtime";
import { NodeType } from "../src/dom/types";
import type { Node } from "../src/sksg/Node";
import { SkiaPointerEventManager } from "../src/sksg/PointerEvents";

const createHostElement = () => {
	return {
		style: {
			cursor: "",
		},
		getBoundingClientRect: () => ({
			left: 0,
			top: 0,
		}),
	} as unknown as HTMLElement;
};

const createPointerEvent = (clientX: number, clientY: number) => {
	const event = {
		button: 0,
		buttons: 0,
		clientX,
		clientY,
		pointerId: 1,
		pointerType: "mouse",
		pressure: 0,
		timeStamp: 0,
		detail: 1,
		cancelable: true,
		defaultPrevented: false,
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		metaKey: false,
		stopPropagation: vi.fn(),
		preventDefault() {
			event.defaultPrevented = true;
		},
	};
	return event as unknown as PointerEvent;
};

describe("SkiaPointerEventManager shared geometry hit testing", () => {
	it("supports shared hitRect on group nodes", () => {
		const onPointerEnter = vi.fn();
		const onClick = vi.fn();
		const rootNodes: Node[] = [
			{
				type: NodeType.Group,
				props: {
					hitRect: makeMutable({
						x: 12,
						y: 16,
						width: 120,
						height: 80,
					}),
					onPointerEnter,
					onClick,
				},
				children: [
					{
						type: NodeType.Picture,
						props: {},
						children: [],
					},
				],
			},
		];
		const manager = new SkiaPointerEventManager(() => rootNodes);
		const hostElement = createHostElement();

		manager.dispatch("pointermove", createPointerEvent(40, 48), hostElement);
		manager.dispatch("click", createPointerEvent(40, 48), hostElement);

		expect(onPointerEnter).toHaveBeenCalledTimes(1);
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
