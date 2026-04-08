import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveProjectOpfsFile,
	writeProjectFileToOpfsAtPath,
	writeProjectFileToOpfs,
} from "./projectOpfsStorage";

const encoder = new TextEncoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
};

const toUint8Array = async (data: unknown): Promise<Uint8Array> => {
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (typeof data === "string") return encoder.encode(data);
	if (
		typeof data === "object" &&
		data !== null &&
		"arrayBuffer" in data &&
		typeof data.arrayBuffer === "function"
	) {
		const buffer = await data.arrayBuffer();
		return new Uint8Array(buffer);
	}
	throw new Error("不支持的写入数据类型");
};

class MemoryFileHandle {
	kind = "file" as const;

	private content: Uint8Array<ArrayBufferLike> = new Uint8Array();

	constructor(public readonly name: string) {}

	async createWritable(): Promise<{
		write: (data: unknown) => Promise<void>;
		close: () => Promise<void>;
	}> {
		return {
			write: async (data: unknown) => {
				this.content = await toUint8Array(data);
			},
			close: async () => {},
		};
	}

	async getFile(): Promise<File> {
		const content = this.content.slice();
		return {
			name: this.name,
			arrayBuffer: async () => toArrayBuffer(content),
		} as unknown as File;
	}
}

class MemoryDirectoryHandle {
	kind = "directory" as const;

	private readonly directories = new Map<string, MemoryDirectoryHandle>();

	private readonly files = new Map<string, MemoryFileHandle>();

	constructor(public readonly name: string) {}

	async getDirectoryHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<MemoryDirectoryHandle> {
		const existing = this.directories.get(name);
		if (existing) return existing;
		if (!options?.create) {
			throw new Error(`目录不存在: ${name}`);
		}
		const created = new MemoryDirectoryHandle(name);
		this.directories.set(name, created);
		return created;
	}

	async getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<MemoryFileHandle> {
		const existing = this.files.get(name);
		if (existing) return existing;
		if (!options?.create) {
			throw new Error(`文件不存在: ${name}`);
		}
		const created = new MemoryFileHandle(name);
		this.files.set(name, created);
		return created;
	}

	async *entries(): AsyncIterableIterator<
		[
			string,
			{ kind: "file" | "directory" } & (
				| MemoryFileHandle
				| MemoryDirectoryHandle
			),
		]
	> {
		for (const [name, handle] of this.directories) {
			yield [name, handle];
		}
		for (const [name, handle] of this.files) {
			yield [name, handle];
		}
	}
}

const makeTestFile = (name: string, content: string): File => {
	const bytes = encoder.encode(content);
	return {
		name,
		arrayBuffer: async () => toArrayBuffer(bytes),
	} as unknown as File;
};

const getKindDir = async (
	root: MemoryDirectoryHandle,
	projectId: string,
	kind: "audios" | "videos" | "images",
): Promise<MemoryDirectoryHandle> => {
	const projectsDir = await root.getDirectoryHandle("projects");
	const projectDir = await projectsDir.getDirectoryHandle(projectId);
	return projectDir.getDirectoryHandle(kind);
};

const listFiles = async (dir: MemoryDirectoryHandle): Promise<string[]> => {
	const names: string[] = [];
	for await (const [name, handle] of dir.entries()) {
		if (handle.kind === "file") {
			names.push(name);
		}
	}
	return names.sort();
};

const readFileText = async (file: File): Promise<string> => {
	const content = await file.arrayBuffer();
	return new TextDecoder().decode(content);
};

