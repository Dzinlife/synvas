// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetFontRegistryForTests,
	fontRegistry,
	type FontDefinition,
} from "./fontRegistry";

interface MockTypeface {
	family: string;
	coverage: Set<string>;
}

const mocks = vi.hoisted(() => {
	const fontPayloadByUrl = new Map<string, { family: string; text: string }>();

	const encodePayload = (payload: {
		family: string;
		text: string;
	}): ArrayBuffer => {
		const bytes = new TextEncoder().encode(JSON.stringify(payload));
		return bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		);
	};

	const decodePayload = (
		bytes: Uint8Array,
	): { family: string; text: string } | null => {
		try {
			const json = new TextDecoder().decode(bytes);
			const parsed = JSON.parse(json) as { family?: string; text?: string };
			if (
				typeof parsed.family !== "string" ||
				typeof parsed.text !== "string"
			) {
				return null;
			}
			return {
				family: parsed.family,
				text: parsed.text,
			};
		} catch {
			return null;
		}
	};

	const setFontPayload = (url: string, payload: { family: string; text: string }) => {
		fontPayloadByUrl.set(url, payload);
	};

	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		const payload = fontPayloadByUrl.get(url);
		if (!payload) {
			return new Response("", { status: 404 });
		}
		return new Response(encodePayload(payload), { status: 200 });
	});

	const typefaceFontProvider = {
		registerFont: vi.fn(),
	};

	const fromBytes = vi.fn((bytes: Uint8Array) => ({
		type: "bytes" as const,
		bytes,
	}));

	const makeTypeface = vi.fn(
		(data: { type: "bytes"; bytes: Uint8Array }) => {
			if (data.type !== "bytes") {
				return null;
			}
			const payload = decodePayload(data.bytes);
			if (!payload) {
				return null;
			}
			return {
				family: payload.family,
				coverage: new Set(Array.from(payload.text)),
			} satisfies MockTypeface;
		},
	);

	return {
		fetchMock,
		fromBytes,
		makeTypeface,
		typefaceFontProvider,
		setFontPayload,
		clearState: () => {
			fontPayloadByUrl.clear();
			setFontPayload("/fonts/Inter-Latin-wght-normal.woff2", {
				family: "Inter",
				text: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-",
			});
			setFontPayload("/fonts/NotoSansSC-Base-400.woff2", {
				family: "Noto Sans SC",
				text: "中文测试花字演示「」（）",
			});
			setFontPayload("/fonts/AppleColorEmoji-Linux.ttf", {
				family: "Apple Color Emoji",
				text: "🙂😀❤️🇨🇳",
			});
			typefaceFontProvider.registerFont.mockClear();
			fromBytes.mockClear();
			makeTypeface.mockClear();
			fetchMock.mockClear();
		},
	};
});

vi.mock("react-skia-lite", () => ({
	Skia: {
		TypefaceFontProvider: {
			Make: () => mocks.typefaceFontProvider,
		},
		Data: {
			fromBytes: mocks.fromBytes,
		},
		Typeface: {
			MakeFreeTypeFaceFromData: mocks.makeTypeface,
		},
	},
}));

beforeEach(() => {
	mocks.clearState();
	__resetFontRegistryForTests();
	vi.stubGlobal("fetch", mocks.fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const expectRequestedUrls = (expected: string[]) => {
	const calls = mocks.fetchMock.mock.calls.map(([url]) =>
		typeof url === "string" ? url : url.toString(),
	);
	expect(calls).toEqual(expected);
};

describe("FontRegistry", () => {
	it("latin 文本只会懒加载 Inter 全量字体且会复用缓存", async () => {
		await fontRegistry.ensureCoverage({ text: "Hello" });
		await fontRegistry.ensureCoverage({ text: "World" });

		expectRequestedUrls(["/fonts/Inter-Latin-wght-normal.woff2"]);
		expect(mocks.typefaceFontProvider.registerFont).toHaveBeenCalledTimes(1);
		expect(fontRegistry.getParagraphRunPlan("Hello")).toEqual([
			{
				text: "Hello",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "primary",
			},
		]);
	});

	it("cjk 文本只会懒加载 Noto Sans SC 且 run 标记 fallback", async () => {
		await fontRegistry.ensureCoverage({ text: "中文" });

		expectRequestedUrls(["/fonts/NotoSansSC-Base-400.woff2"]);
		expect(fontRegistry.getParagraphRunPlan("中文")).toEqual([
			{
				text: "中文",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "fallback",
			},
		]);
	});

	it("emoji 文本只会懒加载 Apple Color Emoji 且 run 标记 fallback", async () => {
		await fontRegistry.ensureCoverage({ text: "🙂" });

		expectRequestedUrls(["/fonts/AppleColorEmoji-Linux.ttf"]);
		expect(fontRegistry.getParagraphRunPlan("🙂")).toEqual([
			{
				text: "🙂",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "fallback",
			},
		]);
	});

	it("混排文本会按 Unicode 语言切 run，但每段使用同一条链", () => {
		expect(fontRegistry.getParagraphRunPlan("A中🙂B")).toEqual([
			{
				text: "A",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "primary",
			},
			{
				text: "中",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "fallback",
			},
			{
				text: "🙂",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "fallback",
			},
			{
				text: "B",
				fontFamilies: ["Inter", "Noto Sans SC", "Apple Color Emoji"],
				status: "primary",
			},
		]);
	});

	it("支持调用方传入自定义 fallback 链并按链路懒加载", async () => {
		const customDefinition: FontDefinition = {
			id: "latin-custom",
			family: "My Latin",
			languages: ["latin"],
			source: {
				kind: "url",
				provider: "custom",
				url: "https://font.test/my-latin.ttf",
			},
			priority: 0,
		};
		mocks.setFontPayload("https://font.test/my-latin.ttf", {
			family: "My Latin",
			text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		});
		fontRegistry.registerFontDefinitions([customDefinition]);

		await fontRegistry.ensureCoverage({
			text: "HELLO",
			fallbackChain: ["My Latin"],
		});

		expectRequestedUrls(["https://font.test/my-latin.ttf"]);
		expect(
			fontRegistry.getParagraphRunPlan("HELLO", {
				fallbackChain: ["My Latin"],
			}),
		).toEqual([
			{
				text: "HELLO",
				fontFamilies: ["My Latin"],
				status: "primary",
			},
		]);
	});

	it("支持设置默认 fallback 链", () => {
		fontRegistry.setDefaultFallbackChain([
			"Noto Sans SC",
			"Inter",
			"Apple Color Emoji",
		]);
		expect(fontRegistry.getDefaultFallbackChain()).toEqual([
			"Noto Sans SC",
			"Inter",
			"Apple Color Emoji",
		]);
		expect(fontRegistry.getParagraphRunPlan("中")).toEqual([
			{
				text: "中",
				fontFamilies: ["Noto Sans SC", "Inter", "Apple Color Emoji"],
				status: "primary",
			},
		]);
		expect(fontRegistry.getParagraphRunPlan("A")).toEqual([
			{
				text: "A",
				fontFamilies: ["Noto Sans SC", "Inter", "Apple Color Emoji"],
				status: "fallback",
			},
		]);
	});

	it("不会发起任何字体子集 css2 请求", async () => {
		await fontRegistry.ensureCoverage({ text: "A中🙂" });
		const urls = mocks.fetchMock.mock.calls.map(([url]) =>
			typeof url === "string" ? url : url.toString(),
		);
		expect(urls.some((url) => url.includes("fonts.googleapis.com/css2"))).toBe(
			false,
		);
	});
});
