// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getPreviewDropTargetFromScreenPosition } from "./timelineDropTargets";

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
