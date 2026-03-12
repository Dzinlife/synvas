import { useMemo } from "react";
import {
	useStudioRuntimeManager,
	useTimelineStoreApi,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import {
	LAB_ACTOR_IDS,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { useOtLabStore } from "@/studio/history/otLabStore";

const PANEL_WIDTH_PX = 380;

const formatTimestamp = (timestamp: number): string => {
	if (!Number.isFinite(timestamp)) return "-";
	return new Date(timestamp).toLocaleTimeString();
};

const OtLabPanel = () => {
	const timelineStore = useTimelineStoreApi();
	const runtimeManager = useStudioRuntimeManager();
	const open = useOtLabStore((state) => state.open);
	const viewMode = useOtLabStore((state) => state.viewMode);
	const selectedOpId = useOtLabStore((state) => state.selectedOpId);
	const setViewMode = useOtLabStore((state) => state.setViewMode);
	const setSelectedOpId = useOtLabStore((state) => state.setSelectedOpId);

	const activeActorId = useStudioHistoryStore((state) => state.activeActorId);
	const actorStacks = useStudioHistoryStore(
		(state) => state.actorStacks[state.activeActorId],
	);
	const canUndo = useStudioHistoryStore((state) => state.canUndo);
	const canRedo = useStudioHistoryStore((state) => state.canRedo);
	const opLog = useStudioHistoryStore((state) => state.opLog);
	const setActiveActor = useStudioHistoryStore((state) => state.setActiveActor);
	const undo = useStudioHistoryStore((state) => state.undo);
	const redo = useStudioHistoryStore((state) => state.redo);

	const actorOps = useMemo(() => {
		return opLog.filter((op) => op.actorId === activeActorId);
	}, [activeActorId, opLog]);

	const displayOps = useMemo(() => {
		const source = viewMode === "actor" ? actorOps : opLog;
		return [...source].reverse();
	}, [actorOps, opLog, viewMode]);

	const selectedOp = useMemo(() => {
		if (!selectedOpId) return null;
		return opLog.find((op) => op.opId === selectedOpId) ?? null;
	}, [opLog, selectedOpId]);

	if (!open) return null;

	return (
		<aside
			className="h-full border-l border-neutral-800 bg-neutral-950 text-neutral-100"
			style={{ width: PANEL_WIDTH_PX }}
		>
			<div className="flex h-full flex-col">
				<div className="border-b border-neutral-800 px-3 py-2">
					<div className="text-xs font-semibold tracking-wide text-neutral-300">
						OT Lab
					</div>
					<div className="mt-2 flex flex-wrap gap-1">
						{LAB_ACTOR_IDS.map((actorId) => {
							const isActive = actorId === activeActorId;
							return (
								<button
									key={actorId}
									type="button"
									onClick={() => setActiveActor(actorId)}
									className={`rounded px-2 py-1 text-xs transition-colors ${
										isActive
											? "bg-sky-600 text-white"
											: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
									}`}
								>
									{actorId}
								</button>
							);
						})}
					</div>
					<div className="mt-2 flex items-center gap-2 text-xs text-neutral-300">
						<span>Undo: {actorStacks.past.length}</span>
						<span>Redo: {actorStacks.future.length}</span>
					</div>
					<div className="mt-2 flex items-center gap-2">
						<button
							type="button"
							onClick={() => undo({ timelineStore, runtimeManager })}
							disabled={!canUndo}
							className={`rounded px-2 py-1 text-xs transition-colors ${
								canUndo
									? "bg-neutral-700 text-white hover:bg-neutral-600"
									: "bg-neutral-900 text-neutral-500"
							}`}
						>
							撤销
						</button>
						<button
							type="button"
							onClick={() => redo({ timelineStore, runtimeManager })}
							disabled={!canRedo}
							className={`rounded px-2 py-1 text-xs transition-colors ${
								canRedo
									? "bg-neutral-700 text-white hover:bg-neutral-600"
									: "bg-neutral-900 text-neutral-500"
							}`}
						>
							重做
						</button>
					</div>
					<div className="mt-2 flex items-center gap-1">
						<button
							type="button"
							onClick={() => setViewMode("actor")}
							className={`rounded px-2 py-1 text-xs transition-colors ${
								viewMode === "actor"
									? "bg-emerald-600 text-white"
									: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
							}`}
						>
							当前用户
						</button>
						<button
							type="button"
							onClick={() => setViewMode("global")}
							className={`rounded px-2 py-1 text-xs transition-colors ${
								viewMode === "global"
									? "bg-emerald-600 text-white"
									: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
							}`}
						>
							全局日志
						</button>
					</div>
				</div>

				<div className="grid min-h-0 flex-1 grid-rows-[1fr_1fr]">
					<div className="min-h-0 overflow-y-auto border-b border-neutral-800">
						{displayOps.length === 0 ? (
							<div className="px-3 py-3 text-xs text-neutral-500">暂无 op</div>
						) : (
							displayOps.map((op) => {
								const isSelected = selectedOpId === op.opId;
								const commandArgs = op.command.args as {
									__intent?: "root" | "derived";
									__rootTxnId?: string | null;
									conflicts?: string[];
								};
								return (
									<button
										key={op.opId}
										type="button"
										onClick={() => setSelectedOpId(op.opId)}
										className={`w-full border-b border-neutral-900 px-3 py-2 text-left text-xs transition-colors ${
											isSelected
												? "bg-neutral-800"
												: "hover:bg-neutral-900"
										}`}
									>
										<div className="truncate font-mono text-[11px] text-neutral-200">
											{op.opId}
										</div>
										<div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
											<span>{op.actorId}</span>
											<span>{op.streamId}</span>
											<span>{op.command.id}</span>
											{commandArgs.__intent && (
												<span
													className={`rounded px-1 py-0.5 text-[10px] ${
														commandArgs.__intent === "derived"
															? "bg-cyan-700/70 text-cyan-100"
															: "bg-emerald-700/70 text-emerald-100"
													}`}
												>
													{commandArgs.__intent}
												</span>
											)}
											{(commandArgs.conflicts?.length ?? 0) > 0 && (
												<span className="rounded bg-rose-700/70 px-1 py-0.5 text-[10px] text-rose-100">
													conflict
												</span>
											)}
											{op.command.id === "studio.noop" && (
												<span className="rounded bg-amber-700/60 px-1 py-0.5 text-[10px] text-amber-100">
													noop
												</span>
											)}
										</div>
										<div className="mt-1 text-[11px] text-neutral-500">
											seq {op.seq} · lamport {op.lamport} · {formatTimestamp(op.createdAt)}
											{commandArgs.__rootTxnId
												? ` · txn ${commandArgs.__rootTxnId}`
												: ""}
										</div>
									</button>
								);
							})
						)}
					</div>

					<div className="min-h-0 overflow-y-auto px-3 py-2">
						<div className="text-xs font-semibold text-neutral-300">Op 详情</div>
						{selectedOp ? (
							<pre className="mt-2 whitespace-pre-wrap break-all rounded bg-neutral-900 p-2 text-[11px] text-neutral-300">
								{JSON.stringify(selectedOp, null, 2)}
							</pre>
						) : (
							<div className="mt-2 text-xs text-neutral-500">选择一条 op 查看详情</div>
						)}
					</div>
				</div>
			</div>
		</aside>
	);
};

export default OtLabPanel;
