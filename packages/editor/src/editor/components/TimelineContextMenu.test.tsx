// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TimelineContextMenu, { type TimelineContextMenuAction } from "./TimelineContextMenu";

describe("TimelineContextMenu", () => {
	it("单层菜单项点击会触发 onSelect 并关闭菜单", () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		const actions: TimelineContextMenuAction[] = [
			{
				key: "copy",
				label: "复制",
				onSelect,
			},
		];

		const rendered = render(
			<TimelineContextMenu
				open
				x={100}
				y={120}
				actions={actions}
				onClose={onClose}
			/>,
		);

		fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});

	it("二级菜单项点击会触发子项 onSelect 并关闭菜单", async () => {
		const parentSelect = vi.fn();
		const childSelect = vi.fn();
		const onClose = vi.fn();
		const actions: TimelineContextMenuAction[] = [
			{
				key: "insert-scene",
				label: "插入到 Scene",
				onSelect: parentSelect,
				children: [
					{
						key: "scene-1",
						label: "Scene 1",
						onSelect: childSelect,
					},
				],
			},
		];

		const rendered = render(
			<TimelineContextMenu
				open
				x={100}
				y={120}
				actions={actions}
				onClose={onClose}
			/>,
		);

		fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /插入到 Scene/ }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Scene 1" }));

		expect(parentSelect).not.toHaveBeenCalled();
		expect(childSelect).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});
});
