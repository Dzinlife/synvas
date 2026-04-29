import {
	formatAgentImageSize,
	isAgentImageModelCapabilities,
	normalizeAgentImageSize,
	OPENAI_IMAGE_DEFAULT_MODEL,
	OPENAI_PROVIDER_ID,
	OPENAI_PROVIDER_MODELS,
	resolveAgentImageAspectRatio,
	type AgentImageModelCapabilities,
	type AgentImageSize,
	type AgentModel,
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeAgentPanelProps } from "../types";
import { useCanvasInteractionStore } from "@/studio/canvas/canvasInteractionStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";

const DEFAULT_IMAGE_SIZE: AgentImageSize = { width: 1024, height: 1024 };
const OPENAI_IMAGE_DEFAULT_MODEL_KEY = `${OPENAI_PROVIDER_ID}:${OPENAI_IMAGE_DEFAULT_MODEL}`;

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

const sameSize = (left: AgentImageSize, right: AgentImageSize): boolean =>
	left.width === right.width && left.height === right.height;

const clampNumber = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const roundCanvasDimension = (value: number): number =>
	Math.round(value * 1000) / 1000;

const resolveImageNodeDisplaySize = (
	baseNode: Pick<ImageCanvasNode, "width" | "height">,
	imageSize: AgentImageSize,
): Pick<ImageCanvasNode, "width" | "height"> => {
	if (
		baseNode.width <= 0 ||
		imageSize.width <= 0 ||
		imageSize.height <= 0 ||
		!Number.isFinite(baseNode.width) ||
		!Number.isFinite(imageSize.width) ||
		!Number.isFinite(imageSize.height)
	) {
		return {
			width: baseNode.width,
			height: baseNode.height,
		};
	}
	return {
		width: baseNode.width,
		height: Math.max(
			1,
			roundCanvasDimension(
				(baseNode.width * imageSize.height) / imageSize.width,
			),
		),
	};
};

const getFallbackModels = (kind: AgentRunKind): AgentModel[] =>
	OPENAI_PROVIDER_MODELS.filter((model) => model.kind === kind);

const getModelKey = (
	model: Pick<AgentModel, "providerId" | "modelId">,
): string => `${model.providerId}:${model.modelId}`;

const getDefaultCapabilities = (
	kind: AgentRunKind,
): AgentImageModelCapabilities => {
	const defaultCapabilities = getFallbackModels(kind).find(
		(model) =>
			model.providerId === OPENAI_PROVIDER_ID &&
			model.modelId === OPENAI_IMAGE_DEFAULT_MODEL,
	)?.capabilities;
	if (isAgentImageModelCapabilities(defaultCapabilities)) {
		return defaultCapabilities;
	}
	return {
		type: "image",
		qualityOptions: [{ value: "auto", label: "Auto" }],
		defaultQuality: "auto",
		aspectRatios: [
			{
				value: "1:1",
				label: "1:1",
				width: 1,
				height: 1,
				size: DEFAULT_IMAGE_SIZE,
			},
		],
		defaultAspectRatio: "1:1",
		defaultSize: DEFAULT_IMAGE_SIZE,
		size: {
			mode: "fixed",
			sizes: [DEFAULT_IMAGE_SIZE],
		},
	};
};

const resolveModelsWithImageCapabilities = (
	models: AgentModel[],
	kind: AgentRunKind,
): AgentModel[] => {
	const nextModels = models.filter(
		(model) =>
			model.kind === kind &&
			model.enabled &&
			isAgentImageModelCapabilities(model.capabilities),
	);
	return nextModels.length > 0 ? nextModels : getFallbackModels(kind);
};

const useImageAgentModels = (kind: AgentRunKind): AgentModel[] => {
	const client = useAgentClient();
	const fallbackModels = useMemo(() => getFallbackModels(kind), [kind]);
	const [models, setModels] = useState<AgentModel[]>(fallbackModels);

	useEffect(() => {
		let disposed = false;
		void client
			.listModels({ kind })
			.then((items) => {
				if (disposed) return;
				setModels(resolveModelsWithImageCapabilities(items, kind));
			})
			.catch(() => {
				if (disposed) return;
				setModels(fallbackModels);
			});
		return () => {
			disposed = true;
		};
	}, [client, fallbackModels, kind]);

	return models;
};

