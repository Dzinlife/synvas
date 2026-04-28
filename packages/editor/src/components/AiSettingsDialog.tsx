import { OPENAI_IMAGE_DEFAULT_ENDPOINT } from "@synvas/agent";
import { KeyRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useAiProviderConfigStore } from "@/agent-system";

export const AiSettingsDialog = () => {
	const config = useAiProviderConfigStore((state) => state.config);
	const setOpenAiConfig = useAiProviderConfigStore(
		(state) => state.setOpenAiConfig,
	);
	const clearOpenAiConfig = useAiProviderConfigStore(
		(state) => state.clearOpenAiConfig,
	);
	const hasApiKey = config.openai.apiKey.trim().length > 0;
	const [open, setOpen] = useState(false);
	const [endpoint, setEndpoint] = useState(config.openai.endpoint);
	const [apiKey, setApiKey] = useState(config.openai.apiKey);
	const endpointInputId = useId();
	const apiKeyInputId = useId();

	useEffect(() => {
		if (!open) return;
		setEndpoint(config.openai.endpoint);
		setApiKey(config.openai.apiKey);
	}, [config.openai.apiKey, config.openai.endpoint, open]);

	const handleSave = () => {
		setOpenAiConfig({
			endpoint,
			apiKey,
		});
		setOpen(false);
	};

	const handleClear = () => {
		clearOpenAiConfig();
		setEndpoint(OPENAI_IMAGE_DEFAULT_ENDPOINT);
		setApiKey("");
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
					hasApiKey
						? "bg-emerald-700 text-white hover:bg-emerald-600"
						: "bg-neutral-700 text-white hover:bg-neutral-600"
				}`}
				title="配置 AI Provider"
			>
				<KeyRound className="size-3" />
				<span>AI 设置</span>
			</DialogTrigger>
			<DialogContent className="max-w-md">
				<div className="grid gap-4 p-4">
					<div className="space-y-1">
						<DialogTitle>AI 设置</DialogTitle>
						<DialogDescription>
							配置 OpenAI BYOK 后，Image Agent 会直接调用你的 endpoint。
						</DialogDescription>
					</div>
					<div className="grid gap-3">
						<label
							htmlFor={endpointInputId}
							className="grid gap-1 text-xs text-neutral-300"
						>
							OpenAI Endpoint
							<input
								id={endpointInputId}
								type="url"
								value={endpoint}
								placeholder={OPENAI_IMAGE_DEFAULT_ENDPOINT}
								onChange={(event) => setEndpoint(event.currentTarget.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-blue-400"
							/>
						</label>
						<label
							htmlFor={apiKeyInputId}
							className="grid gap-1 text-xs text-neutral-300"
						>
							OpenAI API Key
							<input
								id={apiKeyInputId}
								type="password"
								value={apiKey}
								placeholder="sk-..."
								onChange={(event) => setApiKey(event.currentTarget.value)}
								className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-neutral-100 outline-none focus:border-blue-400"
							/>
						</label>
					</div>
					<div className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={handleClear}
							className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-700"
						>
							清除
						</button>
						<div className="flex items-center gap-2">
							<DialogClose className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 transition-colors hover:bg-neutral-600">
								关闭
							</DialogClose>
							<button
								type="button"
								onClick={handleSave}
								className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-500"
							>
								保存
							</button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};
