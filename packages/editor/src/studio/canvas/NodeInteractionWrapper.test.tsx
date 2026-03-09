// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeInteractionWrapper } from "./NodeInteractionWrapper";

const { mockDragPointerDown } = vi.hoisted(() => ({
	mockDragPointerDown: vi.fn(),
}));

vi.mock("@use-gesture/react", () => ({
	useDrag: () => {
		return () => ({
			onPointerDown: mockDragPointerDown,
		});
	},
}));

vi.mock("react-skia-lite", () => ({
	Group: ({
		children,
		onClick,
		onPointerDown,
		onPointerEnter,
		onPointerLeave,
		onDoubleClick,
		...props
	}: {
		children?: React.ReactNode;
		onClick?: (event: unknown) => void;
		onPointerDown?: unknown;
		onPointerEnter?: unknown;
		onPointerLeave?: unknown;
		onDoubleClick?: unknown;
		[key: string]: unknown;
	}) => (
		<button
			type="button"
			data-testid="group"
			data-props={JSON.stringify(props)}
			data-has-on-pointer-down={String(typeof onPointerDown === "function")}
			data-has-on-pointer-enter={String(typeof onPointerEnter === "function")}
			data-has-on-pointer-leave={String(typeof onPointerLeave === "function")}
			data-has-on-click={String(typeof onClick === "function")}
			data-has-on-double-click={String(typeof onDoubleClick === "function")}
			onClick={onClick}
		>
			{children}
		</button>
	),
	Rect: (props: Record<string, unknown>) => (
		<div data-testid="rect" data-props={JSON.stringify(props)} />
	),
}));

const createSceneNode = (id = "node-1"): CanvasNode => ({
	id,
	type: "scene",
	name: "Scene",
	x: 20,
	y: 10,
	width: 100,
	height: 50,
	zIndex: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
});

const parseRectProps = (): Record<string, unknown> => {
	const rect = screen.getByTestId("rect");
	const serialized = rect.getAttribute("data-props");
	if (!serialized) {
		throw new Error("Rect props 不存在");
	}
	return JSON.parse(serialized) as Record<string, unknown>;
};

describe("NodeInteractionWrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		cleanup();
	});

	it("cameraZoom=2 时 default/hover/active 线宽按像素补偿", () => {
		const node = createSceneNode();
		const onPointerEnter = vi.fn();
		const onPointerLeave = vi.fn();
		const onClick = vi.fn();
		const onDoubleClick = vi.fn();
		const onDrag = vi.fn();

		const { rerender } = render(
			<NodeInteractionWrapper
				node={node}
				isActive={false}
				isDimmed={false}
				isHovered={false}
				cameraZoom={2}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				onDrag={onDrag}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);

		expect(parseRectProps().strokeWidth).toBe(0.5);

		rerender(
			<NodeInteractionWrapper
				node={node}
				isActive={false}
				isDimmed={false}
				isHovered={true}
				cameraZoom={2}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				onDrag={onDrag}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);
		expect(parseRectProps().strokeWidth).toBe(1);

		rerender(
			<NodeInteractionWrapper
				node={node}
				isActive={true}
				isDimmed={false}
				isHovered={false}
				cameraZoom={2}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				onDrag={onDrag}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);
		expect(parseRectProps().strokeWidth).toBe(1);
	});

	it("cameraZoom=0.5 时 default 与 active/hover 线宽放大", () => {
		const node = createSceneNode();
		const onPointerEnter = vi.fn();
		const onPointerLeave = vi.fn();

		const { rerender } = render(
			<NodeInteractionWrapper
				node={node}
				isActive={false}
				isDimmed={false}
				isHovered={false}
				cameraZoom={0.5}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);
		expect(parseRectProps().strokeWidth).toBe(2);

		rerender(
			<NodeInteractionWrapper
				node={node}
				isActive={true}
				isDimmed={false}
				isHovered={false}
				cameraZoom={0.5}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);
		expect(parseRectProps().strokeWidth).toBe(4);
	});

	it("showBorder=false 时不渲染描边且交互事件仍绑定", () => {
		render(
			<NodeInteractionWrapper
				node={createSceneNode()}
				isActive={false}
				isDimmed={false}
				isHovered={false}
				cameraZoom={1}
				showBorder={false}
				onPointerEnter={vi.fn()}
				onPointerLeave={vi.fn()}
				onClick={vi.fn()}
				onDoubleClick={vi.fn()}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);

		expect(screen.queryByTestId("rect")).toBeNull();
		const group = screen.getByTestId("group");
		expect(group.getAttribute("data-has-on-pointer-down")).toBe("true");
		expect(group.getAttribute("data-has-on-pointer-enter")).toBe("true");
		expect(group.getAttribute("data-has-on-pointer-leave")).toBe("true");
		expect(group.getAttribute("data-has-on-click")).toBe("true");
		expect(group.getAttribute("data-has-on-double-click")).toBe("false");
	});

	it("通过 click 定时器窗口识别双击", () => {
		vi.useFakeTimers();
		try {
			const onClick = vi.fn();
			const onDoubleClick = vi.fn();

			render(
				<NodeInteractionWrapper
					node={createSceneNode()}
					isActive={false}
					isDimmed={false}
					isHovered={false}
					cameraZoom={1}
					onPointerEnter={vi.fn()}
					onPointerLeave={vi.fn()}
					onClick={onClick}
					onDoubleClick={onDoubleClick}
				>
					<div data-testid="child" />
				</NodeInteractionWrapper>,
			);

			const group = screen.getByTestId("group");
			fireEvent.click(group, {
				clientX: 120,
				clientY: 80,
				timeStamp: 1000,
			});
			fireEvent.click(group, {
				clientX: 123,
				clientY: 83,
				timeStamp: 1200,
			});

			expect(onClick).toHaveBeenCalledTimes(2);
			expect(onDoubleClick).toHaveBeenCalledTimes(1);
		} finally {
			vi.runOnlyPendingTimers();
			vi.useRealTimers();
		}
	});
});
