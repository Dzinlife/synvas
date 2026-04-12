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
	useDerivedValue: <T,>(updater: () => T) => ({
		value: updater(),
		_isSharedValue: true as const,
	}),
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
	Rect: (props: Record<string, unknown>) => {
		const resolveSharedProp = (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"value" in value
			) {
				return (value as { value: unknown }).value;
			}
			return value;
		};
		const normalizedProps = {
			...props,
			width: resolveSharedProp(props.width),
			height: resolveSharedProp(props.height),
		};
		return (
			<div data-testid="rect" data-props={JSON.stringify(normalizedProps)} />
		);
	},
}));

const createSceneNode = (id = "node-1"): CanvasNode => ({
	id,
	type: "scene",
	name: "Scene",
	x: 20,
	y: 10,
	width: 100,
	height: 50,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	sceneId: "scene-1",
});

const getRectPropsList = (): Array<Record<string, unknown>> => {
	return screen.getAllByTestId("rect").map((rect) => {
		const serialized = rect.getAttribute("data-props");
		if (!serialized) {
			throw new Error("Rect props 不存在");
		}
		return JSON.parse(serialized) as Record<string, unknown>;
	});
};

describe("NodeInteractionWrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		cleanup();
	});

	it("会渲染透明命中面并保留 children", () => {
		render(
			<NodeInteractionWrapper
				node={createSceneNode()}
				onPointerEnter={vi.fn()}
				onPointerLeave={vi.fn()}
				onClick={vi.fn()}
				onDoubleClick={vi.fn()}
			>
				<div data-testid="child" />
			</NodeInteractionWrapper>,
		);

		expect(getRectPropsList()).toEqual([
			expect.objectContaining({
				width: 100,
				height: 50,
				color: "rgba(255,255,255,0.001)",
			}),
		]);
		expect(screen.getByTestId("child")).toBeTruthy();
		const group = screen.getByTestId("group");
		expect(group.getAttribute("data-has-on-pointer-down")).toBe("true");
		expect(group.getAttribute("data-has-on-pointer-enter")).toBe("true");
		expect(group.getAttribute("data-has-on-pointer-leave")).toBe("true");
		expect(group.getAttribute("data-has-on-click")).toBe("true");
		expect(group.getAttribute("data-has-on-double-click")).toBe("true");
	});

	it("disabled=true 时不会绑定交互事件", () => {
		const onPointerEnter = vi.fn();
		const onPointerLeave = vi.fn();
		const onClick = vi.fn();
		const onDoubleClick = vi.fn();
		const onDragStart = vi.fn();
		render(
			<NodeInteractionWrapper
				node={createSceneNode()}
				disabled
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				onDragStart={onDragStart}
			/>,
		);

		const group = screen.getByTestId("group");
		expect(group.getAttribute("data-has-on-pointer-down")).toBe("false");
		expect(group.getAttribute("data-has-on-pointer-enter")).toBe("false");
		expect(group.getAttribute("data-has-on-pointer-leave")).toBe("false");
		expect(group.getAttribute("data-has-on-click")).toBe("false");
		expect(group.getAttribute("data-has-on-double-click")).toBe("false");

		fireEvent.pointerDown(group, {
			button: 0,
			buttons: 1,
			clientX: 10,
			clientY: 12,
		});
		expect(onDragStart).not.toHaveBeenCalled();
		expect(onPointerEnter).not.toHaveBeenCalled();
		expect(onPointerLeave).not.toHaveBeenCalled();
		expect(onClick).not.toHaveBeenCalled();
		expect(onDoubleClick).not.toHaveBeenCalled();
	});

	it("拖拽事件会透传修饰键和指针坐标", () => {
		const onDragStart = vi.fn();
		const onDrag = vi.fn();
		const onDragEnd = vi.fn();
		render(
			<NodeInteractionWrapper
				node={createSceneNode()}
				onDragStart={onDragStart}
				onDrag={onDrag}
				onDragEnd={onDragEnd}
			/>,
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

	it("pointer/click 事件会透传 node 与事件元信息", () => {
		const node = createSceneNode("node-click");
		const onPointerEnter = vi.fn();
		const onPointerLeave = vi.fn();
		const onClick = vi.fn();
		const onDoubleClick = vi.fn();
		render(
			<NodeInteractionWrapper
				node={node}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
			/>,
		);

		const group = screen.getByTestId("group");
		fireEvent.pointerEnter(group);
		fireEvent.pointerLeave(group);
		fireEvent.click(group, {
			button: 0,
			buttons: 1,
			clientX: 120,
			clientY: 80,
			shiftKey: true,
		});
		fireEvent.doubleClick(group, {
			button: 0,
			buttons: 1,
			clientX: 130,
			clientY: 90,
			altKey: true,
		});

		expect(onPointerEnter).toHaveBeenCalledWith("node-click");
		expect(onPointerLeave).toHaveBeenCalledWith("node-click");
		expect(onClick).toHaveBeenCalledWith(
			node,
			expect.objectContaining({
				clientX: 120,
				clientY: 80,
				button: 0,
				buttons: 1,
				shiftKey: true,
			}),
		);
		expect(onDoubleClick).toHaveBeenCalledWith(
			node,
			expect.objectContaining({
				clientX: 130,
				clientY: 90,
				button: 0,
				buttons: 1,
				altKey: true,
			}),
		);
	});
});
