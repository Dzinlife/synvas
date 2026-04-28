import {
	OPENAI_IMAGE_DEFAULT_MODEL,
	type AgentQuote,
	type AgentRunKind,
	type AgentRunRequest,
} from "@synvas/agent";
import type { ImageCanvasNode } from "@/studio/project/types";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import {
	useAiProviderConfigStore,
	useAgentClient,
	useAgentRuntimeStore,
	useNodeActiveAgentRun,
	useStartAgentRun,
} from "@/agent-system";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeAgentPanelProps } from "../types";
import { useCanvasInteractionStore } from "@/studio/canvas/canvasInteractionStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";

const MODEL_OPTIONS = [
	{ value: "gpt-image-2", label: "GPT Image 2" },
	{ value: "gpt-image-1.5", label: "GPT Image 1.5" },
	{ value: "gpt-image-1", label: "GPT Image 1" },
	{ value: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
];

const QUALITY_OPTIONS = [
	{ value: "auto", label: "Auto" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
];

const SIZE_OPTIONS = [
	{ value: "auto", label: "Auto" },
	{ value: "1024x1024", label: "1024 x 1024" },
	{ value: "1536x1024", label: "1536 x 1024" },
	{ value: "1024x1536", label: "1024 x 1536" },
];

const VARIANT_OPTIONS = [1, 2, 4];

const isRunBusy = (status: string | null | undefined): boolean => {
	return (
		status === "queued" ||
		status === "running" ||
		status === "materializing_artifacts" ||
		status === "applying_effects"
	);
};

const runTouchesNode = (
	run: {
		scope: AgentRunRequest["scope"];
		context: Record<string, unknown>;
		effects: { type: string; nodeId?: string }[];
	},
	nodeId: string,
): boolean => {
	if (run.scope.type === "node" && run.scope.nodeId === nodeId) return true;
	if (run.context.targetNodeId === nodeId) return true;
	return run.effects.some(
		(effect) =>
			effect.type === "image-node.bind-artifact" && effect.nodeId === nodeId,
	);
};

const useNodeLatestFailedAgentRunError = (nodeId: string): string | null => {
	return useAgentRuntimeStore((state) => {
		const latestRun = Object.values(state.runsById)
			.filter((run) => runTouchesNode(run, nodeId))
			.sort((left, right) => right.updatedAt - left.updatedAt)[0];
		if (latestRun?.status !== "failed") return null;
		return latestRun.error ?? "图片生成失败。";
	});
};

const FieldLabel = ({ children }: { children: React.ReactNode }) => {
	return (
		<div className="mb-1 text-[11px] font-medium text-white/55">{children}</div>
	);
};

const AgentSelect = ({
	value,
	onChange,
	ariaLabel,
	children,
}: {
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
	children: React.ReactNode;
}) => {
	return (
		<select
			aria-label={ariaLabel}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
			className="h-8 w-full rounded border border-white/10 bg-black/40 px-2 text-xs text-white outline-none"
		>
			{children}
		</select>
	);
};

const StatusLine = ({ nodeId }: { nodeId: string }) => {
	const activeRun = useNodeActiveAgentRun(nodeId);
	if (!activeRun) return null;
	return (
		<div className="rounded border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[11px] text-sky-100">
			{activeRun.status === "applying_effects"
				? "正在写入画布..."
				: "正在生成图片..."}
		</div>
	);
};

const ConfigRequiredLine = () => {
	return (
		<div className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
			请先在顶部 AI 设置中配置 OpenAI API Key。
		</div>
	);
};

const ErrorLine = ({ error }: { error: string | null }) => {
	if (!error) return null;
	return (
		<div className="rounded border border-red-400/20 bg-red-400/10 px-2 py-1 text-[11px] text-red-100">
			{error}
		</div>
	);
};

const QuoteLine = ({ quote }: { quote: AgentQuote | null }) => {
	if (!quote) return null;
	if (quote.currency === "mock-credit" && quote.estimatedCredits !== null) {
		return <span>Estimated {quote.estimatedCredits} mock credits</span>;
	}
	return <span>{quote.label ?? "OpenAI BYOK billing"}</span>;
};

const useCreditQuote = (
	kind: AgentRunKind,
	request: Pick<AgentRunRequest, "params" | "context">,
) => {
	const client = useAgentClient();
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const [quote, setQuote] = useState<AgentQuote | null>(null);
	const params = request.params;
	const context = request.context;

	useEffect(() => {
		if (!currentProjectId) return;
		let disposed = false;
		void client
			.quote({
				kind,
				scope: { type: "project", projectId: currentProjectId },
				input: {},
				params,
				context,
			})
			.then((quote) => {
				if (disposed) return;
				setQuote(quote);
			})
			.catch(() => {
				if (disposed) return;
				setQuote(null);
			});
		return () => {
			disposed = true;
		};
	}, [client, context, currentProjectId, kind, params]);

	return quote;
};

const GenerateImageAgentPanel = ({ node }: { node: ImageCanvasNode }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const hasOpenAiApiKey = useAiProviderConfigStore(
		(state) => state.config.openai.apiKey.trim().length > 0,
	);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const latestError = useNodeLatestFailedAgentRunError(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState(OPENAI_IMAGE_DEFAULT_MODEL);
	const [quality, setQuality] = useState("auto");
	const [size, setSize] = useState("auto");
	const [variants, setVariants] = useState("1");
	const quoteParams = useMemo(
		() => ({
			params: {
				model,
				quality,
				size,
				variants: Number(variants),
			},
		}),
		[model, quality, size, variants],
	);
	const quote = useCreditQuote("image.generate", quoteParams);

	const canSubmit = Boolean(
		currentProjectId && prompt.trim() && !busy && hasOpenAiApiKey,
	);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!currentProjectId || !canSubmit) return;
		void startRun({
			kind: "image.generate",
			scope: {
				type: "node",
				projectId: currentProjectId,
				nodeId: node.id,
			},
			input: {
				prompt: prompt.trim(),
			},
			params: quoteParams.params,
		});
	};

	return (
		<form
			data-testid="image-agent-generate-panel"
			className="space-y-3 p-3 text-white"
			onSubmit={handleSubmit}
		>
			<div className="flex items-center gap-2 text-xs font-medium">
				<Sparkles className="size-4 text-sky-300" />
				<span>Image Agent</span>
			</div>
			<StatusLine nodeId={node.id} />
			<ErrorLine error={latestError} />
			{!hasOpenAiApiKey && <ConfigRequiredLine />}
			<label className="block">
				<FieldLabel>Prompt</FieldLabel>
				<textarea
					value={prompt}
					onChange={(event) => setPrompt(event.currentTarget.value)}
					placeholder="Describe the image to generate"
					className="min-h-20 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
				/>
			</label>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<FieldLabel>Model</FieldLabel>
					<AgentSelect ariaLabel="生图模型" value={model} onChange={setModel}>
						{MODEL_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</AgentSelect>
				</div>
				<div>
					<FieldLabel>Quality</FieldLabel>
					<AgentSelect
						ariaLabel="图片质量"
						value={quality}
						onChange={setQuality}
					>
						{QUALITY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</AgentSelect>
				</div>
				<div>
					<FieldLabel>Size</FieldLabel>
					<AgentSelect ariaLabel="图片尺寸" value={size} onChange={setSize}>
						{SIZE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</AgentSelect>
				</div>
				<div>
					<FieldLabel>Variants</FieldLabel>
					<AgentSelect
						ariaLabel="Variant 数量"
						value={variants}
						onChange={setVariants}
					>
						{VARIANT_OPTIONS.map((option) => (
							<option key={option} value={String(option)}>
								{option}
							</option>
						))}
					</AgentSelect>
				</div>
			</div>
			<div className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/70">
				<span>Reference</span>
				<span>Coming soon</span>
			</div>
			<div className="flex items-center justify-between">
				<div className="text-[11px] text-white/55">
					<QuoteLine quote={quote} />
				</div>
				<button
					type="submit"
					disabled={!canSubmit}
					className="inline-flex h-8 items-center gap-1 rounded bg-sky-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
				>
					<Sparkles className="size-3" />
					Generate
				</button>
			</div>
		</form>
	);
};

const EditImageAgentPanel = ({ node }: { node: ImageCanvasNode }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const hasOpenAiApiKey = useAiProviderConfigStore(
		(state) => state.config.openai.apiKey.trim().length > 0,
	);
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const setSelectedNodeIds = useCanvasInteractionStore(
		(state) => state.setSelectedNodeIds,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const latestError = useNodeLatestFailedAgentRunError(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [instruction, setInstruction] = useState("");
	const [model, setModel] = useState(OPENAI_IMAGE_DEFAULT_MODEL);
	const [quality, setQuality] = useState("auto");
	const quoteParams = useMemo(
		() => ({
			params: {
				model,
				quality,
				size: "auto",
			},
		}),
		[model, quality],
	);
	const quote = useCreditQuote("image.edit", quoteParams);

	const canSubmit = Boolean(
		currentProjectId && instruction.trim() && !busy && hasOpenAiApiKey,
	);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!currentProjectId || !node.assetId || !canSubmit) return;
		const targetNodeId = createCanvasNode({
			type: "image",
			name: "Image Edit",
			assetId: null,
			x: node.x + node.width + 40,
			y: node.y,
			width: node.width,
			height: node.height,
		});
		const latestProject = useProjectStore.getState().currentProject;
		const targetNode = latestProject?.canvas.nodes.find(
			(item) => item.id === targetNodeId,
		);
		if (targetNode) {
			pushHistory({
				kind: "canvas.node-create",
				node: targetNode,
				focusNodeId: latestProject?.ui.focusedNodeId ?? null,
			});
		}
		setSelectedNodeIds([targetNodeId]);
		void startRun({
			kind: "image.edit",
			scope: {
				type: "node",
				projectId: currentProjectId,
				nodeId: node.id,
			},
			input: {
				instruction: instruction.trim(),
			},
			params: {
				model,
				quality,
				size: "auto",
			},
			context: {
				sourceAssetId: node.assetId,
				targetNodeId,
			},
		});
		setInstruction("");
	};

	return (
		<form
			data-testid="image-agent-edit-panel"
			className="space-y-3 p-3 text-white"
			onSubmit={handleSubmit}
		>
			<div className="flex items-center gap-2 text-xs font-medium">
				<Wand2 className="size-4 text-violet-300" />
				<span>Edit Image</span>
			</div>
			<StatusLine nodeId={node.id} />
			<ErrorLine error={latestError} />
			{!hasOpenAiApiKey && <ConfigRequiredLine />}
			<textarea
				value={instruction}
				onChange={(event) => setInstruction(event.currentTarget.value)}
				placeholder="Describe the edit"
				className="min-h-16 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
			/>
			<div>
				<FieldLabel>Model</FieldLabel>
				<AgentSelect ariaLabel="编辑模型" value={model} onChange={setModel}>
					{MODEL_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</AgentSelect>
			</div>
			<div>
				<FieldLabel>Quality</FieldLabel>
				<AgentSelect
					ariaLabel="编辑图片质量"
					value={quality}
					onChange={setQuality}
				>
					{QUALITY_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</AgentSelect>
			</div>
			<div className="flex items-center justify-between">
				<div className="text-[11px] text-white/55">
					<QuoteLine quote={quote} />
				</div>
				<button
					type="submit"
					disabled={!canSubmit}
					className="inline-flex h-8 items-center gap-1 rounded bg-violet-500 px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
				>
					<Wand2 className="size-3" />
					Edit
				</button>
			</div>
		</form>
	);
};

export const ImageNodeAgentPanel = ({
	node,
}: CanvasNodeAgentPanelProps<ImageCanvasNode>) => {
	if (!node.assetId) {
		return <GenerateImageAgentPanel node={node} />;
	}
	return <EditImageAgentPanel node={node} />;
};
