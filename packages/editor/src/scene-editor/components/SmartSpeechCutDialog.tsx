import type { TimelineAsset } from "core/element/types";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsrClient } from "@/asr";
import { transcribeAssetById } from "@/asr/assetTranscriptionService";
import type { AsrJobStatus, TranscriptRecord } from "@/asr/types";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { useProjectAssets } from "@/projects/useProjectAssets";

interface SmartSpeechCutDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	elementId: string | null;
	assetId: string | null;
}

const LANGUAGE_OPTIONS = [
	{ value: "auto", label: "自动检测" },
	{ value: "zh", label: "中文" },
	{ value: "en", label: "English" },
	{ value: "ja", label: "日本語" },
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

const formatTime = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes.toString().padStart(2, "0")}:${secs
		.toString()
		.padStart(2, "0")}`;
};

const TranscriptContent: React.FC<{ record: TranscriptRecord | null }> = ({
	record,
}) => {
	const lastSegmentRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!record) return;
		const lastSegment = lastSegmentRef.current;
		if (typeof lastSegment?.scrollIntoView !== "function") return;
		lastSegment.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [record?.updatedAt, record?.id]);

	if (!record) {
		return <div className="text-xs text-neutral-500">暂无转写结果</div>;
	}

	return (
		<div className="flex flex-col gap-2 text-xs text-neutral-200">
			<div className="text-neutral-400 break-all">{record.source.fileName}</div>
			<div className="max-h-64 overflow-y-auto rounded border border-white/10 bg-neutral-950/60 p-2">
				{record.segments.length === 0 ? (
					<div className="text-neutral-500">正在等待转写结果...</div>
				) : (
					record.segments.map((segment, index) => {
						const isLast = index === record.segments.length - 1;
						return (
							<div
								key={segment.id}
								ref={isLast ? lastSegmentRef : undefined}
								className="mb-2 last:mb-0"
							>
								<div className="text-[11px] text-neutral-500 leading-none mb-1">
									{formatTime(segment.start)}
								</div>
								<div className="leading-relaxed text-neutral-100">
									{segment.text}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
};

const resolveSourceById = (
	assets: TimelineAsset[],
	assetId: string | null,
): TimelineAsset | null => {
	if (!assetId) return null;
	return assets.find((source) => source.id === assetId) ?? null;
};

const SmartSpeechCutDialog: React.FC<SmartSpeechCutDialogProps> = ({
	open,
	onOpenChange,
	elementId,
	assetId,
}) => {
	const asrClient = useAsrClient();
	const {
		assets,
		getProjectAssetById,
		updateProjectAssetMeta,
	} = useProjectAssets();
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const source = useMemo(
		() => resolveSourceById(assets, assetId),
		[assets, assetId],
	);
	const sourceUri = useMemo(() => {
		if (!source) return null;
		return resolveAssetPlayableUri(source, { projectId: currentProjectId });
	}, [source, currentProjectId]);
	const asrRecord = source?.meta?.asr ?? null;
	const [language, setLanguage] = useState("auto");
	const [status, setStatus] = useState<AsrJobStatus>("idle");
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	const isRunning = status === "loading" || status === "running";

	useEffect(() => {
		if (!open && !isRunning) {
			setError(null);
			setMessage(null);
		}
	}, [isRunning, open]);

	const handleAbort = useCallback(() => {
		abortController?.abort();
	}, [abortController]);

	const handleTranscribe = useCallback(
		async (force: boolean) => {
			if (!assetId || isRunning || !currentProjectId) return;
			setError(null);
			setMessage(null);
			setProgress(0);
			const controller = new AbortController();
			setAbortController(controller);
			try {
				const result = await transcribeAssetById({
					assetId,
					projectId: currentProjectId,
					asrClient,
					language,
					force,
					signal: controller.signal,
					getProjectAssetById,
					updateProjectAssetMeta,
					onStatus: setStatus,
					onProgress: setProgress,
				});
				setMessage(result.summaryText);
				if (result.status === "done") {
					setStatus("done");
					setProgress(1);
					return;
				}
				if (result.status === "canceled") {
					setStatus("canceled");
					return;
				}
				setStatus("idle");
				setProgress(0);
			} catch (transcribeError) {
				setStatus("error");
				setError(
					transcribeError instanceof Error
						? transcribeError.message
						: String(transcribeError),
				);
			} finally {
				setAbortController(null);
			}
		},
		[
			asrClient,
			isRunning,
			language,
			assetId,
			currentProjectId,
			getProjectAssetById,
			updateProjectAssetMeta,
		],
	);

	const handleDebugLog = useCallback(() => {
		console.log("[SmartSpeechCutDialog][asr]", {
			elementId,
			assetId,
			sourceUri: sourceUri ?? null,
			asr: source?.meta?.asr ?? null,
		});
	}, [elementId, source, sourceUri, assetId]);

	const canRun = Boolean(assetId && source && currentProjectId);
	const hasAsr = Boolean(asrRecord);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<div className="grid gap-4 p-4">
					<div className="space-y-1">
						<DialogTitle>智能剪口播</DialogTitle>
						<DialogDescription>
							{hasAsr
								? "已检测到转写结果，可进入文本剪辑模式或强制重转写。"
								: "当前素材尚未转写，可选择语言并开始转写。"}
						</DialogDescription>
					</div>
					<div className="min-w-0 flex items-center justify-between gap-2 rounded-md border border-white/10 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-300">
						<span className="truncate inline-block">
							source: {sourceUri ?? "未选中可转写素材"}
						</span>
						<Button className="h-7 px-2 text-xs" onClick={handleDebugLog}>
							调试 ASR
						</Button>
					</div>
					<div className="grid gap-2">
						<Label>语言</Label>
						<Select
							value={language}
							items={LANGUAGE_OPTIONS}
							onValueChange={(value) => setLanguage(value ?? "auto")}
							disabled={!canRun || isRunning}
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
							<span>状态：{formatStatus(status)}</span>
							<span>{Math.round(progress * 100)}%</span>
						</div>
						<div className="h-2 overflow-hidden rounded-full bg-neutral-800">
							<div
								className="h-full bg-emerald-500 transition-all"
								style={{ width: `${Math.round(progress * 100)}%` }}
							/>
						</div>
					</div>
					<div className="flex items-center justify-end gap-2">
						{isRunning ? (
							<Button onClick={handleAbort}>取消转写</Button>
						) : hasAsr ? (
							<Button
								onClick={() => {
									void handleTranscribe(true);
								}}
								disabled={!canRun}
							>
								强制重新转写
							</Button>
						) : (
							<Button
								onClick={() => {
									void handleTranscribe(false);
								}}
								disabled={!canRun}
							>
								开始转写
							</Button>
						)}
					</div>
					{message && <div className="text-xs text-neutral-400">{message}</div>}
					{error && <div className="text-xs text-red-400">{error}</div>}
					<TranscriptContent record={asrRecord} />
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default SmartSpeechCutDialog;
