// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { CanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeInteractionWrapper } from "./NodeInteractionWrapper";

const { mockDragPointerDown } = vi.hoisted(() => ({
	mockDragPointerDown: vi.fn(),
}));

vi.mock("@use-gesture/react", () => ({
	useDrag: (handler: (state: Record<string, unknown>) => void) => {
		return () => ({
			onPointerDown: (event: Record<string, unknown>) => {
				mockDragPointerDown(event);
				const clientX = Number(event.clientX ?? 0);
				const clientY = Number(event.clientY ?? 0);
				const baseEvent = {
					clientX,
					clientY,
					button: Number(event.button ?? 0),
					buttons: Number(event.buttons ?? 1),
					shiftKey: Boolean(event.shiftKey),
					altKey: Boolean(event.altKey),
					metaKey: Boolean(event.metaKey),
					ctrlKey: Boolean(event.ctrlKey),
				};
				handler({
					first: true,
					last: false,
					tap: false,
					movement: [0, 0],
					xy: [clientX, clientY],
					event: baseEvent,
				});
				handler({
					first: false,
					last: false,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						...baseEvent,
						clientX: clientX + 12,
						clientY: clientY + 8,
					},
				});
				handler({
					first: false,
					last: true,
					tap: false,
					movement: [12, 8],
					xy: [clientX + 12, clientY + 8],
					event: {
						...baseEvent,
						clientX: clientX + 12,
						clientY: clientY + 8,
						buttons: 0,
					},
				});
			},
		});
	},
}));

vi.mock("react-skia-lite", () => ({
	Group: ({
		children,
		onPointerDown,
		onPointerEnter,
		onPointerLeave,
		onClick,
		onDoubleClick,
		...props
	}: {
		children?: React.ReactNode;
		onPointerDown?: unknown;
		onPointerEnter?: unknown;
		onPointerLeave?: unknown;
		onClick?: unknown;
		onDoubleClick?: unknown;
		[key: string]: unknown;
	}) => (
		<div
			data-testid="group"
			data-props={JSON.stringify(props)}
			data-has-on-pointer-down={String(typeof onPointerDown === "function")}
			data-has-on-pointer-enter={String(typeof onPointerEnter === "function")}
			data-has-on-pointer-leave={String(typeof onPointerLeave === "function")}
			data-has-on-click={String(typeof onClick === "function")}
			data-has-on-double-click={String(typeof onDoubleClick === "function")}
			onPointerDown={onPointerDown as React.PointerEventHandler<HTMLDivElement>}
			onPointerEnter={onPointerEnter as React.PointerEventHandler<HTMLDivElement>}
			onPointerLeave={onPointerLeave as React.PointerEventHandler<HTMLDivElement>}
			onClick={onClick as React.MouseEventHandler<HTMLDivElement>}
			onDoubleClick={onDoubleClick as React.MouseEventHandler<HTMLDivElement>}
		>
			{children}
		</div>
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
				isSelected={false}
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
				isSelected={false}
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
				isSelected={true}
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
				isSelected={false}
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
				isSelected={true}
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
				isSelected={false}
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
		expect(group.getAttribute("data-has-on-double-click")).toBe("true");
	});

	it("拖拽事件会透传修饰键和指针坐标", async () => {
		const onDragStart = vi.fn();
		const onDrag = vi.fn();
		const onDragEnd = vi.fn();
		render(
			<NodeInteractionWrapper
				node={createSceneNode()}
				isActive={false}
				isSelected={true}
				isDimmed={false}
				isHovered={false}
				cameraZoom={1}
				onPointerEnter={vi.fn()}
				onPointerLeave={vi.fn()}
				onDragStart={onDragStart}
				onDrag={onDrag}
				onDragEnd={onDragEnd}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);

		screen.getByTestId("group").dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				clientX: 24,
				clientY: 36,
				button: 0,
				buttons: 1,
				shiftKey: true,
				altKey: true,
				metaKey: true,
				ctrlKey: true,
			}),
		);

		expect(onDragStart).toHaveBeenCalledTimes(1);
		expect(onDrag).toHaveBeenCalledTimes(2);
		expect(onDragEnd).toHaveBeenCalledTimes(1);
		expect(onDragStart.mock.calls[0]?.[1]).toMatchObject({
			clientX: 24,
			clientY: 36,
			shiftKey: true,
			altKey: true,
			metaKey: true,
			ctrlKey: true,
			movementX: 0,
			movementY: 0,
			first: true,
			last: false,
		});
		expect(onDragEnd.mock.calls[0]?.[1]).toMatchObject({
			clientX: 36,
			clientY: 44,
			shiftKey: true,
			altKey: true,
			metaKey: true,
			ctrlKey: true,
			movementX: 12,
			movementY: 8,
			last: true,
		});
	});
});
