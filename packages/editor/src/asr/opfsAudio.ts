const OPFS_ROOT_DIR = "ai-nle";
const OPFS_AUDIO_DIR = "audios";
const OPFS_PREFIX = "opfs://";

const AUDIO_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"m4a",
	"aac",
	"flac",
	"ogg",
	"opus",
	"aif",
	"aiff",
	"caf",
	"mka",
	"wma",
	"weba",
	"mid",
	"midi",
	"mpga",
]);

const DEFAULT_AUDIO_DURATION_SECONDS = 1;

export type ExternalAudioMetadata = {
	duration: number;
};

export function isAudioFile(file: File): boolean {
	if (file.type.startsWith("audio/")) return true;
	const parts = file.name.toLowerCase().split(".");
	if (parts.length < 2) return false;
	const ext = parts[parts.length - 1];
	return AUDIO_EXTENSIONS.has(ext);
}

const normalizeFileName = (name: string): string => {
	const clean = name.trim();
	if (!clean) return `audio-${Date.now()}.wav`;
	return clean.replace(/[\\/:*?"<>|]/g, "-");
};

const buildOpfsPath = (fileName: string): string => {
	return `${OPFS_PREFIX}${OPFS_ROOT_DIR}/${OPFS_AUDIO_DIR}/${fileName}`;
};

export async function writeAudioToOpfs(
	file: File,
): Promise<{ uri: string; fileName: string }> {
	if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
		throw new Error("OPFS 不可用");
	}
	const root = await navigator.storage.getDirectory();
	const appDir = await root.getDirectoryHandle(OPFS_ROOT_DIR, {
		create: true,
	});
	const audioDir = await appDir.getDirectoryHandle(OPFS_AUDIO_DIR, {
		create: true,
	});
	const safeName = `${Date.now()}-${normalizeFileName(file.name)}`;
	const fileHandle = await audioDir.getFileHandle(safeName, { create: true });
	const writable = await fileHandle.createWritable();
	try {
		await writable.write(file);
	} finally {
		await writable.close();
	}
	return { uri: buildOpfsPath(safeName), fileName: safeName };
}

export async function readAudioMetadata(
	file: File,
): Promise<ExternalAudioMetadata> {
	const url = URL.createObjectURL(file);
	const audio = document.createElement("audio");
	audio.preload = "metadata";
	audio.src = url;

	try {
		const metadata = await new Promise<ExternalAudioMetadata>(
			(resolve, reject) => {
				const cleanup = () => {
					audio.removeAttribute("src");
					audio.load();
				};

				audio.onloadedmetadata = () => {
					resolve({
						duration:
							Number.isFinite(audio.duration) && audio.duration > 0
								? audio.duration
								: DEFAULT_AUDIO_DURATION_SECONDS,
					});
					cleanup();
				};
				audio.onerror = () => {
					reject(new Error("读取音频元数据失败"));
					cleanup();
				};
			},
		);
		return metadata;
	} finally {
		URL.revokeObjectURL(url);
	}
}
