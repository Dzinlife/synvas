// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveMaterialDropTarget,
	type MaterialDndContext,
} from "./materialDnd";
import { useDragStore } from "./dragStore";

const createContext = (): MaterialDndContext => ({
	fps: 30,
	ratio: 1,
	defaultDurationFrames: 150,
	elements: [],
	trackAssignments: new Map(),
	trackRoleMap: new Map(),
	trackLockedMap: new Map(),
	trackCount: 1,
	rippleEditingEnabled: false,
});

const setRect = (
	element: HTMLElement,
	rect: { left: number; top: number; width: number; height: number },
) => {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
		x: rect.left,
		y: rect.top,
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		toJSON: () => ({}),
	} as DOMRect);
};

const createPreviewZone = () => {
	const previewRoot = document.createElement("div");
	previewRoot.setAttribute("data-main-view-preview", "true");
	previewRoot.dataset.active = "true";
	const previewZone = document.createElement("div");
	previewZone.setAttribute("data-preview-drop-zone", "true");
	previewZone.dataset.zoomLevel = "1";
	previewZone.dataset.offsetX = "0";
	previewZone.dataset.offsetY = "0";
	previewZone.dataset.pictureWidth = "800";
	previewZone.dataset.pictureHeight = "200";
	previewRoot.appendChild(previewZone);
	document.body.appendChild(previewRoot);
	setRect(previewZone, { left: 0, top: 0, width: 800, height: 600 });
};

const createMainTrackZone = () => {
	const mainZone = document.createElement("div");
	mainZone.setAttribute("data-track-drop-zone", "main");
	const contentArea = document.createElement("div");
	contentArea.setAttribute("data-track-content-area", "main");
	mainZone.appendChild(contentArea);
	document.body.appendChild(mainZone);
	setRect(mainZone, { left: 0, top: 400, width: 800, height: 160 });
	setRect(contentArea, { left: 0, top: 400, width: 800, height: 160 });
};

afterEach(() => {
	vi.restoreAllMocks();
	useDragStore.getState().setTimelineScrollLeft(0);
	document.body.innerHTML = "";
});

describe("resolveMaterialDropTarget", () => {
	it("时间线与预览重叠时优先命中时间线", () => {
		createPreviewZone();
		createMainTrackZone();
		const target = resolveMaterialDropTarget(
			createContext(),
			{
				materialRole: "clip",
				materialDurationFrames: 90,
				isTransitionMaterial: false,
			},
			120,
			450,
		);
		expect(target?.zone).toBe("timeline");
		expect(target?.canDrop).toBe(true);
	});

	it("不在时间线区域时命中预览区", () => {
		createPreviewZone();
		createMainTrackZone();
		const target = resolveMaterialDropTarget(
			createContext(),
			{
				materialRole: "clip",
				materialDurationFrames: 90,
				isTransitionMaterial: false,
			},
			120,
			120,
		);
		expect(target?.zone).toBe("preview");
		expect(target?.canDrop).toBe(true);
	});
});
