import {
	BufferTarget,
	CanvasSource,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
} from "mediabunny";
import {
	JsiSkSurface,
	Skia,
	SkiaSGRoot,
} from "react-skia-lite";
import { modelRegistry } from "@nle/dsl/model/registry";
import type { TimelineElement } from "@nle/dsl/types";
import { useTimelineStore } from "@nle/editor/contexts/TimelineContext";
import { buildSkiaRenderState } from "@nle/editor/preview/buildSkiaTree";

const getTrackIndexForElement = (element: TimelineElement) =>
	element.timeline.trackIndex ?? 0;

const sortByTrackIndex = (items: TimelineElement[]) => {
	return items
		.map((el, index) => ({
			el,
			index,
			trackIndex: getTrackIndexForElement(el),
		}))
		.sort((a, b) => {
			if (a.trackIndex !== b.trackIndex) {
				return a.trackIndex - b.trackIndex;
			}
			return a.index - b.index;
		})
		.map(({ el }) => el);
};

const ensure2DContext = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("无法获取导出画布的 2D 上下文");
	}
	return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

const cleanupWebGLContext = (canvas: HTMLCanvasElement | OffscreenCanvas) => {
	const ctx = canvas.getContext("webgl2") as WebGL2RenderingContext;
	if (!ctx) return;
	const loseContext = ctx.getExtension("WEBGL_lose_context");
	loseContext?.loseContext();
};

const createWebGLSurfaceForExport = (
	width: number,
	height: number,
): {
	surface: JsiSkSurface;
	canvas: HTMLCanvasElement | OffscreenCanvas;
} | null => {
	const canvas =
		typeof OffscreenCanvas !== "undefined"
			? new OffscreenCanvas(width, height)
			: (() => {
					const temp = document.createElement("canvas");
					temp.width = width;
					temp.height = height;
					return temp;
				})();

	let surface: JsiSkSurface | null = null;
	try {
		const canvasKit = (globalThis as { CanvasKit?: any }).CanvasKit;
		if (!canvasKit?.MakeWebGLCanvasSurface) {
			throw new Error("CanvasKit 未初始化");
		}
		const ctx = canvas.getContext("webgl2") as WebGL2RenderingContext;
		if (ctx) {
			ctx.drawingBufferColorSpace = "display-p3";
		}
		const webglSurface = canvasKit.MakeWebGLCanvasSurface(canvas);
		if (!webglSurface) {
			throw new Error("无法创建 WebGL Surface");
		}
		surface = new JsiSkSurface(canvasKit, webglSurface);
		return { surface, canvas };
	} catch {
		if (surface) {
			surface.ref.delete();
		}
		cleanupWebGLContext(canvas);
		return null;
	}
};

const downloadBlob = (blob: Blob, filename: string): void => {
	const link = document.createElement("a");
	const url = URL.createObjectURL(blob);
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
};

const waitForStaticModelsReady = async (elements: TimelineElement[]) => {
	const promises: Promise<void>[] = [];
	for (const element of elements) {
		const store = modelRegistry.get(element.id);
		if (!store) continue;
		const state = store.getState();
		if (state.type === "VideoClip") continue;
		if (state.waitForReady) {
			promises.push(state.waitForReady());
		}
	}
	await Promise.all(promises);
};

