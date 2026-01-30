import { useEffect, useMemo, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTranscriptStore } from "@/asr/transcriptStore";
import type { TranscriptRecord } from "@/asr/types";

const formatTime = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes.toString().padStart(2, "0")}:${secs
		.toString()
		.padStart(2, "0")}`;
};

const pickDefaultTranscript = (transcripts: TranscriptRecord[]): string | null => {
	if (transcripts.length === 0) return null;
	const sorted = [...transcripts].sort(
		(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
	);
	return sorted[0]?.id ?? null;
};

const TranscriptPanel = () => {
	const transcripts = useTranscriptStore((state) => state.transcripts);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	useEffect(() => {
		if (selectedId && transcripts.some((record) => record.id === selectedId)) {
			return;
		}
		setSelectedId(pickDefaultTranscript(transcripts));
	}, [selectedId, transcripts]);

	const activeRecord = useMemo(() => {
		return transcripts.find((record) => record.id === selectedId) ?? null;
	}, [selectedId, transcripts]);

	if (transcripts.length === 0) {
		return <div className="text-xs text-neutral-500">暂无转写结果</div>;
	}

	return (
		<div className="flex flex-col gap-3">
			{transcripts.length > 1 && (
				<Select
					value={selectedId ?? undefined}
					onValueChange={setSelectedId}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="选择转写" />
					</SelectTrigger>
					<SelectContent>
						{transcripts.map((record) => (
							<SelectItem key={record.id} value={record.id}>
								{record.source.fileName}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{activeRecord ? (
				<div className="flex flex-col gap-2 text-xs text-neutral-200">
					<div className="text-neutral-400">
						{activeRecord.source.fileName}
					</div>
					<div className="flex flex-col gap-2">
						{activeRecord.segments.map((segment) => (
							<div
								key={segment.id}
								className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-1.5"
							>
								<div className="text-[11px] text-neutral-500">
									{formatTime(segment.start)} - {formatTime(segment.end)}
								</div>
								<div className="leading-relaxed text-neutral-100">
									{segment.text || "(空)"}
								</div>
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="text-xs text-neutral-500">暂无可显示的转写</div>
			)}
		</div>
	);
};

export default TranscriptPanel;
