// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExportVideoDialog, { type ExportVideoOptions } from "./ExportVideoDialog";

const createAbortError = (): Error => {
	if (typeof DOMException !== "undefined") {
		return new DOMException("已取消", "AbortError");
	}
	const error = new Error("已取消");
	error.name = "AbortError";
	return error;
};

afterEach(() => {
	cleanup();
});

describe("ExportVideoDialog", () => {
	it("打开后显示默认值和元数据", () => {
		render(
			<ExportVideoDialog
				defaultFps={30}
				timelineEndFrame={300}
				canvasSize={{ width: 1920, height: 1080 }}
				onExport={vi.fn(async () => {})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出视频" }));

		expect((screen.getByLabelText("FPS") as HTMLInputElement).value).toBe("30");
		expect(
			(screen.getByLabelText("开始帧") as HTMLInputElement).value,
		).toBe("0");
		expect(
			(screen.getByLabelText("结束帧（不含）") as HTMLInputElement).value,
		).toBe("300");
		expect(
			(screen.getByLabelText("文件名") as HTMLInputElement).value,
		).toMatch(/^timeline-\d+\.mp4$/);
		expect(screen.getByText("分辨率：1920 × 1080")).not.toBeNull();
		expect(screen.getByText("总帧数：300")).not.toBeNull();
		expect(screen.getByText("时长：10.00 s")).not.toBeNull();
	});

	it("提交表单时透传导出参数并自动补全 mp4 后缀", async () => {
		const onExport = vi.fn(async (_options: ExportVideoOptions) => {});
		render(
			<ExportVideoDialog
				defaultFps={30}
				timelineEndFrame={300}
				canvasSize={{ width: 1280, height: 720 }}
				onExport={onExport}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
		fireEvent.change(screen.getByLabelText("文件名"), {
			target: { value: "demo-video" },
		});
		fireEvent.change(screen.getByLabelText("FPS"), {
			target: { value: "24" },
		});
		fireEvent.change(screen.getByLabelText("开始帧"), {
			target: { value: "10" },
		});
		fireEvent.change(screen.getByLabelText("结束帧（不含）"), {
			target: { value: "100" },
		});

		fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

		await waitFor(() => {
			expect(onExport).toHaveBeenCalledTimes(1);
		});
		const options = onExport.mock.calls[0][0] as ExportVideoOptions;
		expect(options).toMatchObject({
			filename: "demo-video.mp4",
			fps: 24,
			startFrame: 10,
			endFrame: 100,
		});
		expect(options.signal).toBeInstanceOf(AbortSignal);
		expect(typeof options.onFrame).toBe("function");
	});

	it("导出中显示进度且不可关闭，完成后自动关闭", async () => {
		let resolveExport: (() => void) | null = null;
		let onFrame: ((frame: number) => void) | undefined;
		const onExport = vi.fn((options: ExportVideoOptions) => {
			onFrame = options.onFrame;
			return new Promise<void>((resolve) => {
				resolveExport = resolve;
			});
		});

		render(
			<ExportVideoDialog
				defaultFps={30}
				timelineEndFrame={5}
				canvasSize={{ width: 1280, height: 720 }}
				onExport={onExport}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
		fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

		await waitFor(() => {
			expect(onExport).toHaveBeenCalledTimes(1);
		});

		const closeButtons = screen.getAllByRole("button", { name: "关闭" });
		expect((closeButtons[0] as HTMLButtonElement).disabled).toBe(true);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.getByText("导出进度")).not.toBeNull();

		await act(async () => {
			onFrame?.(2);
		});
		expect(screen.getByText("60%")).not.toBeNull();

		await act(async () => {
			resolveExport?.();
		});
		await waitFor(() => {
			expect(screen.queryByText("导出进度")).toBeNull();
		});
	});

	it("取消导出后自动关闭对话框", async () => {
		const onExport = vi.fn(
			(options: {
				signal: AbortSignal;
			}) =>
				new Promise<void>((_, reject) => {
					options.signal.addEventListener(
						"abort",
						() => {
							reject(createAbortError());
						},
						{ once: true },
					);
				}),
		);
		render(
			<ExportVideoDialog
				defaultFps={30}
				timelineEndFrame={50}
				canvasSize={{ width: 1280, height: 720 }}
				onExport={onExport}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
		fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
		await waitFor(() => {
			expect(onExport).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(screen.getByRole("button", { name: "取消导出" }));
		await waitFor(() => {
			expect(screen.queryByText("导出进度")).toBeNull();
		});
	});

	it("导出失败时保持打开并显示错误", async () => {
		const onExport = vi.fn(async () => {
			throw new Error("导出失败测试");
		});
		render(
			<ExportVideoDialog
				defaultFps={30}
				timelineEndFrame={50}
				canvasSize={{ width: 1280, height: 720 }}
				onExport={onExport}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
		fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

		await waitFor(() => {
			expect(screen.getByText("导出失败测试")).not.toBeNull();
		});
		expect(screen.getByText("导出进度")).not.toBeNull();
	});
});
