import type { CanvasRef } from "react-skia-lite";
import { exportCanvasAsImage as exportCanvasAsImageCore } from "core/dsl/export";
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
	const { waitForReady = true, ...rest } = options ?? {};
	return exportCanvasAsImageCore(canvasRef, {
		...rest,
		waitForReady: waitForReady ? waitForAllModelsReady : undefined,
	});
}
