import { describe, expect, it } from "vitest";
import { resolveCanvasOverlayLayout } from "./canvasOverlayLayout";

describe("resolveCanvasOverlayLayout", () => {
	it("左侧栏展开时 drawer 左偏移应包含 sidebar 与 gap", () => {
		const layout = resolveCanvasOverlayLayout({
			containerWidth: 1440,
			containerHeight: 900,
			sidebarExpanded: true,
			drawerVisible: true,
			drawerHeight: 320,
			rightPanelVisible: true,
		});
		expect(layout.sidebarRect).toEqual({
			x: 12,
			y: 12,
			width: 288,
			height: 876,
		});
		expect(layout.drawerRect).toEqual({
			x: 312,
			y: 568,
			width: 1116,
			height: 320,
		});
		expect(layout.cameraSafeInsets).toEqual({
			top: 12,
			left: 312,
			right: 344,
			bottom: 344,
		});
	});

	it("左侧栏收起时 drawer 应从最左侧开始", () => {
		const layout = resolveCanvasOverlayLayout({
			containerWidth: 1440,
			containerHeight: 900,
			sidebarExpanded: false,
			drawerVisible: true,
			drawerHeight: 320,
			rightPanelVisible: true,
		});
		expect(layout.drawerRect.x).toBe(12);
		expect(layout.drawerRect.width).toBe(1416);
		expect(layout.cameraSafeInsets.left).toBe(12);
	});

	it("右侧面板高度应随 drawer 高度变化", () => {
		const withDrawer = resolveCanvasOverlayLayout({
			containerWidth: 1440,
			containerHeight: 900,
			sidebarExpanded: true,
			drawerVisible: true,
			drawerHeight: 320,
			rightPanelVisible: true,
		});
		const withoutDrawer = resolveCanvasOverlayLayout({
			containerWidth: 1440,
			containerHeight: 900,
			sidebarExpanded: true,
			drawerVisible: false,
			drawerHeight: 320,
			rightPanelVisible: true,
		});
		expect(withDrawer.rightPanelRect.height).toBe(544);
		expect(withoutDrawer.rightPanelRect.height).toBe(876);
		expect(withoutDrawer.rightPanelRect.height).toBeGreaterThan(
			withDrawer.rightPanelRect.height,
		);
	});
});
