// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HdrTestCanvasNode } from "@/studio/project/types";
import { HdrTestNodeInspector } from "./inspector";

const createNode = (
	overrides: Partial<HdrTestCanvasNode> = {},
): HdrTestCanvasNode => ({
	id: "node-hdr-test",
	type: "hdr-test",
	name: "HDR Test",
	x: 0,
	y: 0,
	width: 560,
	height: 320,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	colorPreset: "hdr-white",
	brightness: 2,
	...overrides,
});

describe("HdrTestNodeInspector", () => {
	it("修改色彩预设和亮度时会更新 node", () => {
		const updateNode = vi.fn();
		render(
			<HdrTestNodeInspector
				node={createNode()}
				scene={null}
				asset={null}
				isFocused={false}
				updateNode={updateNode}
				setFocusedNode={vi.fn()}
				setActiveScene={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByTestId("hdr-test-color-select"), {
			target: { value: "hdr-red" },
		});
		fireEvent.change(screen.getByTestId("hdr-test-brightness-input"), {
			target: { value: "3.2" },
		});

		expect(updateNode).toHaveBeenCalledWith({ colorPreset: "hdr-red" });
		expect(updateNode).toHaveBeenCalledWith({ brightness: 3.2 });
	});
});
