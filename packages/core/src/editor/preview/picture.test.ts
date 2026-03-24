import type { ReactNode } from "react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	recordingCanvas,
	beginRecordingMock,
	finishRecordingAsPictureMock,
	renderMock,
	drawOnCanvasMock,
	unmountMock,
	makeSurfaceMock,
	makeOffscreenSurfaceMock,
	makeColorMock,
	getSkiaRenderBackendMock,
	sceneGraph,
} = vi.hoisted(() => ({
	recordingCanvas: {
		id: "canvas",
		drawImage: vi.fn(),
	},
	beginRecordingMock: vi.fn(() => recordingCanvas),
	finishRecordingAsPictureMock: vi.fn(() => ({ id: "picture" })),
	renderMock: vi.fn(),
	drawOnCanvasMock: vi.fn(),
	unmountMock: vi.fn(),
	makeSurfaceMock: vi.fn(),
	makeOffscreenSurfaceMock: vi.fn(),
	makeColorMock: vi.fn((value: string) => value),
	getSkiaRenderBackendMock: vi.fn(() => ({
		bundle: "webgpu",
		kind: "webgpu",
		device: {} as GPUDevice,
		deviceContext: {} as never,
	})),
	sceneGraph: {
		children: [] as Array<{ type: string; children?: ReactNode[] }>,
	},
}));

vi.mock("react-skia-lite", async () => {
	const NodeType = {
		BackdropFilter: "skBackdropFilter",
		RenderTarget: "skRenderTarget",
	} as const;
	return {
		NodeType,
		Skia: {
			PictureRecorder: () => ({
				beginRecording: beginRecordingMock,
				finishRecordingAsPicture: finishRecordingAsPictureMock,
			}),
			Surface: {
				Make: makeSurfaceMock,
				MakeOffscreen: makeOffscreenSurfaceMock,
			},
			Color: makeColorMock,
		},
		SkiaSGRoot: class {
			render = renderMock;
			drawOnCanvas = drawOnCanvasMock;
			unmount = unmountMock;
			sg = sceneGraph;
		},
		getSkiaRenderBackend: getSkiaRenderBackendMock,
	};
});

import { renderNodeToImage, renderNodeToPicture } from "./renderNodeSnapshot";

describe("renderNodeToPicture", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sceneGraph.children = [];
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgpu",
			kind: "webgpu",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});
		makeOffscreenSurfaceMock.mockReset();
	});

	it("普通树会直接录制 picture，不创建隔离 surface", () => {
		const child = React.createElement("child", { id: "content" });

		renderNodeToPicture(child, { width: 320, height: 180 });

		expect(beginRecordingMock).toHaveBeenCalledWith({
			x: 0,
			y: 0,
			width: 320,
			height: 180,
		});
		expect(renderMock).toHaveBeenCalledTimes(1);
		expect(renderMock.mock.calls[0][0]).toBe(child);
		expect(makeSurfaceMock).not.toHaveBeenCalled();
		expect(drawOnCanvasMock).toHaveBeenCalledWith(recordingCanvas);
		expect(unmountMock).toHaveBeenCalledTimes(1);
		expect(finishRecordingAsPictureMock).toHaveBeenCalledTimes(1);
	});

	it("包含 BackdropFilter 的树会先重放到隔离 surface", () => {
		const child = React.createElement("child", { id: "content" });
		const surfaceCanvas = {
			clear: vi.fn(),
		};
		const image = {
			dispose: vi.fn(),
		};
		const surface = {
			getCanvas: vi.fn(() => surfaceCanvas),
			flush: vi.fn(),
			asImage: vi.fn(() => image),
			makeImageSnapshot: vi.fn(() => image),
			dispose: vi.fn(),
		};
		makeSurfaceMock.mockReturnValueOnce(surface);
		renderMock.mockImplementation(() => {
			sceneGraph.children = [{ type: "skBackdropFilter", children: [] }];
		});

		renderNodeToPicture(child, { width: 320, height: 180 });

		expect(makeSurfaceMock).toHaveBeenCalledWith(320, 180);
		expect(makeColorMock).toHaveBeenCalledWith("transparent");
		expect(surfaceCanvas.clear).toHaveBeenCalledWith("transparent");
		expect(drawOnCanvasMock).toHaveBeenCalledWith(surfaceCanvas);
		expect(surface.asImage).toHaveBeenCalledTimes(1);
		expect(recordingCanvas.drawImage).toHaveBeenCalledWith(image, 0, 0);
		expect(image.dispose).toHaveBeenCalledTimes(1);
		expect(surface.dispose).toHaveBeenCalledTimes(1);
	});

	it("已包含 RenderTarget 时不会重复创建 Backdrop 隔离 surface", () => {
		const child = React.createElement("child", { id: "content" });
		renderMock.mockImplementation(() => {
			sceneGraph.children = [
				{
					type: "skRenderTarget",
					children: [{ type: "skBackdropFilter", children: [] }],
				},
			];
		});

		renderNodeToPicture(child, { width: 320, height: 180 });

		expect(makeSurfaceMock).not.toHaveBeenCalled();
		expect(drawOnCanvasMock).toHaveBeenCalledWith(recordingCanvas);
	});

	it("WebGL 下包含 BackdropFilter 的树会回退到原始 picture 录制路径", () => {
		const child = React.createElement("child", { id: "content" });
		renderMock.mockImplementation(() => {
			sceneGraph.children = [{ type: "skBackdropFilter", children: [] }];
		});
		getSkiaRenderBackendMock.mockReturnValue({
			bundle: "webgl",
			kind: "webgl",
			device: {} as GPUDevice,
			deviceContext: {} as never,
		});

		renderNodeToPicture(child, { width: 320, height: 180 });

		expect(makeSurfaceMock).not.toHaveBeenCalled();
		expect(drawOnCanvasMock).toHaveBeenCalledWith(recordingCanvas);
	});

	it("WebGPU 下会直接把节点重放到 offscreen surface 并输出 image", () => {
		const child = React.createElement("child", { id: "content" });
		const cleanup = vi.fn();
		const surfaceCanvas = {
			clear: vi.fn(),
		};
		const imageDispose = vi.fn();
		const image = {
			dispose: imageDispose,
		};
		const surface = {
			getCanvas: vi.fn(() => surfaceCanvas),
			flush: vi.fn(),
			asImage: vi.fn(() => image),
			makeImageSnapshot: vi.fn(() => image),
			dispose: vi.fn(),
		};
		makeOffscreenSurfaceMock.mockReturnValueOnce(surface);
		drawOnCanvasMock.mockReturnValueOnce([cleanup]);

		const rendered = renderNodeToImage(child, { width: 320, height: 180 });

		expect(makeOffscreenSurfaceMock).toHaveBeenCalledWith(320, 180);
		expect(renderMock).toHaveBeenCalledWith(child);
		expect(makeColorMock).toHaveBeenCalledWith("transparent");
		expect(surfaceCanvas.clear).toHaveBeenCalledWith("transparent");
		expect(drawOnCanvasMock).toHaveBeenCalledWith(surfaceCanvas, {
			retainResources: true,
		});
		expect(surface.asImage).toHaveBeenCalledTimes(1);
		expect(rendered).toBe(image);

		rendered?.dispose?.();

		expect(imageDispose).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(surface.dispose).toHaveBeenCalledTimes(1);
	});
});
