// @vitest-environment jsdom

import { OPENAI_IMAGE_DEFAULT_ENDPOINT } from "@synvas/agent";
import { beforeEach, describe, expect, it } from "vitest";
import {
	AI_PROVIDER_CONFIG_STORAGE_KEY,
	normalizeAiProviderConfig,
	normalizeOpenAiEndpoint,
	useAiProviderConfigStore,
} from "./aiProviderConfig";

describe("ai provider config", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useAiProviderConfigStore.setState({
			config: {
				openai: {
					endpoint: OPENAI_IMAGE_DEFAULT_ENDPOINT,
					apiKey: "",
				},
			},
		});
	});

	it("会规范化 OpenAI endpoint", () => {
		expect(normalizeOpenAiEndpoint(" https://proxy.test/v1/// ")).toBe(
			"https://proxy.test/v1",
		);
		expect(normalizeOpenAiEndpoint("api.openai.com/v1")).toBe(
			"https://api.openai.com/v1",
		);
		expect(normalizeOpenAiEndpoint("localhost:8787/v1")).toBe(
			"http://localhost:8787/v1",
		);
		expect(normalizeOpenAiEndpoint("   ")).toBe(OPENAI_IMAGE_DEFAULT_ENDPOINT);
	});

	it("会持久化 OpenAI BYOK 配置", () => {
		useAiProviderConfigStore.getState().setOpenAiConfig({
			endpoint: "https://proxy.test/v1///",
			apiKey: " sk-test ",
		});

		const stored = JSON.parse(
			window.localStorage.getItem(AI_PROVIDER_CONFIG_STORAGE_KEY) ?? "{}",
		) as unknown;
		expect(stored).toEqual({
			openai: {
				endpoint: "https://proxy.test/v1",
				apiKey: "sk-test",
			},
		});
	});

	it("clear 会保留默认 endpoint 并清空 key", () => {
		useAiProviderConfigStore.getState().setOpenAiConfig({
			endpoint: "https://proxy.test/v1",
			apiKey: "sk-test",
		});

		useAiProviderConfigStore.getState().clearOpenAiConfig();

		expect(useAiProviderConfigStore.getState().config).toEqual({
			openai: {
				endpoint: OPENAI_IMAGE_DEFAULT_ENDPOINT,
				apiKey: "",
			},
		});
	});

	it("会从未知结构回退到默认配置", () => {
		expect(
			normalizeAiProviderConfig({ openai: { endpoint: "", apiKey: 1 } }),
		).toEqual({
			openai: {
				endpoint: OPENAI_IMAGE_DEFAULT_ENDPOINT,
				apiKey: "",
			},
		});
	});
});
