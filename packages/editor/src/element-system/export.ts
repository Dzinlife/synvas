import { exportCanvasAsImage as exportCanvasAsImageCore } from "core/timeline-system/export";
import type { CanvasRef } from "react-skia-lite";
import type { EditorRuntime } from "@/scene-editor/runtime/types";

/**
 * 等待所有已注册的 model 资源准备就绪
 */
export async function waitForAllModelsReady(
	runtime: EditorRuntime,
): Promise<void> {
	const { modelRegistry } = runtime;
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
	options: {
		runtime: EditorRuntime;
		format?: "jpeg" | "png";
		quality?: number;
		filename?: string;
		waitForReady?: boolean;
	},
): Promise<void> {
	const { runtime, waitForReady = true, ...rest } = options;
	return exportCanvasAsImageCore(canvasRef, {
		...rest,
		waitForReady: waitForReady
			? () => waitForAllModelsReady(runtime)
			: undefined,
	});
}
