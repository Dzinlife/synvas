import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { useAsrClient } from "@/asr";
import {
	isAudioFile,
	readAudioMetadata,
	writeAudioToOpfs,
} from "@/asr/opfsAudio";
import { useTranscriptStore } from "@/asr/transcriptStore";
import type { AsrJobStatus, AsrModelSize, TranscriptRecord } from "@/asr/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

const createId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const LANGUAGE_OPTIONS = [
	{ value: "zh", label: "中文" },
	{ value: "en", label: "English" },
	{ value: "ja", label: "日本語" },
	{ value: "auto", label: "自动检测" },
];

// 高级选项：后端（仅 Electron 本地转写可用），按平台区分
const BACKEND_OPTIONS = [
	{ value: "auto", label: "自动" },
	{ value: "gpu", label: "GPU" },
	{ value: "cpu", label: "CPU" },
];

const formatStatus = (status: AsrJobStatus): string => {
	switch (status) {
		case "loading":
			return "模型加载中";
		case "running":
			return "转写进行中";
		case "done":
			return "转写完成";
		case "error":
			return "转写失败";
		case "canceled":
			return "已取消";
		default:
			return "待命";
	}
};

const AsrDialog = () => {
	const asrClient = useAsrClient();
	const addTranscript = useTranscriptStore((state) => state.addTranscript);
	const updateTranscript = useTranscriptStore(
		(state) => state.updateTranscript,
	);
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [language, setLanguage] = useState("zh");
	const [status, setStatus] = useState<AsrJobStatus>("idle");
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [lastBackend, setLastBackend] = useState<"gpu" | "cpu" | null>(null);
	const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);
	const [backend, setBackend] = useState<"auto" | "gpu" | "cpu">("auto");
	const isElectron = typeof window !== "undefined" && "aiNleElectron" in window;
	const platform =
		typeof window !== "undefined"
			? (window as Window & { aiNleElectron?: { platform?: string } })
					.aiNleElectron?.platform
			: undefined;
	const isDarwin =
		platform === "darwin" ||
		(platform === undefined &&
			typeof navigator !== "undefined" &&
			navigator.platform === "MacIntel");
	const backendOptions = BACKEND_OPTIONS;
	const model: AsrModelSize = isElectron ? "large-v3-turbo" : "tiny";

	const isRunning = status === "loading" || status === "running";
	const progressText = useMemo(() => {
		return `${Math.round(progress * 100)}%`;
	}, [progress]);

	const panelVisible = open || isRunning || status === "error";

	const resetStatus = useCallback(() => {
		setStatus("idle");
		setProgress(0);
		setError(null);
		setLastBackend(null);
		setLastDurationMs(null);
	}, []);

	const handleTogglePanel = useCallback(() => {
		if (open) {
			if (isRunning) {
				setCollapsed(true);
				return;
			}
			setOpen(false);
			resetStatus();
			return;
		}
		setOpen(true);
		setCollapsed(false);
	}, [isRunning, open, resetStatus]);

	const handleClosePanel = useCallback(() => {
		if (isRunning) return;
		setOpen(false);
		setCollapsed(false);
		resetStatus();
	}, [isRunning, resetStatus]);

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const nextFile = event.target.files?.[0] ?? null;
			if (!nextFile) {
				setFile(null);
				return;
			}
			if (!isAudioFile(nextFile)) {
				setError("请选择音频文件");
				setFile(null);
				return;
			}
			setError(null);
			setFile(nextFile);
		},
		[],
	);

	const handleStart = useCallback(async () => {
		if (!file || isRunning) return;
		setError(null);
		setProgress(0);
		setStatus("loading");
		setCollapsed(true);
		setOpen(true);
		const controller = new AbortController();
		setAbortController(controller);

		// 同步当前选择的后端到主进程（仅 Electron）
		if (isElectron) {
			const bridge = (
				window as Window & {
					aiNleElectron?: {
						asr?: {
							whisperSetBackend: (b: "gpu" | "cpu" | null) => Promise<unknown>;
						};
					};
				}
			).aiNleElectron;
			const backendForIpc = backend === "auto" ? null : backend;
			bridge?.asr?.whisperSetBackend(backendForIpc);
		}

		try {
			await asrClient.ensureReady?.({
				model,
				language,
				signal: controller.signal,
			});
			const metadata = await readAudioMetadata(file);
			const { uri, fileName } = await writeAudioToOpfs(file);
			const now = Date.now();
			const transcriptId = createId("transcript");
			const record: TranscriptRecord = {
				id: transcriptId,
				source: {
					type: "opfs-audio",
					uri,
					fileName,
					duration: metadata.duration,
				},
				language,
				model,
				createdAt: now,
				updatedAt: now,
				segments: [],
			};
			addTranscript(record);
			setStatus("running");

			const result = await asrClient.transcribeAudioFile({
				file,
				language,
				model,
				duration: metadata.duration,
				signal: controller.signal,
				onProgress: setProgress,
				onChunk: (segment) => {
					updateTranscript(transcriptId, (prev) => {
						const index = prev.segments.findIndex(
							(existing) => existing.id === segment.id,
						);
						if (index >= 0) {
							const nextSegments = [...prev.segments];
							nextSegments[index] = segment;
							return {
								...prev,
								segments: nextSegments,
								updatedAt: Date.now(),
							};
						}
						return {
							...prev,
							segments: [...prev.segments, segment],
							updatedAt: Date.now(),
						};
					});
				},
			});
			if (result?.segments?.length) {
				updateTranscript(transcriptId, (prev) => {
					if (prev.segments.length > 0) return prev;
					return {
						...prev,
						segments: result.segments,
						updatedAt: Date.now(),
					};
				});
			}
			setLastBackend(result?.backend ?? null);
			setLastDurationMs(result?.durationMs ?? null);
			setStatus("done");
			setProgress(1);
		} catch (err) {
			if (controller.signal.aborted) {
				setStatus("canceled");
			} else {
				setStatus("error");
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setAbortController(null);
		}
	}, [
		addTranscript,
		asrClient,
		backend,
		file,
		isElectron,
		isRunning,
		language,
		model,
		updateTranscript,
	]);

	const handleAbort = useCallback(() => {
		abortController?.abort();
	}, [abortController]);

	const handleBackendChange = useCallback((value: string | null) => {
		const next = (value ?? "auto") as "auto" | "gpu" | "cpu";
		setBackend(next);
		const bridge =
			typeof window !== "undefined" && "aiNleElectron" in window
				? (
						window as Window & {
							aiNleElectron?: {
								asr?: {
									whisperSetBackend: (
										b: "gpu" | "cpu" | null,
									) => Promise<unknown>;
								};
							};
						}
					).aiNleElectron
				: undefined;
		const backendForIpc = next === "auto" ? null : next;
		bridge?.asr?.whisperSetBackend(backendForIpc);
	}, []);

	return (
		<>
			<Button size="sm" variant="secondary" onClick={handleTogglePanel}>
				转写
			</Button>
			{panelVisible && (
				<div
					className={`fixed left-1/2 z-30 -translate-x-1/2 rounded-2xl [corner-shape:superellipse(1.1)] border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-xl transition-all ${
						collapsed ? "top-3 w-[360px]" : "top-20 w-[520px]"
					}`}
				>
					<div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
						<div className="text-sm font-medium text-white">本地转写</div>
						<div className="flex items-center gap-2">
							<Button
								size="xs"
								variant="ghost"
								onClick={() => setCollapsed((prev) => !prev)}
							>
								{collapsed ? "展开" : "收起"}
							</Button>
							<Button
								size="xs"
								variant="ghost"
								onClick={handleClosePanel}
								disabled={isRunning}
							>
								关闭
							</Button>
						</div>
					</div>
					<div className="grid gap-4 px-4 py-3">
						{collapsed ? (
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-neutral-300">
									<span>状态：{formatStatus(status)}</span>
									<span>{progressText}</span>
								</div>
								{status === "done" &&
									(lastBackend != null || lastDurationMs != null) && (
										<div className="text-xs text-neutral-400">
											{lastBackend != null && (
												<span>后端: {lastBackend.toUpperCase()}</span>
											)}
											{lastBackend != null && lastDurationMs != null && " · "}
											{lastDurationMs != null && (
												<span>
													耗时: {(lastDurationMs / 1000).toFixed(2)} s
												</span>
											)}
										</div>
									)}
								<div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
									<div
										className="h-full bg-emerald-500 transition-all"
										style={{ width: `${Math.round(progress * 100)}%` }}
									/>
								</div>
							</div>
						) : (
							<>
								<div className="grid gap-2">
									<Label htmlFor="asr-audio-file">音频文件</Label>
									<Input
										id="asr-audio-file"
										type="file"
										accept="audio/*"
										disabled={isRunning}
										onChange={handleFileChange}
									/>
									{file && (
										<div className="text-xs text-neutral-400">{file.name}</div>
									)}
								</div>
								<div className="grid gap-2">
									<Label>语言</Label>
									<Select
										value={language}
										onValueChange={(v) => setLanguage(v ?? "zh")}
										disabled={isRunning}
									>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="选择语言" />
										</SelectTrigger>
										<SelectContent>
											{LANGUAGE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{isElectron && (
									<div className="grid gap-2">
										<Label className="text-neutral-400">高级 · 后端</Label>
										<Select
											value={
												backendOptions.some((o) => o.value === backend)
													? backend
													: "auto"
											}
											onValueChange={handleBackendChange}
											disabled={isRunning}
										>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="选择后端" />
											</SelectTrigger>
											<SelectContent>
												{backendOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<div className="text-xs text-neutral-500">
											自动：使用 GPU（若可用）；指定后转写使用该后端。
										</div>
									</div>
								)}
								<div className="grid gap-2">
									<div className="flex items-center justify-between text-xs text-neutral-400">
										<span>状态：{formatStatus(status)}</span>
										<span>{progressText}</span>
									</div>
									{status === "done" &&
										(lastBackend != null || lastDurationMs != null) && (
											<div className="text-xs text-neutral-400">
												{lastBackend != null && (
													<span>后端: {lastBackend.toUpperCase()}</span>
												)}
												{lastBackend != null && lastDurationMs != null && " · "}
												{lastDurationMs != null && (
													<span>
														处理耗时: {(lastDurationMs / 1000).toFixed(2)} s
													</span>
												)}
											</div>
										)}
									<div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
										<div
											className="h-full bg-emerald-500 transition-all"
											style={{ width: `${Math.round(progress * 100)}%` }}
										/>
									</div>
								</div>
								{error && <div className="text-xs text-red-400">{error}</div>}
								<div className="flex items-center justify-end gap-2">
									{isRunning ? (
										<Button variant="destructive" onClick={handleAbort}>
											取消
										</Button>
									) : (
										<Button onClick={handleStart} disabled={!file}>
											开始转写
										</Button>
									)}
								</div>
							</>
						)}
					</div>
				</div>
			)}
		</>
	);
};

export default AsrDialog;
