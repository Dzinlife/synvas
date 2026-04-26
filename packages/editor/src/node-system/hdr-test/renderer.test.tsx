// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { HdrTestCanvasNode } from "@/studio/project/types";
import { HdrTestNodeSkiaRenderer } from "./renderer";

vi.mock("react-skia-lite", () => ({
	Rect: ({
		children,
		...props
	}: Record<string, unknown> & { children?: React.ReactNode }) => (
		<div data-testid="hdr-test-rect" data-props={JSON.stringify(props)}>
			{children}
		</div>
	),
	Shader: (props: Record<string, unknown>) => (
		<div data-testid="hdr-test-shader" data-props={JSON.stringify(props)} />
	),
	Skia: {
		RuntimeEffect: {
			Make: vi.fn(() => ({ id: "hdr-effect" })),
		},
	},
}));

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

describe("HdrTestNodeSkiaRenderer", () => {
	it("使用 RuntimeEffect Shader 绘制 HDR 测试图", () => {
		render(
			<HdrTestNodeSkiaRenderer
				node={createNode({ colorPreset: "hdr-red", brightness: 3 })}
				scene={null}
				asset={null}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		const shader = screen.getByTestId("hdr-test-shader");
		expect(shader.getAttribute("data-props")).toContain('"brightness":3');
		expect(shader.getAttribute("data-props")).toContain('"preset":3');
	});
});