export const exportTimelineAsVideo = async (options?: {
	filename?: string;
	fps?: number;
	startFrame?: number;
	endFrame?: number;
}): Promise<void> => {
	const timelineState = useTimelineStore.getState();
	const elements = timelineState.elements;
	const tracks = timelineState.tracks;
	const fps = Number.isFinite(options?.fps)
		? Math.round(options?.fps as number)
		: Math.round(timelineState.fps || 30);

	const width = Math.round(timelineState.canvasSize.width);
	const height = Math.round(timelineState.canvasSize.height);
	if (!width || !height) {
		throw new Error("导出失败：无法获取画布尺寸");
	}

	const startFrame = Math.max(0, Math.round(options?.startFrame ?? 0));
	const timelineEnd =
		options?.endFrame ??
		elements.reduce(
			(max, el) => Math.max(max, Math.round(el.timeline.end ?? 0)),
			0,
		);
	const endFrame = Math.max(startFrame, Math.round(timelineEnd));
	if (endFrame <= startFrame) {
		throw new Error("导出失败：时间轴为空");
	}

	const previousState = {
		isPlaying: timelineState.isPlaying,
		currentTime: timelineState.currentTime,
		previewTime: timelineState.previewTime,
		previewAxisEnabled: timelineState.previewAxisEnabled,
		isExporting: timelineState.isExporting,
		exportTime: timelineState.exportTime,
	};

	// 导出时先停掉播放与 hover 预览
	timelineState.pause();
	timelineState.setPreviewAxisEnabled(false);
	timelineState.setPreviewTime(null);
	timelineState.setIsExporting(true);
	timelineState.setExportTime(startFrame);

	let root: SkiaSGRoot | null = null;
	let surface: JsiSkSurface | null = null;
	let webglCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

	try {
		await waitForStaticModelsReady(elements);

		const target = new BufferTarget();
		const output = new Output({
			format: new Mp4OutputFormat(),
			target,
		});
		const exportCanvas =
			typeof OffscreenCanvas !== "undefined"
				? new OffscreenCanvas(width, height)
				: (() => {
						const canvas = document.createElement("canvas");
						canvas.width = width;
						canvas.height = height;
						return canvas;
					})();
		const videoSource = new CanvasSource(exportCanvas, {
			codec: "avc",
			bitrate: QUALITY_HIGH,
		});
		output.addVideoTrack(videoSource, { frameRate: fps });
		await output.start();

		root = new SkiaSGRoot(Skia);
		const webglResult = createWebGLSurfaceForExport(width, height);
		if (!webglResult) {
			throw new Error("导出失败：无法创建 WebGL Surface");
		}
		surface = webglResult.surface;
		webglCanvas = webglResult.canvas;
		if (!surface) {
			throw new Error("导出失败：无法创建离屏画布");
		}
		const skiaCanvas = surface.getCanvas();

		const ctx = ensure2DContext(exportCanvas);
		if (!webglCanvas) {
			throw new Error("导出失败：无法获取 WebGL 画布");
		}

		for (let frame = startFrame; frame < endFrame; frame += 1) {
			timelineState.setExportTime(frame);

			const { children, ready, dispose } = await buildSkiaRenderState({
				elements,
				displayTime: frame,
				tracks,
				getTrackIndexForElement,
				sortByTrackIndex,
				prepare: {
					isExporting: true,
					fps,
					canvasSize: { width, height },
					getModelStore: (id) => modelRegistry.get(id),
				},
			});

			await ready;

			await root.render(children);

			skiaCanvas.clear(Float32Array.of(0, 0, 0, 0));
			root.drawOnCanvas(skiaCanvas);
			surface.flush();

			ctx.clearRect(0, 0, width, height);
			ctx.drawImage(webglCanvas, 0, 0, width, height);

			await videoSource.add(frame / fps, 1 / fps);

			dispose();
		}

		await output.finalize();
		if (!target.buffer) {
			throw new Error("导出失败：无法获取输出数据");
		}

		const blob = new Blob([target.buffer], { type: "video/mp4" });
		const filename = options?.filename ?? `timeline-${Date.now()}.mp4`;
		downloadBlob(blob, filename);
	} finally {
		// 导出结束后清理离屏资源，避免影响编辑器
		try {
			root?.unmount();
		} catch {}
		try {
			if (surface && webglCanvas) {
				surface.ref.delete();
				cleanupWebGLContext(webglCanvas);
			}
		} catch {}
		timelineState.setIsExporting(previousState.isExporting);
		timelineState.setExportTime(previousState.exportTime ?? null);
		timelineState.setPreviewAxisEnabled(previousState.previewAxisEnabled);
		timelineState.setPreviewTime(previousState.previewTime);
		timelineState.setCurrentTime(previousState.currentTime);
		if (previousState.isPlaying) {
			timelineState.play();
		} else {
			timelineState.pause();
		}
	}
};
