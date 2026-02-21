// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	getCanvasDropTargetFromScreenPosition,
	getPreviewDropTargetFromScreenPosition,
} from "./timelineDropTargets";

const createPreviewZone = () => {
	const previewZone = document.createElement("div");
	previewZone.setAttribute("data-preview-drop-zone", "true");
	previewZone.dataset.zoomLevel = "1";
	previewZone.dataset.offsetX = "0";
	previewZone.dataset.offsetY = "0";
	previewZone.dataset.pictureWidth = "1920";
	previewZone.dataset.pictureHeight = "1080";
	previewZone.getBoundingClientRect = () =>
		({
			left: 100,
			top: 200,
			right: 2020,
			bottom: 1280,
			width: 1920,
			height: 1080,
			x: 100,
			y: 200,
			toJSON: () => "",
		}) as DOMRect;
	document.body.appendChild(previewZone);
	return previewZone;
};

const createCanvasZone = (options?: { active?: boolean }) => {
	const root = document.createElement("div");
	root.setAttribute("data-main-view-canvas", "true");
	root.dataset.active = options?.active === false ? "false" : "true";
	const canvasZone = document.createElement("div");
	canvasZone.setAttribute("data-canvas-drop-zone", "true");
	canvasZone.getBoundingClientRect = () =>
		({
			left: 300,
			top: 100,
			right: 1300,
			bottom: 900,
			width: 1000,
			height: 800,
			x: 300,
			y: 100,
			toJSON: () => "",
		}) as DOMRect;
	root.appendChild(canvasZone);
	document.body.appendChild(root);
	return canvasZone;
};

describe("getPreviewDropTargetFromScreenPosition", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("预览中心点映射到 transform position 原点", () => {
		createPreviewZone();
		const target = getPreviewDropTargetFromScreenPosition(1060, 740);
		expect(target?.positionX).toBeCloseTo(0, 6);
		expect(target?.positionY).toBeCloseTo(0, 6);
		expect(target?.canDrop).toBe(true);
	});

	it("左上角映射为 (-W/2, +H/2)", () => {
		createPreviewZone();
		const target = getPreviewDropTargetFromScreenPosition(100, 200);
		expect(target?.positionX).toBeCloseTo(-960, 6);
		expect(target?.positionY).toBeCloseTo(540, 6);
		expect(target?.canDrop).toBe(true);
	});

	it("右下角映射为 (+W/2, -H/2)", () => {
		createPreviewZone();
		const target = getPreviewDropTargetFromScreenPosition(2020, 1280);
		expect(target?.positionX).toBeCloseTo(960, 6);
		expect(target?.positionY).toBeCloseTo(-540, 6);
		expect(target?.canDrop).toBe(true);
	});

	it("预览区域外返回 null", () => {
		createPreviewZone();
		const target = getPreviewDropTargetFromScreenPosition(90, 200);
		expect(target).toBeNull();
	});
});

describe("getCanvasDropTargetFromScreenPosition", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("canvas 视图激活时命中返回 canDrop=true", () => {
		createCanvasZone();
		const target = getCanvasDropTargetFromScreenPosition(600, 300);
		expect(target).toEqual({
			zone: "canvas",
			canDrop: true,
		});
	});

	it("canvas 视图未激活时返回 null", () => {
		createCanvasZone({ active: false });
		const target = getCanvasDropTargetFromScreenPosition(600, 300);
		expect(target).toBeNull();
	});

	it("canvas 区域外返回 null", () => {
		createCanvasZone();
		const target = getCanvasDropTargetFromScreenPosition(200, 90);
		expect(target).toBeNull();
	});
});
