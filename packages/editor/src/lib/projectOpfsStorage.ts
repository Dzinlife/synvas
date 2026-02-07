const OPFS_PREFIX = "opfs://";
const PROJECTS_ROOT = "projects";

const VALID_KINDS = new Set(["audios", "videos", "images"]);

export type ProjectOpfsKind = "audios" | "videos" | "images";

type ParsedProjectOpfsUri = {
	projectId: string;
	kind: ProjectOpfsKind;
	fileName: string;
};

const assertOpfsAvailable = (): void => {
	if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
		throw new Error("OPFS 不可用");
	}
};

const assertProjectId = (projectId: string): void => {
	if (!projectId.trim()) {
		throw new Error("项目 ID 不能为空");
	}
};

const sanitizeSegment = (value: string, fallback: string): string => {
	const sanitized = value
		.trim()
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ");
	return sanitized || fallback;
};

const splitNameAndExt = (
	fileName: string,
): { baseName: string; ext: string } => {
	const normalized = fileName.trim();
	if (!normalized) {
		return { baseName: "file", ext: "" };
	}
	const dotIndex = normalized.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
		return { baseName: normalized, ext: "" };
	}
	return {
		baseName: normalized.slice(0, dotIndex),
		ext: normalized.slice(dotIndex).toLowerCase(),
	};
};

const toHex = (bytes: Uint8Array): string => {
	return Array.from(bytes)
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
};

const hashFile = async (file: File): Promise<string> => {
	const content = await file.arrayBuffer();
	const digest = await crypto.subtle.digest("SHA-256", content);
	return toHex(new Uint8Array(digest));
};

const buildProjectOpfsUri = (
	projectId: string,
	kind: ProjectOpfsKind,
	fileName: string,
): string => {
	return `${OPFS_PREFIX}${PROJECTS_ROOT}/${projectId}/${kind}/${fileName}`;
};

const resolveProjectKindDir = async (
	projectId: string,
	kind: ProjectOpfsKind,
): Promise<FileSystemDirectoryHandle> => {
	const root = await navigator.storage.getDirectory();
	const projectsDir = await root.getDirectoryHandle(PROJECTS_ROOT, {
		create: true,
	});
	const projectDir = await projectsDir.getDirectoryHandle(projectId, {
		create: true,
	});
	return projectDir.getDirectoryHandle(kind, {
		create: true,
	});
};

const hasHashSuffix = (fileName: string, hash: string): boolean => {
	if (!fileName.includes(`-${hash}`)) return false;
	const withoutExt = fileName.replace(/\.[^./\\]+$/, "");
	return withoutExt.endsWith(`-${hash}`);
};

const findExistingFileByHash = async (
	kindDir: FileSystemDirectoryHandle,
	hash: string,
): Promise<string | null> => {
	const iterator = kindDir as unknown as {
		entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
	};
	for await (const [entryName, handle] of iterator.entries()) {
		if (handle.kind !== "file") continue;
		if (hasHashSuffix(entryName, hash)) {
			return entryName;
		}
	}
	return null;
};

const writeFile = async (
	kindDir: FileSystemDirectoryHandle,
	fileName: string,
	file: File,
): Promise<void> => {
	const fileHandle = await kindDir.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(file);
	} finally {
		await writable.close();
	}
};

export async function writeProjectFileToOpfs(
	file: File,
	projectId: string,
	kind: ProjectOpfsKind,
): Promise<{ uri: string; fileName: string; hash: string }> {
	assertOpfsAvailable();
	assertProjectId(projectId);
	if (!VALID_KINDS.has(kind)) {
		throw new Error(`不支持的 OPFS 类型: ${kind}`);
	}
	const normalizedProjectId = sanitizeSegment(projectId, "project");
	const kindDir = await resolveProjectKindDir(normalizedProjectId, kind);
	const hash = await hashFile(file);
	const existingFileName = await findExistingFileByHash(kindDir, hash);
	if (existingFileName) {
		return {
			uri: buildProjectOpfsUri(normalizedProjectId, kind, existingFileName),
			fileName: existingFileName,
			hash,
		};
	}
	const { baseName, ext } = splitNameAndExt(file.name);
	const safeBaseName = sanitizeSegment(baseName, "file");
	const fileName = `${safeBaseName}-${hash}${ext}`;
	await writeFile(kindDir, fileName, file);
	return {
		uri: buildProjectOpfsUri(normalizedProjectId, kind, fileName),
		fileName,
		hash,
	};
}

export const parseProjectOpfsUri = (uri: string): ParsedProjectOpfsUri => {
	if (!uri.startsWith(OPFS_PREFIX)) {
		throw new Error("无效的 OPFS URI");
	}
	const rawPath = uri.slice(OPFS_PREFIX.length);
	const parts = rawPath.split("/").filter(Boolean);
	if (parts.length !== 4) {
		throw new Error(
			"OPFS 路径格式不正确，必须为 projects/{projectId}/{kind}/{fileName}",
		);
	}
	const [rootName, projectId, kindName, fileName] = parts;
	if (rootName !== PROJECTS_ROOT) {
		throw new Error("仅支持 projects/{projectId}/** 格式的 OPFS 路径");
	}
	if (!projectId) {
		throw new Error("OPFS 路径缺少 projectId");
	}
	if (!VALID_KINDS.has(kindName)) {
		throw new Error("OPFS 路径中的资源类型不合法");
	}
	if (!fileName) {
		throw new Error("OPFS 路径缺少文件名");
	}
	return {
		projectId,
		kind: kindName as ProjectOpfsKind,
		fileName,
	};
};

export async function resolveProjectOpfsFile(uri: string): Promise<File> {
	assertOpfsAvailable();
	const parsed = parseProjectOpfsUri(uri);
	const root = await navigator.storage.getDirectory();
	const projectsDir = await root.getDirectoryHandle(PROJECTS_ROOT);
	const projectDir = await projectsDir.getDirectoryHandle(parsed.projectId);
	const kindDir = await projectDir.getDirectoryHandle(parsed.kind);
	const fileHandle = await kindDir.getFileHandle(parsed.fileName);
	return fileHandle.getFile();
}
