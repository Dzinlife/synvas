import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";

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

export async function writeAudioToOpfs(
	file: File,
	projectId: string,
): Promise<{ uri: string; fileName: string }> {
	const { uri, fileName } = await writeProjectFileToOpfs(
		file,
		projectId,
		"audios",
	);
	return { uri, fileName };
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
