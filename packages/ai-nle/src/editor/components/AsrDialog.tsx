import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import type { AsrJobStatus, AsrModelSize, TranscriptRecord } from "@/asr/types";
import { isAudioFile, readAudioMetadata, writeAudioToOpfs } from "@/asr/opfsAudio";
import { transcribeAudioFile } from "@/asr/asrService";
import { useTranscriptStore } from "@/asr/transcriptStore";

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

const MODEL_OPTIONS: { value: AsrModelSize; label: string }[] = [
	{ value: "tiny", label: "Tiny" },
	{ value: "small", label: "Small" },
	{ value: "medium", label: "Medium" },
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
	const addTranscript = useTranscriptStore((state) => state.addTranscript);
	const updateTranscript = useTranscriptStore((state) => state.updateTranscript);
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [language, setLanguage] = useState("zh");
	const [model, setModel] = useState<AsrModelSize>("small");
	const [status, setStatus] = useState<AsrJobStatus>("idle");
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [abortController, setAbortController] = useState<AbortController | null>(
		null,
	);

	const isRunning = status === "loading" || status === "running";
	const progressText = useMemo(() => {
		return `${Math.round(progress * 100)}%`;
	}, [progress]);

	const resetStatus = useCallback(() => {
		setStatus("idle");
		setProgress(0);
		setError(null);
	}, []);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (isRunning) return;
			setOpen(nextOpen);
			if (!nextOpen) {
				resetStatus();
			}
		},
		[isRunning, resetStatus],
	);

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
		const controller = new AbortController();
		setAbortController(controller);

		try {
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

			await transcribeAudioFile({
				file,
				language,
				model,
				duration: metadata.duration,
				signal: controller.signal,
				onProgress: setProgress,
				onChunk: (segment) => {
					updateTranscript(transcriptId, (prev) => ({
						...prev,
						segments: [...prev.segments, segment],
						updatedAt: Date.now(),
					}));
				},
			});

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
	}, [addTranscript, file, isRunning, language, model, updateTranscript]);

	const handleAbort = useCallback(() => {
		abortController?.abort();
	}, [abortController]);

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="secondary">
					转写
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="max-w-xl">
				<AlertDialogHeader>
					<AlertDialogTitle>本地转写</AlertDialogTitle>
					<AlertDialogDescription>
						上传音频文件并生成可编辑字幕数据
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="grid gap-4">
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
					<div className="grid grid-cols-2 gap-4">
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
										<SelectItem
											key={option.value}
											value={option.value}
										>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label>模型</Label>
							<Select
								value={model}
								onValueChange={(value) =>
									setModel(value as AsrModelSize)
								}
								disabled={isRunning}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="选择模型" />
								</SelectTrigger>
								<SelectContent>
									{MODEL_OPTIONS.map((option) => (
										<SelectItem
											key={option.value}
											value={option.value}
										>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="grid gap-2">
						<div className="flex items-center justify-between text-xs text-neutral-400">
							<span>{formatStatus(status)}</span>
							<span>{progressText}</span>
						</div>
						<div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
							<div
								className="h-full bg-emerald-500 transition-all"
								style={{ width: progressText }}
							/>
						</div>
					</div>
					{error && <div className="text-xs text-red-400">{error}</div>}
				</div>
				<AlertDialogFooter className="mt-2">
					<AlertDialogCancel asChild>
						<Button variant="outline" disabled={isRunning}>
							关闭
						</Button>
					</AlertDialogCancel>
					{isRunning ? (
						<Button variant="destructive" onClick={handleAbort}>
							取消
						</Button>
					) : (
						<Button onClick={handleStart} disabled={!file}>
							开始转写
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default AsrDialog;
