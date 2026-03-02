import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const CORE_FILES = [
	"/Users/wz/Developer/ai-nle/packages/editor/src/editor/contexts/TimelineContext.tsx",
	"/Users/wz/Developer/ai-nle/packages/editor/src/editor/audio/TimelineAudioMixManager.tsx",
	"/Users/wz/Developer/ai-nle/packages/editor/src/dsl/AudioClip/model.ts",
	"/Users/wz/Developer/ai-nle/packages/editor/src/dsl/VideoClip/model.ts",
	"/Users/wz/Developer/ai-nle/packages/editor/src/editor/components/PreviewLoudnessMeterCanvas.tsx",
] as const;

describe("audio import regression", () => {
	it("核心调用点不再依赖旧 editor/audio 路径", async () => {
		for (const file of CORE_FILES) {
			const content = await readFile(file, "utf-8");
			expect(content).not.toContain("@/editor/audio/audioEngine");
			expect(content).not.toContain("@/editor/audio/audioPlayback");
		}
	});
});
