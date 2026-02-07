import { useEffect, useMemo, useRef, useState } from "react";
import { useTranscriptStore } from "@/asr/transcriptStore";
import type { TranscriptRecord } from "@/asr/types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

const formatTime = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes.toString().padStart(2, "0")}:${secs
		.toString()
		.padStart(2, "0")}`;
};

const pickDefaultTranscript = (
	transcripts: TranscriptRecord[],
): string | null => {
	if (transcripts.length === 0) return null;
	const sorted = [...transcripts].sort(
		(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
	);
	return sorted[0]?.id ?? null;
};

const TranscriptPanel = () => {
	const transcripts = useTranscriptStore((state) => state.transcripts);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const lastSegmentRef = useRef<HTMLDivElement | null>(null);
	const scrollThrottleRef = useRef<number | null>(null);
	const lastScrollAtRef = useRef(0);

	useEffect(() => {
		if (selectedId && transcripts.some((record) => record.id === selectedId)) {
			return;
		}
		setSelectedId(pickDefaultTranscript(transcripts));
	}, [selectedId, transcripts]);

	const activeRecord = useMemo(() => {
		return transcripts.find((record) => record.id === selectedId) ?? null;
	}, [selectedId, transcripts]);

	useEffect(() => {
		if (!activeRecord) return;
		const now = performance.now();
		const wait = 200;
		const runScroll = () => {
			lastScrollAtRef.current = performance.now();
			lastSegmentRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "end",
			});
		};
		if (now - lastScrollAtRef.current >= wait) {
			runScroll();
			return;
		}
		if (scrollThrottleRef.current !== null) return;
		scrollThrottleRef.current = window.setTimeout(
			() => {
				scrollThrottleRef.current = null;
				runScroll();
			},
			wait - (now - lastScrollAtRef.current),
		);
	}, [activeRecord?.updatedAt, activeRecord?.id]);

	useEffect(() => {
		return () => {
			if (scrollThrottleRef.current !== null) {
				window.clearTimeout(scrollThrottleRef.current);
				scrollThrottleRef.current = null;
			}
		};
	}, []);

	if (transcripts.length === 0) {
		return <div className="text-xs text-neutral-500">暂无转写结果</div>;
	}

	return (
		<div className="flex flex-col gap-3">
			{transcripts.length > 1 && (
				<Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
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
					<div className="text-neutral-400">{activeRecord.source.fileName}</div>
					<div className="leading-relaxed text-neutral-100">
						{activeRecord.segments.map((segment) => (
							<span
								key={segment.id}
								ref={
									segment.id ===
									activeRecord.segments[activeRecord.segments.length - 1]?.id
										? lastSegmentRef
										: undefined
								}
								className=""
							>
								<div className="text-[11px] text-neutral-500 mt-1.5 leading-none">
									{formatTime(segment.start)}
								</div>
								<span className="">{segment.text}</span>
							</span>
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
