// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompositionThumbnail } from "./thumbnailCache";

const {
	buildSkiaFrameSnapshotMock,
	makeSurfaceMock,
	makeOffscreenMock,
	drawPictureMock,
	flushMock,
	readPixelsMock,
	imageDisposeMock,
	surfaceDisposeMock,
} = vi.hoisted(() => ({
	buildSkiaFrameSnapshotMock: vi.fn(),
	makeSurfaceMock: vi.fn(),
	makeOffscreenMock: vi.fn(),
	drawPictureMock: vi.fn(),
	flushMock: vi.fn(),
	readPixelsMock: vi.fn(),
	imageDisposeMock: vi.fn(),
	surfaceDisposeMock: vi.fn(),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		Surface: {
			Make: makeSurfaceMock,
			MakeOffscreen: makeOffscreenMock,
		},
	},
}));

describe("Composition thumbnailCache", () => {
	beforeEach(() => {
		buildSkiaFrameSnapshotMock.mockReset();
		makeSurfaceMock.mockReset();
		makeOffscreenMock.mockReset();
		drawPictureMock.mockReset();
		flushMock.mockReset();
		readPixelsMock.mockReset();
		imageDisposeMock.mockReset();
		surfaceDisposeMock.mockReset();

		readPixelsMock.mockReturnValue(new Uint8Array(4));
		makeSurfaceMock.mockReturnValue({
			getCanvas: () => ({
				clear: vi.fn(),
				drawPicture: drawPictureMock,
			}),
			flush: flushMock,
			makeImageSnapshot: () => ({
				getImageInfo: () => ({}),
				readPixels: readPixelsMock,
				dispose: imageDisposeMock,
			}),
			dispose: surfaceDisposeMock,
		});
		buildSkiaFrameSnapshotMock.mockResolvedValue({
			picture: { id: "picture-1" },
			dispose: vi.fn(),
		});
		vi.stubGlobal(
			"ImageData",
			class ImageData {
				constructor(
					public data: Uint8ClampedArray,
					public width: number,
					public height: number,
				) {}
			},
		);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			() =>
				({
					putImageData: vi.fn(),
				}) as never,
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("渲染 Composition 缩略图时只使用软件 surface，不申请 offscreen WebGL surface", async () => {
		const canvas = await getCompositionThumbnail({
			sceneRuntime: {
				ref: {
					sceneId: "scene-child",
				},
				modelRegistry: {
					get: vi.fn(),
				},
				timelineStore: {
					getState: () => ({
						elements: [],
						tracks: [],
						fps: 30,
					}),
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(() => null),
			} as never,
			sceneRevision: 1,
			displayFrame: 12,
			width: 80,
			height: 45,
			pixelRatio: 1,
		});

		expect(canvas).toBeInstanceOf(HTMLCanvasElement);
		expect(makeSurfaceMock).toHaveBeenCalledWith(80, 45);
		expect(makeOffscreenMock).not.toHaveBeenCalled();
		expect(drawPictureMock).toHaveBeenCalledWith({ id: "picture-1" });
	});
});
