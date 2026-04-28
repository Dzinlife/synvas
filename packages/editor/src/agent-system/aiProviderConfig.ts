import { OPENAI_IMAGE_DEFAULT_ENDPOINT } from "@synvas/agent";
import { create } from "zustand";

export const AI_PROVIDER_CONFIG_STORAGE_KEY = "synvas.aiProviderConfig.v1";

export interface OpenAiProviderConfig {
	endpoint: string;
	apiKey: string;
}

export interface AiProviderConfig {
	openai: OpenAiProviderConfig;
}

interface AiProviderConfigStoreState {
	config: AiProviderConfig;
	setOpenAiConfig: (config: Partial<OpenAiProviderConfig>) => void;
	clearOpenAiConfig: () => void;
}

const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
	openai: {
		endpoint: OPENAI_IMAGE_DEFAULT_ENDPOINT,
		apiKey: "",
	},
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const normalizeOpenAiEndpoint = (endpoint: string): string => {
	const trimmed = endpoint.trim().replace(/\/+$/g, "");
	if (!trimmed) return OPENAI_IMAGE_DEFAULT_ENDPOINT;
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed;
	if (
		trimmed.startsWith("localhost") ||
		trimmed.startsWith("127.0.0.1") ||
		trimmed.startsWith("[::1]")
	) {
		return `http://${trimmed}`;
	}
	return `https://${trimmed}`;
};

const normalizeOpenAiConfig = (value: unknown): OpenAiProviderConfig => {
	if (!isRecord(value)) {
		return { ...DEFAULT_AI_PROVIDER_CONFIG.openai };
	}
	return {
		endpoint: normalizeOpenAiEndpoint(
			typeof value.endpoint === "string" ? value.endpoint : "",
		),
		apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
	};
};

export const normalizeAiProviderConfig = (value: unknown): AiProviderConfig => {
	if (!isRecord(value)) {
		return {
			openai: { ...DEFAULT_AI_PROVIDER_CONFIG.openai },
		};
	}
	return {
		openai: normalizeOpenAiConfig(value.openai),
	};
};

const readAiProviderConfig = (): AiProviderConfig => {
	if (typeof window === "undefined") {
		return {
			openai: { ...DEFAULT_AI_PROVIDER_CONFIG.openai },
		};
	}
	try {
		const raw = window.localStorage.getItem(AI_PROVIDER_CONFIG_STORAGE_KEY);
		return normalizeAiProviderConfig(raw ? JSON.parse(raw) : null);
	} catch {
		return {
			openai: { ...DEFAULT_AI_PROVIDER_CONFIG.openai },
		};
	}
};

const writeAiProviderConfig = (config: AiProviderConfig): void => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			AI_PROVIDER_CONFIG_STORAGE_KEY,
			JSON.stringify(config),
		);
	} catch {}
};

export const useAiProviderConfigStore = create<AiProviderConfigStoreState>(
	(set) => ({
		config: readAiProviderConfig(),
		setOpenAiConfig: (patch) => {
			set((state) => {
				const config = normalizeAiProviderConfig({
					...state.config,
					openai: {
						...state.config.openai,
						...patch,
					},
				});
				writeAiProviderConfig(config);
				return { config };
			});
		},
		clearOpenAiConfig: () => {
			const config = {
				openai: { ...DEFAULT_AI_PROVIDER_CONFIG.openai },
			};
			writeAiProviderConfig(config);
			set({ config });
		},
	}),
);
