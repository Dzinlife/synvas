import type { AgentRunKind, AgentRunRequest } from "@synvas/agent";
import type { ImageCanvasNode } from "@/studio/project/types";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import {
	useAgentClient,
	useNodeActiveAgentRun,
	useStartAgentRun,
} from "@/agent-system";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeAgentPanelProps } from "../types";
import { useCanvasInteractionStore } from "@/studio/canvas/canvasInteractionStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";

const MODEL_OPTIONS = [
	{ value: "mock-image-standard", label: "Mock Standard" },
	{ value: "mock-image-edit", label: "Mock Edit" },
];

const QUALITY_OPTIONS = [
	{ value: "standard", label: "Standard" },
	{ value: "high", label: "High" },
];

const ASPECT_RATIO_OPTIONS = [
	{ value: "1:1", label: "1:1" },
	{ value: "16:9", label: "16:9" },
	{ value: "9:16", label: "9:16" },
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
				: "正在生成 mock 图片..."}
		</div>
	);
};

const useCreditQuote = (
	kind: AgentRunKind,
	request: Pick<AgentRunRequest, "params" | "context">,
) => {
	const client = useAgentClient();
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const [credits, setCredits] = useState<number>(0);
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
				setCredits(quote.estimatedCredits);
			});
		return () => {
			disposed = true;
		};
	}, [client, context, currentProjectId, kind, params]);

	return credits;
};

const GenerateImageAgentPanel = ({ node }: { node: ImageCanvasNode }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState("mock-image-standard");
	const [quality, setQuality] = useState("standard");
	const [aspectRatio, setAspectRatio] = useState("1:1");
	const [variants, setVariants] = useState("1");
	const quoteParams = useMemo(
		() => ({
			params: {
				model,
				quality,
				aspectRatio,
				variants: Number(variants),
			},
		}),
		[aspectRatio, model, quality, variants],
	);
	const credits = useCreditQuote("image.generate", quoteParams);

	const canSubmit = Boolean(currentProjectId && prompt.trim() && !busy);
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
						{MODEL_OPTIONS.filter(
							(option) => option.value !== "mock-image-edit",
						).map((option) => (
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
					<FieldLabel>Ratio</FieldLabel>
					<AgentSelect
						ariaLabel="图片比例"
						value={aspectRatio}
						onChange={setAspectRatio}
					>
						{ASPECT_RATIO_OPTIONS.map((option) => (
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
					Estimated {credits} mock credits
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
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const setSelectedNodeIds = useCanvasInteractionStore(
		(state) => state.setSelectedNodeIds,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [instruction, setInstruction] = useState("");
	const quoteParams = useMemo(
		() => ({
			params: {
				model: "mock-image-edit",
			},
		}),
		[],
	);
	const credits = useCreditQuote("image.edit", quoteParams);

	const canSubmit = Boolean(currentProjectId && instruction.trim() && !busy);
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
				model: "mock-image-edit",
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
			<textarea
				value={instruction}
				onChange={(event) => setInstruction(event.currentTarget.value)}
				placeholder="Describe the edit"
				className="min-h-16 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
			/>
			<div className="flex items-center justify-between">
				<div className="text-[11px] text-white/55">
					Estimated {credits} mock credits
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
