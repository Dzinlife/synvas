// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompositionThumbnail } from "./thumbnailCache";

const {
	buildSkiaFrameSnapshotMock,
	makeSurfaceMock,
	makeOffscreenMock,
	drawPictureMock,
	saveMock,
	restoreMock,
	translateMock,
	scaleMock,
	flushMock,
	readPixelsMock,
	imageDisposeMock,
	snapshotDisposeMock,
	surfaceDisposeMock,
} = vi.hoisted(() => ({
	buildSkiaFrameSnapshotMock: vi.fn(),
	makeSurfaceMock: vi.fn(),
	makeOffscreenMock: vi.fn(),
	drawPictureMock: vi.fn(),
	saveMock: vi.fn(),
	restoreMock: vi.fn(),
	translateMock: vi.fn(),
	scaleMock: vi.fn(),
	flushMock: vi.fn(),
	readPixelsMock: vi.fn(),
	imageDisposeMock: vi.fn(),
	snapshotDisposeMock: vi.fn(),
	surfaceDisposeMock: vi.fn(),
}));

vi.mock("@/scene-editor/preview/buildSkiaTree", () => ({
	buildSkiaFrameSnapshot: buildSkiaFrameSnapshotMock,
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		XYWHRect: (x: number, y: number, width: number, height: number) => ({
			x,
			y,
			width,
			height,
		}),
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
		saveMock.mockReset();
		restoreMock.mockReset();
		translateMock.mockReset();
		scaleMock.mockReset();
		flushMock.mockReset();
		readPixelsMock.mockReset();
		imageDisposeMock.mockReset();
		snapshotDisposeMock.mockReset();
		surfaceDisposeMock.mockReset();

		readPixelsMock.mockReturnValue(new Uint8Array(4));
		const surfaceMock = {
			getCanvas: () => ({
				clear: vi.fn(),
				save: saveMock,
				restore: restoreMock,
				translate: translateMock,
				scale: scaleMock,
				drawPicture: drawPictureMock,
			}),
			flush: flushMock,
			makeImageSnapshot: () => ({
				makeNonTextureImage: () => ({
					getImageInfo: () => ({}),
					readPixels: readPixelsMock,
					dispose: imageDisposeMock,
				}),
				dispose: snapshotDisposeMock,
			}),
			dispose: surfaceDisposeMock,
		};
		makeSurfaceMock.mockReturnValue(surfaceMock);
		makeOffscreenMock.mockReturnValue(surfaceMock);
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

	it("渲染 Composition 缩略图时会复用单个 offscreen surface，并等待帧准备完成后再截图", async () => {
		const firstCanvas = await getCompositionThumbnail({
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
						canvasSize: {
							width: 1920,
							height: 1080,
						},
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
		const secondCanvas = await getCompositionThumbnail({
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
						canvasSize: {
							width: 1920,
							height: 1080,
						},
					}),
				},
			} as never,
			runtimeManager: {
				getTimelineRuntime: vi.fn(() => null),
			} as never,
			sceneRevision: 2,
			displayFrame: 24,
			width: 120,
			height: 68,
			pixelRatio: 1,
		});

		expect(firstCanvas).toBeInstanceOf(HTMLCanvasElement);
		expect(secondCanvas).toBeInstanceOf(HTMLCanvasElement);
		expect(makeOffscreenMock).toHaveBeenCalledTimes(1);
		expect(makeOffscreenMock).toHaveBeenCalledWith(512, 512);
		expect(makeSurfaceMock).not.toHaveBeenCalled();
		expect(buildSkiaFrameSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({
				prepare: expect.objectContaining({
					canvasSize: {
						width: 1920,
						height: 1080,
					},
					forcePrepareFrames: true,
					awaitReady: true,
				}),
			}),
			expect.any(Object),
		);
		expect(saveMock).toHaveBeenCalledTimes(2);
		expect(translateMock).toHaveBeenCalledWith(0, 0);
		expect(scaleMock).toHaveBeenCalledWith(80 / 1920, 80 / 1920);
		expect(drawPictureMock).toHaveBeenCalledWith({ id: "picture-1" });
		expect(restoreMock).toHaveBeenCalledTimes(2);
		expect(snapshotDisposeMock).toHaveBeenCalledTimes(2);
		expect(imageDisposeMock).toHaveBeenCalledTimes(2);
	});
});