const FieldLabel = ({
	children,
	htmlFor,
}: {
	children: React.ReactNode;
	htmlFor?: string;
}) => {
	return (
		<Label
			htmlFor={htmlFor}
			className="mb-1 block text-[11px] font-medium text-white/55"
		>
			{children}
		</Label>
	);
};

const AgentSelect = ({
	value,
	onChange,
	ariaLabel,
	options,
}: {
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
	options: { value: string; label: string }[];
}) => {
	return (
		<Select
			value={value}
			items={options}
			onValueChange={(nextValue) => onChange(String(nextValue))}
		>
			<SelectTrigger
				aria-label={ariaLabel}
				className="h-8 min-w-0 w-full rounded border border-white/10 bg-black/40 px-2 text-xs text-white outline-none hover:bg-white/10 focus-visible:outline-sky-500 data-popup-open:bg-white/10"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="bg-neutral-950 text-white shadow-black/40 outline-white/10">
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						className="text-xs data-highlighted:text-white data-highlighted:before:bg-sky-500"
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
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
	request: Pick<
		AgentRunRequest,
		"providerId" | "modelId" | "params" | "context"
	>,
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
				providerId: request.providerId,
				modelId: request.modelId,
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
	}, [
		client,
		context,
		currentProjectId,
		kind,
		params,
		request.modelId,
		request.providerId,
	]);

	return quote;
};

const useImageModelSettings = (kind: AgentRunKind) => {
	const models = useImageAgentModels(kind);
	const [model, setModel] = useState(OPENAI_IMAGE_DEFAULT_MODEL_KEY);
	const [quality, setQuality] = useState("auto");
	const [size, setSize] = useState<AgentImageSize>(DEFAULT_IMAGE_SIZE);
	const [aspectRatio, setAspectRatio] = useState("1:1");
	const selectedModel = useMemo(
		() => models.find((item) => getModelKey(item) === model) ?? null,
		[model, models],
	);
	const effectiveModel = selectedModel ?? models[0] ?? null;
	const modelValue = effectiveModel
		? getModelKey(effectiveModel)
		: OPENAI_IMAGE_DEFAULT_MODEL_KEY;
	const providerId = effectiveModel?.providerId ?? OPENAI_PROVIDER_ID;
	const modelId = effectiveModel?.modelId ?? OPENAI_IMAGE_DEFAULT_MODEL;
	const capabilities = isAgentImageModelCapabilities(
		effectiveModel?.capabilities,
	)
		? effectiveModel.capabilities
		: getDefaultCapabilities(kind);
	const qualityOptions = capabilities.qualityOptions;
	const aspectRatioOptions = capabilities.aspectRatios;

	useEffect(() => {
		if (!effectiveModel || model === getModelKey(effectiveModel)) return;
		setModel(getModelKey(effectiveModel));
	}, [effectiveModel, model]);

	useEffect(() => {
		setQuality((current) =>
			qualityOptions.some((option) => option.value === current)
				? current
				: capabilities.defaultQuality,
		);
		const normalized = normalizeAgentImageSize(capabilities, size, aspectRatio);
		if (!sameSize(size, normalized)) {
			setSize(normalized);
		}
		setAspectRatio(resolveAgentImageAspectRatio(capabilities, normalized));
	}, [aspectRatio, capabilities, qualityOptions, size]);

	const handleModelChange = (nextModel: string): AgentImageSize => {
		const nextModelDefinition =
			models.find((item) => getModelKey(item) === nextModel) ?? null;
		const nextCapabilities = isAgentImageModelCapabilities(
			nextModelDefinition?.capabilities,
		)
			? nextModelDefinition.capabilities
			: getDefaultCapabilities(kind);
		setModel(nextModel);
		setQuality((current) =>
			nextCapabilities.qualityOptions.some((option) => option.value === current)
				? current
				: nextCapabilities.defaultQuality,
		);
		const normalized = normalizeAgentImageSize(
			nextCapabilities,
			size,
			aspectRatio,
		);
		setSize(normalized);
		setAspectRatio(resolveAgentImageAspectRatio(nextCapabilities, normalized));
		return normalized;
	};

	const handleAspectRatioChange = (nextAspectRatio: string): AgentImageSize => {
		const option = aspectRatioOptions.find(
			(item) => item.value === nextAspectRatio,
		);
		if (!option) return size;
		setAspectRatio(nextAspectRatio);
		if (!option.size) return size;
		const normalized = normalizeAgentImageSize(
			capabilities,
			option.size,
			nextAspectRatio,
		);
		setSize(normalized);
		setAspectRatio(resolveAgentImageAspectRatio(capabilities, normalized));
		return normalized;
	};

	const handleSizeChange = (patch: Partial<AgentImageSize>): AgentImageSize => {
		const normalized = normalizeAgentImageSize(capabilities, {
			width: patch.width ?? size.width,
			height: patch.height ?? size.height,
		});
		setSize(normalized);
		setAspectRatio(resolveAgentImageAspectRatio(capabilities, normalized));
		return normalized;
	};

	return {
		models,
		model: modelValue,
		modelId,
		providerId,
		quality,
		size,
		aspectRatio,
		capabilities,
		qualityOptions,
		aspectRatioOptions,
		setQuality,
		setModel: handleModelChange,
		setAspectRatio: handleAspectRatioChange,
		setWidth: (width: number) => handleSizeChange({ width }),
		setHeight: (height: number) => handleSizeChange({ height }),
	};
};