describe("projectOpfsStorage", () => {
	let root: MemoryDirectoryHandle;

	beforeEach(async () => {
		root = new MemoryDirectoryHandle("root");
		const getDirectory = vi.fn(
			async () => root as unknown as FileSystemDirectoryHandle,
		);
		vi.stubGlobal("navigator", {
			storage: {
				getDirectory,
			},
		});
		if (!globalThis.crypto?.subtle) {
			const { webcrypto } = await import("node:crypto");
			vi.stubGlobal("crypto", webcrypto);
		}
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("首次写入生成 projects/{projectId}/{kind}/ 文件路径", async () => {
		const result = await writeProjectFileToOpfs(
			makeTestFile("voice.mp3", "hello"),
			"project-a",
			"audios",
		);
		expect(result.uri).toBe("opfs://projects/project-a/audios/voice.mp3");
		expect(result.fileName).toBe("voice.mp3");
		expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
		const kindDir = await getKindDir(root, "project-a", "audios");
		await expect(listFiles(kindDir)).resolves.toHaveLength(1);
	});

	it("同项目同内容重复导入会复用已有文件", async () => {
		const first = await writeProjectFileToOpfs(
			makeTestFile("a.mp3", "same-content"),
			"project-a",
			"audios",
		);
		const second = await writeProjectFileToOpfs(
			makeTestFile("b.mp3", "same-content"),
			"project-a",
			"audios",
		);
		expect(second.uri).toBe(first.uri);
		expect(second.fileName).toBe(first.fileName);
		const kindDir = await getKindDir(root, "project-a", "audios");
		await expect(listFiles(kindDir)).resolves.toHaveLength(1);
	});

	it("不同项目写入相同内容不会互相复用", async () => {
		const a = await writeProjectFileToOpfs(
			makeTestFile("voice.wav", "same-content"),
			"project-a",
			"audios",
		);
		const b = await writeProjectFileToOpfs(
			makeTestFile("voice.wav", "same-content"),
			"project-b",
			"audios",
		);
		expect(a.uri).not.toBe(b.uri);
		const dirA = await getKindDir(root, "project-a", "audios");
		const dirB = await getKindDir(root, "project-b", "audios");
		await expect(listFiles(dirA)).resolves.toHaveLength(1);
		await expect(listFiles(dirB)).resolves.toHaveLength(1);
	});

	it("同名不同内容会追加 (n) 后缀", async () => {
		const first = await writeProjectFileToOpfs(
			makeTestFile("voice.wav", "content-a"),
			"project-a",
			"audios",
		);
		const second = await writeProjectFileToOpfs(
			makeTestFile("voice.wav", "content-b"),
			"project-a",
			"audios",
		);
		expect(first.fileName).toBe("voice.wav");
		expect(second.fileName).toBe("voice (1).wav");
		const kindDir = await getKindDir(root, "project-a", "audios");
		await expect(listFiles(kindDir)).resolves.toEqual([
			"voice (1).wav",
			"voice.wav",
		]);
	});

	it("同项目不同类型目录不会互相复用", async () => {
		const audio = await writeProjectFileToOpfs(
			makeTestFile("asset.bin", "same-content"),
			"project-a",
			"audios",
		);
		const video = await writeProjectFileToOpfs(
			makeTestFile("asset.bin", "same-content"),
			"project-a",
			"videos",
		);
		expect(audio.uri).not.toBe(video.uri);
		expect(audio.uri).toContain("/audios/");
		expect(video.uri).toContain("/videos/");
		const audioDir = await getKindDir(root, "project-a", "audios");
		const videoDir = await getKindDir(root, "project-a", "videos");
		await expect(listFiles(audioDir)).resolves.toHaveLength(1);
		await expect(listFiles(videoDir)).resolves.toHaveLength(1);
	});

	it("旧 opfs://synvas/... 路径会报错", async () => {
		await expect(
			resolveProjectOpfsFile("opfs://synvas/audios/a.mp3"),
		).rejects.toThrow("projects/{projectId}");
	});

	it("支持 managed 子路径写入与读取", async () => {
		const write = await writeProjectFileToOpfsAtPath(
			makeTestFile("poster.webp", "thumb-v1"),
			"project-a",
			"images",
			".thumbs/node-1.webp",
		);
		expect(write.fileName).toBe(".thumbs/node-1.webp");
		expect(write.uri).toBe(
			"opfs://projects/project-a/images/.thumbs/node-1.webp",
		);
		const resolved = await resolveProjectOpfsFile(write.uri);
		await expect(readFileText(resolved)).resolves.toBe("thumb-v1");
	});

	it("定向覆盖写入同一路径会覆盖文件内容", async () => {
		const first = await writeProjectFileToOpfsAtPath(
			makeTestFile("poster.webp", "thumb-a"),
			"project-a",
			"images",
			".thumbs/node-2.webp",
		);
		const second = await writeProjectFileToOpfsAtPath(
			makeTestFile("poster.webp", "thumb-b"),
			"project-a",
			"images",
			".thumbs/node-2.webp",
		);
		expect(second.uri).toBe(first.uri);
		expect(second.fileName).toBe(first.fileName);
		expect(second.hash).not.toBe(first.hash);
		const resolved = await resolveProjectOpfsFile(second.uri);
		await expect(readFileText(resolved)).resolves.toBe("thumb-b");
		const imagesDir = await getKindDir(root, "project-a", "images");
		const thumbsDir = await imagesDir.getDirectoryHandle(".thumbs");
		await expect(listFiles(thumbsDir)).resolves.toEqual(["node-2.webp"]);
	});
});
