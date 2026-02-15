import {
	createAgentCliRuntime,
	type ConfirmedPlan,
	type DryRunReport,
	type ParsedCommand,
	type PlanDraft,
} from "@ai-nle/agent-cli";
import { isMetaCommand } from "core/editor/command/reducer";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { createTimelineStoreAgentCliHost } from "../agent-cli/createTimelineStoreAgentCliHost";
import { resolveTimelineElementRole } from "../utils/resolveRole";

const renderDryRunDetails = (report: DryRunReport | null): string => {
	if (!report) return "";
	const lines = [report.summaryText];
	if (report.error) {
		lines.push(`错误: ${report.error}`);
	}
	if (report.changes.length > 0) {
		lines.push("变更:");
		for (const change of report.changes) {
			lines.push(`- ${change.field}: ${change.before} -> ${change.after}`);
		}
	}
	return lines.join("\n");
};

const AgentCliPanel = () => {
	const [commandText, setCommandText] = useState("");
	const [plan, setPlan] = useState<PlanDraft | null>(null);
	const [confirmedPlan, setConfirmedPlan] = useState<ConfirmedPlan | null>(null);
	const [outputText, setOutputText] = useState("");

	const runtime = useMemo(
		() =>
			createAgentCliRuntime(createTimelineStoreAgentCliHost(), {
				resolveRole: resolveTimelineElementRole,
			}),
		[],
	);

	const parsedPreview = useMemo(() => {
		if (!commandText.trim()) return { commands: [], errors: [] };
		return runtime.parseShellCommandBatch(commandText);
	}, [runtime, commandText]);

	const handleCreatePlan = () => {
		const parsed = runtime.parseShellCommandBatch(commandText);
		if (parsed.errors.length > 0) {
			setOutputText(parsed.errors.map((error) => error.error).join("\n"));
			setPlan(null);
			setConfirmedPlan(null);
			return;
		}
		if (parsed.commands.length === 0) {
			setOutputText("请输入至少一条命令");
			setPlan(null);
			setConfirmedPlan(null);
			return;
		}

		const metaCommands = parsed.commands.filter((command) =>
			isMetaCommand(command.id),
		);
		if (metaCommands.length > 0) {
			if (parsed.commands.length > 1) {
				setOutputText("help/schema/examples 不能与其他命令混合执行");
				setPlan(null);
				setConfirmedPlan(null);
				return;
			}
			const metaCommand = metaCommands[0] as ParsedCommand;
			const text = runtime.executeMetaCommandText(metaCommand);
			setOutputText(text ?? "");
			setPlan(null);
			setConfirmedPlan(null);
			return;
		}

		const nextPlan = runtime.createPlan(parsed.commands);
		setPlan(nextPlan);
		setConfirmedPlan(null);
		setOutputText(`计划已生成\n${nextPlan.summaryText}`);
	};

	const handleDryRun = () => {
		if (!plan) {
			setOutputText("请先生成计划");
			return;
		}
		const report = runtime.dryRunPlan(plan);
		setOutputText(renderDryRunDetails(report));
	};

	const handleConfirm = () => {
		if (!plan) {
			setOutputText("请先生成计划");
			return;
		}
		const confirmed = runtime.confirmPlan(plan.id);
		if (!confirmed) {
			setOutputText("计划不存在，请重新生成");
			return;
		}
		setConfirmedPlan(confirmed);
		setOutputText("计划已确认，可执行 apply");
	};

	const handleApply = () => {
		if (!confirmedPlan) {
			setOutputText("请先确认计划");
			return;
		}
		const result = runtime.applyPlan(confirmedPlan);
		if (!result.ok && result.rebaseRequired && result.plan) {
			setPlan(result.plan);
			setConfirmedPlan(null);
			const report = runtime.dryRunPlan(result.plan);
			setOutputText(
				[
					"计划已自动 rebase，请重新确认。",
					result.summaryText ?? "",
					renderDryRunDetails(report),
				]
					.filter((line) => line.length > 0)
					.join("\n"),
			);
			return;
		}
		if (!result.ok) {
			setOutputText(result.error ?? "执行失败");
			return;
		}
		setOutputText(result.summaryText ?? "执行完成");
		setConfirmedPlan(null);
		setPlan(null);
	};

	return (
		<div className="flex flex-col gap-2 text-xs text-neutral-200">
			<label htmlFor="agent-cli-input" className="text-neutral-400">
				命令输入（每行一条）
			</label>
			<textarea
				id="agent-cli-input"
				value={commandText}
				onChange={(event) => {
					setCommandText(event.target.value);
				}}
				placeholder="timeline.element.move --id clip-1 --start 10 --track-index 1"
				className="min-h-24 w-full rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-400"
			/>
			<div className="flex flex-wrap gap-1.5">
				<Button onClick={handleCreatePlan} className="h-7 px-2 text-xs">
					生成计划
				</Button>
				<Button onClick={handleDryRun} className="h-7 px-2 text-xs">
					Dry Run
				</Button>
				<Button onClick={handleConfirm} className="h-7 px-2 text-xs">
					确认计划
				</Button>
				<Button onClick={handleApply} className="h-7 px-2 text-xs">
					应用计划
				</Button>
			</div>
			<div className="rounded border border-white/10 bg-neutral-950/80 p-2 whitespace-pre-wrap break-words">
				{outputText.length > 0 ? outputText : "等待命令"}
			</div>
			<div className="text-[11px] text-neutral-500">
				解析结果: {parsedPreview.commands.length} 条命令，{parsedPreview.errors.length}
				 条错误
			</div>
		</div>
	);
};

export default AgentCliPanel;
