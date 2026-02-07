import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";

const FILE_PREFIX = "file://";

const DEFAULT_VIDEO_WIDTH = 1920;
const DEFAULT_VIDEO_HEIGHT = 1080;
const DEFAULT_VIDEO_DURATION_SECONDS = 5;

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "m4v", "avi"]);

export type ExternalVideoMetadata = {
	duration: number;
	width: number;
	height: number;
};

type FileWithPath = File & { path?: string };

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
};

export function isVideoFile(file: File): boolean {
	if (file.type.startsWith("video/")) return true;
	const parts = file.name.toLowerCase().split(".");
	if (parts.length < 2) return false;
	const ext = parts[parts.length - 1];
	return VIDEO_EXTENSIONS.has(ext);
}

const getFilePath = (file: File): string | null => {
	const rawPath = (file as FileWithPath).path;
	if (typeof rawPath !== "string") return null;
	const trimmed = rawPath.trim();
	return trimmed ? trimmed : null;
};

const getElectronFilePath = (file: File): string | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				webUtils?: {
					getPathForFile?: (file: File) => string | null | undefined;
				};
			};
		}
	).aiNleElectron;
	const resolved = bridge?.webUtils?.getPathForFile?.(file);
	if (typeof resolved !== "string") return null;
	const trimmed = resolved.trim();
	return trimmed ? trimmed : null;
};

const buildFileUrlFromPath = (rawPath: string): string => {
	if (rawPath.startsWith(FILE_PREFIX)) return rawPath;
	// 为了兼容 Windows/空格/中文路径，需要统一分隔符并做 URL 编码。
	const normalized = rawPath.replace(/\\/g, "/");
	let pathPart = normalized;
	let isUnc = false;

	if (pathPart.startsWith("//")) {
		isUnc = true;
		pathPart = pathPart.slice(2);
	} else if (/^[a-zA-Z]:\//.test(pathPart)) {
		pathPart = `/${pathPart}`;
	} else if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}

	const encoded = pathPart
		.split("/")
		.map((segment) => {
			if (!segment) return "";
			if (!isUnc && /^[a-zA-Z]:$/.test(segment)) return segment;
			return encodeURIComponent(segment);
		})
		.join("/");

	return `${FILE_PREFIX}${encoded}`;
};

export async function resolveExternalVideoUri(
	file: File,
	projectId: string,
): Promise<string> {
	if (isElectronEnv()) {
		const filePath = getFilePath(file) ?? getElectronFilePath(file);
		if (!filePath) {
			throw new Error("无法读取本地视频文件路径");
		}
		return buildFileUrlFromPath(filePath);
	}
	const { uri } = await writeVideoToOpfs(file, projectId);
	return uri;
}

export async function writeVideoToOpfs(
	file: File,
	projectId: string,
): Promise<{ uri: string; fileName: string }> {
	const { uri, fileName } = await writeProjectFileToOpfs(
		file,
		projectId,
		"videos",
	);
	return { uri, fileName };
}

export async function readVideoMetadata(
	file: File,
): Promise<ExternalVideoMetadata> {
	const url = URL.createObjectURL(file);
	const video = document.createElement("video");
	video.preload = "metadata";
	video.muted = true;
	video.src = url;

	try {
		const metadata = await new Promise<ExternalVideoMetadata>(
			(resolve, reject) => {
				const cleanup = () => {
					video.removeAttribute("src");
					video.load();
				};

				video.onloadedmetadata = () => {
					resolve({
						duration:
							Number.isFinite(video.duration) && video.duration > 0
								? video.duration
								: DEFAULT_VIDEO_DURATION_SECONDS,
						width: video.videoWidth || DEFAULT_VIDEO_WIDTH,
						height: video.videoHeight || DEFAULT_VIDEO_HEIGHT,
					});
					cleanup();
				};
				video.onerror = () => {
					reject(new Error("读取视频元数据失败"));
					cleanup();
				};
			},
		);
		return metadata;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function getFallbackVideoMetadata(): ExternalVideoMetadata {
	return {
		duration: DEFAULT_VIDEO_DURATION_SECONDS,
		width: DEFAULT_VIDEO_WIDTH,
		height: DEFAULT_VIDEO_HEIGHT,
	};
}
