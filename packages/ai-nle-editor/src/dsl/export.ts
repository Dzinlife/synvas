import type { CanvasRef } from "react-skia-lite";
import { ImageFormat } from "react-skia-lite";
import { modelRegistry } from "./model/registry";

/**
 * 等待所有已注册的 model 资源准备就绪
 */
export async function waitForAllModelsReady(): Promise<void> {
	const ids = modelRegistry.getIds();
	const promises: Promise<void>[] = [];

	for (const id of ids) {
		const store = modelRegistry.get(id);
		if (store) {
			const state = store.getState();
			if (state.waitForReady) {
				promises.push(state.waitForReady());
			}
		}
	}

	await Promise.all(promises);
}

/**
 * 导出 Canvas 为图片并下载
 */
export async function exportCanvasAsImage(
	canvasRef: CanvasRef | null,
	options?: {
		format?: "jpeg" | "png";
		quality?: number;
		filename?: string;
		waitForReady?: boolean;
	},
): Promise<void> {
	const { format = "png", quality = 100, filename, waitForReady = true } =
		options ?? {};

	// 等待所有资源准备就绪
	if (waitForReady) {
		await waitForAllModelsReady();
	}

	const image = canvasRef?.makeImageSnapshot();
	if (!image) {
		console.error("Failed to create image snapshot");
		return;
	}

	try {
		const imageFormat =
			format === "jpeg" ? ImageFormat.JPEG : ImageFormat.PNG;
		const buffer = image.encodeToBytes(imageFormat, quality);
		const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

		const arrayBuffer = new Uint8Array(buffer).buffer;
		const blob = new Blob([arrayBuffer], { type: mimeType });

		const defaultFilename = `canvas-${Date.now()}.${format}`;
		downloadBlob(blob, filename ?? defaultFilename);
	} catch (error) {
		console.error("Failed to export image:", error);
	}
}

/**
 * 下载 Blob 为文件
 */
function downloadBlob(blob: Blob, filename: string): void {
	const link = document.createElement("a");
	const url = URL.createObjectURL(blob);
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
