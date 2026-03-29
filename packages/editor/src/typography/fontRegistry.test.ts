// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetFontRegistryForTests,
	FONT_REGISTRY_PRIMARY_FAMILY,
	fontRegistry,
} from "./fontRegistry";

interface MockTypeface {
	id: string;
	family: string;
	coverage: Set<string>;
}

const mocks = vi.hoisted(() => {
	const localCoverage = new Set<string>([
		"花",
		"字",
		"演",
		"示",
		"D",
		"e",
		"m",
		"o",
	]);
	const familyRuleByName = new Map<string, (char: string) => boolean>();
	const fontPayloadByUrl = new Map<string, { family: string; text: string }>();
	const cssFailureFamilies = new Set<string>();
	const dbRecords = new Map<
		string,
		{
			key: string;
			family: string;
			weight: number | null;
			textHash: string;
			text: string;
			codePoints: number[];
			bytes: ArrayBuffer;
			updatedAt: number;
		}
	>();
	let dbInitialized = false;
	let typefaceSequence = 0;

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

	const resolveFamily = (familyToken: string): string => {
		const [rawFamily] = familyToken.split(":");
		return rawFamily?.replace(/\+/g, " ") ?? familyToken;
	};

	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("fonts.googleapis.com/css2")) {
			const parsedUrl = new URL(url);
			const family = resolveFamily(parsedUrl.searchParams.get("family") ?? "");
			if (cssFailureFamilies.has(family)) {
				return new Response("", { status: 503 });
			}
			const text = parsedUrl.searchParams.get("text") ?? "";
			const fontUrl = `https://font.test/${encodeURIComponent(family)}/${encodeURIComponent(text)}`;
			fontPayloadByUrl.set(fontUrl, {
				family,
				text,
			});
			return new Response(
				`@font-face { src: url(${fontUrl}) format('woff2'); }`,
				{ status: 200 },
			);
		}
		if (url.startsWith("https://font.test/")) {
			const payload = fontPayloadByUrl.get(url);
			if (!payload) {
				return new Response("", { status: 404 });
			}
			return new Response(encodePayload(payload), { status: 200 });
		}
		return new Response("", { status: 404 });
	});

	const typefaceFontProvider = {
		registerFont: vi.fn(),
	};

	const fromURI = vi.fn(async (uri: string) => ({
		type: "uri" as const,
		uri,
	}));
	const fromBytes = vi.fn((bytes: Uint8Array) => ({
		type: "bytes" as const,
		bytes,
	}));
	const makeTypeface = vi.fn(
		(
			data: { type: "uri"; uri: string } | { type: "bytes"; bytes: Uint8Array },
		) => {
			let family = FONT_REGISTRY_PRIMARY_FAMILY;
			let textChars = [...localCoverage];
			if (data.type === "bytes") {
				const payload = decodePayload(data.bytes);
				if (!payload) {
					return null;
				}
				family = payload.family;
				textChars = Array.from(payload.text);
			}
			const familyRule = familyRuleByName.get(family);
			const coverage = new Set(
				textChars.filter((char) => {
					if (!familyRule) return true;
					return familyRule(char);
				}),
			);
			typefaceSequence += 1;
			return {
				id: `${family}-${typefaceSequence}`,
				family,
				coverage,
			} satisfies MockTypeface;
		},
	);
	const makeFont = vi.fn((typeface: MockTypeface) => ({
		setLinearMetrics: vi.fn(),
		setSubpixel: vi.fn(),
		getGlyphIDs: (char: string) => [typeface.coverage.has(char) ? 1 : 0],
		dispose: vi.fn(),
	}));

	const openDBMock = vi.fn(
		async (
			_name: string,
			_version: number,
			options?: {
				upgrade?: (db: {
					objectStoreNames: { contains: (storeName: string) => boolean };
					createObjectStore: (
						storeName: string,
						config: { keyPath: string },
					) => void;
				}) => void;
			},
		) => {
			if (!dbInitialized) {
				options?.upgrade?.({
					objectStoreNames: {
						contains: () => dbInitialized,
					},
					createObjectStore: () => {
						dbInitialized = true;
					},
				});
				dbInitialized = true;
			}
			return {
				get: async (_storeName: string, key: string) => dbRecords.get(key),
				put: async (
					_storeName: string,
					value: {
						key: string;
						family: string;
						weight: number | null;
						textHash: string;
						text: string;
						codePoints: number[];
						bytes: ArrayBuffer;
						updatedAt: number;
					},
				) => {
					dbRecords.set(value.key, value);
				},
			};
		},
	);

	return {
		fetchMock,
		fromURI,
		fromBytes,
		makeTypeface,
		makeFont,
		typefaceFontProvider,
		openDBMock,
		localCoverage,
		familyRuleByName,
		cssFailureFamilies,
		dbRecords,
		clearState: () => {
			localCoverage.clear();
			localCoverage.add("花");
			localCoverage.add("字");
			localCoverage.add("演");
			localCoverage.add("示");
			localCoverage.add("D");
			localCoverage.add("e");
			localCoverage.add("m");
			localCoverage.add("o");
			familyRuleByName.clear();
			cssFailureFamilies.clear();
			fontPayloadByUrl.clear();
			dbRecords.clear();
			typefaceSequence = 0;
			typefaceFontProvider.registerFont.mockClear();
			fromURI.mockClear();
			fromBytes.mockClear();
			makeTypeface.mockClear();
			makeFont.mockClear();
			fetchMock.mockClear();
			openDBMock.mockClear();
			dbInitialized = false;
		},
	};
});

