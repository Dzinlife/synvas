import { useAsrClient } from "@nle/asr";
import {
	isAudioFile,
	readAudioMetadata,
	writeAudioToOpfs,
} from "@nle/asr/opfsAudio";
import { useTranscriptStore } from "@nle/asr/transcriptStore";
import type {
	AsrJobStatus,
	AsrModelSize,
	TranscriptRecord,
} from "@nle/asr/types";
import { Button } from "@nle/components/ui/button";
import { Input } from "@nle/components/ui/input";
import { Label } from "@nle/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nle/components/ui/select";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";

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
	const [statusDetail, setStatusDetail] = useState<string | null>(null);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const isElectron = typeof window !== "undefined" && "aiNleElectron" in window;
	const model: AsrModelSize = isElectron ? "large-v3-turbo" : "tiny";

	const isRunning = status === "loading" || status === "running";
	const progressText = useMemo(() => {
		return `${Math.round(progress * 100)}%`;
	}, [progress]);
	const statusText = statusDetail
		? `${formatStatus(status)} · ${statusDetail}`
		: formatStatus(status);

	const panelVisible = open || isRunning || status === "error";

	const resetStatus = useCallback(() => {
		setStatus("idle");
		setProgress(0);
		setError(null);
		setStatusDetail(null);
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
		setStatusDetail("准备中");
		setCollapsed(true);
		setOpen(true);
		const controller = new AbortController();
		setAbortController(controller);

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
				onStatus: setStatusDetail,
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
					return {
						...prev,
						segments: result.segments,
						updatedAt: Date.now(),
					};
				});
			}

			setStatus("done");
			setStatusDetail(null);
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
		file,
		isRunning,
		language,
		model,
		updateTranscript,
	]);

	const handleAbort = useCallback(() => {
		abortController?.abort();
	}, [abortController]);

	return (
		<>
			<Button size="sm" variant="secondary" onClick={handleTogglePanel}>
				转写
			</Button>
			{panelVisible && (
				<div
					className={`fixed left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-xl transition-all ${
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
									<span>状态：{statusText}</span>
									<span>{progressText}</span>
								</div>
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
										onValueChange={setLanguage}
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
								<div className="grid gap-2">
									<div className="flex items-center justify-between text-xs text-neutral-400">
										<span>状态：{statusText}</span>
										<span>{progressText}</span>
									</div>
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
