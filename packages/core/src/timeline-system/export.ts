import type { CanvasRef } from "react-skia-lite";
import { ImageFormat } from "react-skia-lite";

type WaitForReady = () => Promise<void> | void;

export type ExportCanvasOptions = {
	format?: "jpeg" | "png";
	quality?: number;
	filename?: string;
	waitForReady?: WaitForReady;
};

/**
 * 导出 Canvas 为图片并下载
 */
export async function exportCanvasAsImage(
	canvasRef: CanvasRef | null,
	options?: ExportCanvasOptions,
): Promise<void> {
	const { format = "png", quality = 100, filename, waitForReady } =
		options ?? {};

	if (waitForReady) {
		await waitForReady();
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