vi.mock("idb", () => ({
	openDB: mocks.openDBMock,
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		TypefaceFontProvider: {
			Make: () => mocks.typefaceFontProvider,
		},
		Data: {
			fromURI: mocks.fromURI,
			fromBytes: mocks.fromBytes,
		},
		Typeface: {
			MakeFreeTypeFaceFromData: mocks.makeTypeface,
		},
		Font: mocks.makeFont,
	},
}));

const pickGoogleCssCalls = () => {
	return mocks.fetchMock.mock.calls.filter(([url]) => {
		const value = typeof url === "string" ? url : url.toString();
		return value.includes("fonts.googleapis.com/css2");
	});
};

beforeEach(() => {
	mocks.clearState();
	__resetFontRegistryForTests();
	vi.stubGlobal("fetch", mocks.fetchMock);
	vi.stubGlobal("indexedDB", {});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("FontRegistry", () => {
	it("本地子集已覆盖字符时不会发起网络请求", async () => {
		await fontRegistry.ensureCoverage({ text: "花" });

		expect(mocks.fromURI).toHaveBeenCalledWith(
			"/fonts/NotoSansSC-Base-400.woff2",
		);
		expect(mocks.fetchMock).not.toHaveBeenCalled();
		expect(fontRegistry.getParagraphRunPlan("花")).toEqual([
			{
				text: "花",
				fontFamilies: ["Noto Sans SC"],
				status: "primary",
			},
		]);
	});

	it("新增缺字会防抖聚合请求并去重", async () => {
		const first = fontRegistry.ensureCoverage({ text: "中" });
		const second = fontRegistry.ensureCoverage({ text: "文" });
		await Promise.all([first, second]);

		const cssCalls = pickGoogleCssCalls();
		expect(cssCalls).toHaveLength(1);
		const cssUrl = new URL(String(cssCalls[0]?.[0]));
		const requestedText = cssUrl.searchParams.get("text") ?? "";
		expect(requestedText).toContain("中");
		expect(requestedText).toContain("文");
	});

	it("主字体子集拉取成功且 glyph 可用时保持主字体渲染", async () => {
		mocks.familyRuleByName.set("Noto Sans SC", (char) => char === "测");

		await fontRegistry.ensureCoverage({ text: "测" });

		const runPlan = fontRegistry.getParagraphRunPlan("测");
		expect(runPlan).toHaveLength(1);
		expect(runPlan[0]?.text).toBe("测");
		expect(runPlan[0]?.status).toBe("primary");
		expect(runPlan[0]?.fontFamilies[0]?.startsWith("Noto Sans SC")).toBe(true);
		expect(pickGoogleCssCalls()).toHaveLength(1);
	});

	it("主字体确认不含字符后才触发 fallback family", async () => {
		mocks.familyRuleByName.set("Noto Sans SC", () => false);
		mocks.familyRuleByName.set("Noto Sans", () => false);
		mocks.familyRuleByName.set("Noto Sans JP", () => false);
		mocks.familyRuleByName.set("Noto Sans KR", () => false);
		mocks.familyRuleByName.set("Noto Color Emoji", (char) => char === "🙂");

		await fontRegistry.ensureCoverage({ text: "🙂" });

		const runPlan = fontRegistry.getParagraphRunPlan("🙂");
		expect(runPlan).toHaveLength(1);
		expect(runPlan[0]?.text).toBe("🙂");
		expect(runPlan[0]?.status).toBe("fallback");
		expect(runPlan[0]?.fontFamilies[0]).toBe("Noto Sans SC");
		expect(runPlan[0]?.fontFamilies[1]?.startsWith("Noto Color Emoji")).toBe(
			true,
		);
	});

	it("主字体请求失败时不会进入 fallback（严格模式）", async () => {
		mocks.cssFailureFamilies.add("Noto Sans SC");
		mocks.familyRuleByName.set("Noto Color Emoji", (char) => char === "🙂");

		await fontRegistry.ensureCoverage({ text: "🙂" });

		const runPlan = fontRegistry.getParagraphRunPlan("🙂");
		expect(runPlan).toEqual([
			{
				text: "🙂",
				fontFamilies: ["Noto Sans SC"],
				status: "primary",
			},
		]);
		expect(pickGoogleCssCalls()).toHaveLength(1);
	});

	it("IndexedDB 命中后刷新可直接恢复 coverage 且不重复下载", async () => {
		mocks.familyRuleByName.set("Noto Sans SC", (char) => char === "测");
		await fontRegistry.ensureCoverage({ text: "测" });
		expect(pickGoogleCssCalls()).toHaveLength(1);
		expect(mocks.dbRecords.size).toBeGreaterThan(0);

		__resetFontRegistryForTests();
		mocks.fetchMock.mockClear();
		await fontRegistry.ensureCoverage({ text: "测" });
		expect(pickGoogleCssCalls()).toHaveLength(0);
		const runPlan = fontRegistry.getParagraphRunPlan("测");
		expect(runPlan).toHaveLength(1);
		expect(runPlan[0]?.text).toBe("测");
		expect(runPlan[0]?.status).toBe("primary");
		expect(runPlan[0]?.fontFamilies[0]?.startsWith("Noto Sans SC")).toBe(true);
	});
});
