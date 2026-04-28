import {
	type AgentRunRequest,
	type OpenAiImageEditSource,
	OpenAiImageAgentClient,
} from "@synvas/agent";
import type { TimelineAsset } from "core";
import { resolveProjectOpfsFile } from "@/lib/projectOpfsStorage";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { useAiProviderConfigStore } from "./aiProviderConfig";

const resolveMimeTypeFromName = (name: string): string => {
	const normalized = name.toLowerCase();
	if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (normalized.endsWith(".webp")) return "image/webp";
	return "image/png";
};

const resolveAssetFileName = (asset: TimelineAsset): string => {
	const metaFileName =
		typeof asset.meta?.fileName === "string" ? asset.meta.fileName : "";
	if (metaFileName.trim()) return metaFileName.trim();
	if (asset.locator.type === "managed") return asset.locator.fileName;
	if (asset.locator.type === "linked-file") {
		const chunks = asset.locator.filePath.replace(/\\/g, "/").split("/");
		const last = chunks.filter(Boolean).at(-1);
		if (last) return last;
	}
	if (asset.name.trim()) return asset.name.trim();
	return "source-image.png";
};

const getElectronFileBridge = (): {
	stat: (filePath: string) => Promise<{ size: number }>;
	read: (
		filePath: string,
		start: number,
		end: number,
	) => Promise<Uint8Array | ArrayBuffer>;
} | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			synvasElectron?: {
				file?: {
					stat: (filePath: string) => Promise<{ size: number }>;
					read: (
						filePath: string,
						start: number,
						end: number,
					) => Promise<Uint8Array | ArrayBuffer>;
				};
			};
		}
	).synvasElectron?.file;
	if (!bridge?.stat || !bridge.read) return null;
	return bridge;
};

const toArrayBuffer = (raw: Uint8Array | ArrayBuffer): ArrayBuffer => {
	if (raw instanceof ArrayBuffer) return raw;
	return raw.buffer.slice(
		raw.byteOffset,
		raw.byteOffset + raw.byteLength,
	) as ArrayBuffer;
};

const resolveLinkedFile = async (
	asset: TimelineAsset,
): Promise<File | null> => {
	if (asset.locator.type !== "linked-file") return null;
	const bridge = getElectronFileBridge();
	if (!bridge) {
		throw new Error("当前环境无法读取本地图片文件。");
	}
	const { size } = await bridge.stat(asset.locator.filePath);
	const raw = await bridge.read(asset.locator.filePath, 0, size);
	const name = resolveAssetFileName(asset);
	return new File([toArrayBuffer(raw)], name, {
		type: resolveMimeTypeFromName(name),
	});
};

const resolveRemoteFile = async (
	asset: TimelineAsset,
): Promise<File | null> => {
	if (asset.locator.type !== "linked-remote") return null;
	const response = await fetch(asset.locator.uri);
	if (!response.ok) {
		throw new Error(`读取源图片失败: ${response.status}`);
	}
	const blob = await response.blob();
	const name = resolveAssetFileName(asset);
	return new File([blob], name, {
		type: blob.type || resolveMimeTypeFromName(name),
	});
};

const resolveManagedFile = async (
	asset: TimelineAsset,
	projectId: string,
): Promise<File | null> => {
	if (asset.locator.type !== "managed") return null;
	const uri = resolveAssetPlayableUri(asset, { projectId });
	if (!uri) return null;
	const file = await resolveProjectOpfsFile(uri);
	const name = resolveAssetFileName(asset);
	return new File([file], name, {
		type: file.type || resolveMimeTypeFromName(name),
	});
};

const resolveOpenAiEditSource = async (
	request: AgentRunRequest,
): Promise<OpenAiImageEditSource | null> => {
	const sourceAssetId = request.context?.sourceAssetId;
	if (typeof sourceAssetId !== "string") return null;
	const project = useProjectStore.getState().currentProject;
	if (!project) return null;
	const asset =
		project.assets.find(
			(item) => item.id === sourceAssetId && item.kind === "image",
		) ?? null;
	if (!asset) return null;
	const file =
		(await resolveManagedFile(asset, project.id)) ??
		(await resolveLinkedFile(asset)) ??
		(await resolveRemoteFile(asset));
	if (!file) return null;
	return {
		data: file,
		name: file.name,
	};
};

export const createEditorAgentClient = () =>
	new OpenAiImageAgentClient({
		config: () => useAiProviderConfigStore.getState().config.openai,
		resolveEditSource: resolveOpenAiEditSource,
	});
