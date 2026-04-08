import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_SRC_DIR = path.resolve(CURRENT_DIR, "..");

const CORE_FILES = [
	path.join(
		EDITOR_SRC_DIR,
		"scene-editor/contexts/TimelineContext.tsx",
	),
	path.join(
		EDITOR_SRC_DIR,
		"scene-editor/audio/TimelineAudioMixManager.tsx",
	),
	path.join(EDITOR_SRC_DIR, "element/AudioClip/model.ts"),
	path.join(EDITOR_SRC_DIR, "element/VideoClip/model.ts"),
	path.join(
		EDITOR_SRC_DIR,
		"scene-editor/components/PreviewLoudnessMeterCanvas.tsx",
	),
] as const;

describe("audio import regression", () => {
	it("核心调用点不再依赖旧 editor/audio 路径", async () => {
		for (const file of CORE_FILES) {
			const content = await readFile(file, "utf-8");
			expect(content).not.toContain("@/scene-editor/audio/audioEngine");
			expect(content).not.toContain("@/scene-editor/audio/audioPlayback");
		}
	});
});