const ImageSizeControls = ({
	capabilities,
	aspectRatio,
	aspectRatioOptions,
	size,
	onAspectRatioChange,
	onWidthChange,
	onHeightChange,
}: {
	capabilities: AgentImageModelCapabilities;
	aspectRatio: string;
	aspectRatioOptions: { value: string; label: string }[];
	size: AgentImageSize;
	onAspectRatioChange: (value: string) => void;
	onWidthChange: (value: number) => void;
	onHeightChange: (value: number) => void;
}) => {
	const flexibleSize =
		capabilities.size.mode === "flexible" ? capabilities.size : null;
	const widthHeightStep = flexibleSize?.multiple ?? 1;
	const minSize = flexibleSize?.multiple ?? 1;
	const maxSize = flexibleSize?.maxEdge;
	const dimensionsDisabled = capabilities.size.mode === "fixed";
	return (
		<div className="space-y-2">
			<div>
				<FieldLabel>Aspect Ratio</FieldLabel>
				<AgentSelect
					ariaLabel="图片比例"
					value={aspectRatio}
					onChange={onAspectRatioChange}
					options={aspectRatioOptions}
				/>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<ScrubbableNumberInput
					ariaLabel="图片宽度"
					label="W"
					value={size.width}
					step={widthHeightStep}
					min={minSize}
					max={maxSize}
					disabled={dimensionsDisabled}
					onValueChange={(value) => onWidthChange(Math.round(value))}
					className="h-8 rounded border border-white/10 bg-black/40 pr-2"
				/>
				<ScrubbableNumberInput
					ariaLabel="图片高度"
					label="H"
					value={size.height}
					step={widthHeightStep}
					min={minSize}
					max={maxSize}
					disabled={dimensionsDisabled}
					onValueChange={(value) => onHeightChange(Math.round(value))}
					className="h-8 rounded border border-white/10 bg-black/40 pr-2"
				/>
			</div>
		</div>
	);
};

