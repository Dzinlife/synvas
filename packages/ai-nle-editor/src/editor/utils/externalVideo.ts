const OPFS_ROOT_DIR = "ai-nle";
const OPFS_VIDEO_DIR = "videos";
const OPFS_PREFIX = "opfs://";

const DEFAULT_VIDEO_WIDTH = 1920;
const DEFAULT_VIDEO_HEIGHT = 1080;
const DEFAULT_VIDEO_DURATION_SECONDS = 5;

const VIDEO_EXTENSIONS = new Set([
	"mp4",
	"mov",
	"webm",
	"mkv",
	"m4v",
	"avi",
]);

export type ExternalVideoMetadata = {
	duration: number;
	width: number;
	height: number;
};

export function isVideoFile(file: File): boolean {
	if (file.type.startsWith("video/")) return true;
	const parts = file.name.toLowerCase().split(".");
	if (parts.length < 2) return false;
	const ext = parts[parts.length - 1];
	return VIDEO_EXTENSIONS.has(ext);
}

const normalizeFileName = (name: string): string => {
	const clean = name.trim();
	if (!clean) return `video-${Date.now()}.mp4`;
	return clean.replace(/[\\/:*?"<>|]/g, "-");
};

const buildOpfsPath = (fileName: string): string => {
	return `${OPFS_PREFIX}${OPFS_ROOT_DIR}/${OPFS_VIDEO_DIR}/${fileName}`;
};

export async function writeVideoToOpfs(
	file: File,
): Promise<{ uri: string; fileName: string }> {
	if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
		throw new Error("OPFS 不可用");
	}
	const root = await navigator.storage.getDirectory();
	const appDir = await root.getDirectoryHandle(OPFS_ROOT_DIR, {
		create: true,
	});
	const videoDir = await appDir.getDirectoryHandle(OPFS_VIDEO_DIR, {
		create: true,
	});
	const safeName = `${Date.now()}-${normalizeFileName(file.name)}`;
	const fileHandle = await videoDir.getFileHandle(safeName, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(file);
	} finally {
		await writable.close();
	}
	return { uri: buildOpfsPath(safeName), fileName: safeName };
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
		const metadata = await new Promise<ExternalVideoMetadata>((resolve, reject) => {
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
		});
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