const GenerateImageAgentPanel = ({ node }: { node: ImageCanvasNode }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const hasOpenAiApiKey = useAiProviderConfigStore(
		(state) => state.config.openai.apiKey.trim().length > 0,
	);
	const appendNonUndoableCanvasNodeToBaseline = useStudioHistoryStore(
		(state) => state.appendNonUndoableCanvasNodeToBaseline,
	);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const latestError = useNodeLatestFailedAgentRunError(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [prompt, setPrompt] = useState("");
	const settings = useImageModelSettings("image.generate");
	const [variants, setVariants] = useState(1);
	const maxVariants = settings.capabilities.maxVariants ?? 1;
	useEffect(() => {
		setVariants((current) => clampNumber(Math.round(current), 1, maxVariants));
	}, [maxVariants]);
	const quoteParams = useMemo(
		() => ({
			providerId: settings.providerId,
			modelId: settings.modelId,
			params: {
				model: settings.modelId,
				quality: settings.quality,
				size: formatAgentImageSize(settings.size),
				aspectRatio: settings.aspectRatio,
				variants,
			},
			context: {},
		}),
		[
			settings.aspectRatio,
			settings.modelId,
			settings.providerId,
			settings.quality,
			settings.size,
			variants,
		],
	);
	const quote = useCreditQuote("image.generate", quoteParams);

	const canSubmit = Boolean(
		currentProjectId && prompt.trim() && !busy && hasOpenAiApiKey,
	);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!currentProjectId || !canSubmit) return;
		const projectBefore = useProjectStore.getState().currentProject;
		const beforeNode = projectBefore?.canvas.nodes.find(
			(item) => item.id === node.id,
		);
		if (beforeNode?.type === "image") {
			const displaySize = resolveImageNodeDisplaySize(
				beforeNode,
				settings.size,
			);
			if (
				beforeNode.width !== displaySize.width ||
				beforeNode.height !== displaySize.height
			) {
				updateCanvasNodeLayout(beforeNode.id, {
					width: displaySize.width,
					height: displaySize.height,
				});
			}
			const latestNode = useProjectStore
				.getState()
				.currentProject?.canvas.nodes.find((item) => item.id === beforeNode.id);
			if (latestNode) {
				appendNonUndoableCanvasNodeToBaseline(latestNode);
			}
		}
		void startRun({
			providerId: settings.providerId,
			modelId: settings.modelId,
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
			<div>
				<FieldLabel>Prompt</FieldLabel>
				<Textarea
					value={prompt}
					onChange={(event) => setPrompt(event.currentTarget.value)}
					placeholder="Describe the image to generate"
					className="min-h-20 border-white/10 bg-black/40 text-xs text-white placeholder:text-white/30 focus:outline-sky-500"
				/>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div>
					<FieldLabel>Model</FieldLabel>
					<AgentSelect
						ariaLabel="生图模型"
						value={settings.model}
						onChange={settings.setModel}
						options={settings.models.map((option) => ({
							value: getModelKey(option),
							label: option.label,
						}))}
					/>
				</div>
				<div>
					<FieldLabel>Quality</FieldLabel>
					<AgentSelect
						ariaLabel="图片质量"
						value={settings.quality}
						onChange={settings.setQuality}
						options={settings.qualityOptions}
					/>
				</div>
			</div>
			<ImageSizeControls
				capabilities={settings.capabilities}
				aspectRatio={settings.aspectRatio}
				aspectRatioOptions={settings.aspectRatioOptions}
				size={settings.size}
				onAspectRatioChange={settings.setAspectRatio}
				onWidthChange={settings.setWidth}
				onHeightChange={settings.setHeight}
			/>
			<div>
				<FieldLabel>Variants</FieldLabel>
				<ScrubbableNumberInput
					ariaLabel="Variant 数量"
					label="N"
					value={variants}
					step={1}
					min={1}
					max={maxVariants}
					onValueChange={(value) =>
						setVariants(clampNumber(Math.round(value), 1, maxVariants))
					}
					className="h-8 rounded border border-white/10 bg-black/40 pr-2"
				/>
			</div>
			<div className="flex items-center justify-between">
				<div className="text-[11px] text-white/55">
					<QuoteLine quote={quote} />
				</div>
				<Button
					type="submit"
					disabled={!canSubmit}
					className="h-8 gap-1 rounded bg-sky-500 px-3 text-xs font-medium text-white hover:bg-sky-400 active:bg-sky-600 data-disabled:cursor-not-allowed data-disabled:bg-white/10 data-disabled:text-white/35"
				>
					<Sparkles className="size-3" />
					Generate
				</Button>
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
	const appendNonUndoableCanvasNodeToBaseline = useStudioHistoryStore(
		(state) => state.appendNonUndoableCanvasNodeToBaseline,
	);
	const startRun = useStartAgentRun();
	const activeRun = useNodeActiveAgentRun(node.id);
	const latestError = useNodeLatestFailedAgentRunError(node.id);
	const busy = isRunBusy(activeRun?.status);
	const [instruction, setInstruction] = useState("");
	const settings = useImageModelSettings("image.edit");
	const quoteParams = useMemo(
		() => ({
			providerId: settings.providerId,
			modelId: settings.modelId,
			params: {
				model: settings.modelId,
				quality: settings.quality,
				size: formatAgentImageSize(settings.size),
				aspectRatio: settings.aspectRatio,
			},
			context: {},
		}),
		[
			settings.aspectRatio,
			settings.modelId,
			settings.providerId,
			settings.quality,
			settings.size,
		],
	);
	const quote = useCreditQuote("image.edit", quoteParams);

	const canSubmit = Boolean(
		currentProjectId && instruction.trim() && !busy && hasOpenAiApiKey,
	);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!currentProjectId || !node.assetId || !canSubmit) return;
		const targetDisplaySize = resolveImageNodeDisplaySize(node, settings.size);
		const targetNodeId = createCanvasNode({
			type: "image",
			name: "Image Edit",
			assetId: null,
			x: node.x + node.width + 40,
			y: node.y,
			width: targetDisplaySize.width,
			height: targetDisplaySize.height,
		});
		const latestProject = useProjectStore.getState().currentProject;
		const targetNode = latestProject?.canvas.nodes.find(
			(item) => item.id === targetNodeId,
		);
		if (targetNode) {
			appendNonUndoableCanvasNodeToBaseline(targetNode);
		}
		setSelectedNodeIds([targetNodeId]);
		void startRun({
			providerId: settings.providerId,
			modelId: settings.modelId,
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
				model: settings.modelId,
				quality: settings.quality,
				size: formatAgentImageSize(settings.size),
				aspectRatio: settings.aspectRatio,
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
			<Textarea
				value={instruction}
				onChange={(event) => setInstruction(event.currentTarget.value)}
				placeholder="Describe the edit"
				className="min-h-16 border-white/10 bg-black/40 text-xs text-white placeholder:text-white/30 focus:outline-violet-500"
			/>
			<div>
				<FieldLabel>Model</FieldLabel>
				<AgentSelect
					ariaLabel="编辑模型"
					value={settings.model}
					onChange={settings.setModel}
					options={settings.models.map((option) => ({
						value: getModelKey(option),
						label: option.label,
					}))}
				/>
			</div>
			<div>
				<FieldLabel>Quality</FieldLabel>
				<AgentSelect
					ariaLabel="编辑图片质量"
					value={settings.quality}
					onChange={settings.setQuality}
					options={settings.qualityOptions}
				/>
			</div>
			<ImageSizeControls
				capabilities={settings.capabilities}
				aspectRatio={settings.aspectRatio}
				aspectRatioOptions={settings.aspectRatioOptions}
				size={settings.size}
				onAspectRatioChange={settings.setAspectRatio}
				onWidthChange={settings.setWidth}
				onHeightChange={settings.setHeight}
			/>
			<div className="flex items-center justify-between">
				<div className="text-[11px] text-white/55">
					<QuoteLine quote={quote} />
				</div>
				<Button
					type="submit"
					disabled={!canSubmit}
					className="h-8 gap-1 rounded bg-violet-500 px-3 text-xs font-medium text-white hover:bg-violet-400 active:bg-violet-600 data-disabled:cursor-not-allowed data-disabled:bg-white/10 data-disabled:text-white/35"
				>
					<Wand2 className="size-3" />
					Edit
				</Button>
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
