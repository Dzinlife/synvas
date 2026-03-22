import type { TimelineAsset } from "core/element/types";
import {
	writeProjectFileToOpfs,
	type ProjectOpfsKind,
} from "@/lib/projectOpfsStorage";
import {
	detectAssetRuntimeEnvironment,
	resolveAssetLocatorFromUri,
	resolveFileNameFromLocator,
	resolveExternalFilePath,
	resolveProjectOpfsKind,
	type AssetRuntimeEnvironment,
} from "./assetLocator";

export type AssetStorageMode = "linked" | "managed";

export interface IngestExternalFileAssetOptions {
	file: File;
	kind: Extract<TimelineAsset["kind"], "video" | "audio" | "image">;
	projectId: string;
	environment?: AssetRuntimeEnvironment;
	mode?: AssetStorageMode;
}

export interface IngestExternalFileAssetResult {
	name: string;
	locator: TimelineAsset["locator"];
	meta: TimelineAsset["meta"];
}

export interface IngestUriAssetOptions {
	uri: string;
	kind: TimelineAsset["kind"];
	name?: string;
}

export interface IngestUriAssetResult {
	name: string;
	locator: TimelineAsset["locator"];
	meta?: TimelineAsset["meta"];
}

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

const ensureFileName = (name: string): string => {
	const trimmed = name.trim();
	return trimmed.length > 0 ? trimmed : "asset";
};

const ensureAssetName = (
	name: string | undefined,
	fallback: string | null,
	kind: TimelineAsset["kind"],
): string => {
	const resolved = name?.trim();
	if (resolved) return resolved;
	const fallbackName = fallback?.trim();
	if (fallbackName) return fallbackName;
	return `${kind}-asset`;
};

const resolveOpfsKind = (
	kind: IngestExternalFileAssetOptions["kind"],
): ProjectOpfsKind => {
	const opfsKind = resolveProjectOpfsKind(kind);
	if (!opfsKind) {
		throw new Error(`当前素材类型不支持托管存储: ${kind}`);
	}
	return opfsKind;
};

export const ingestExternalFileAsset = async (
	options: IngestExternalFileAssetOptions,
): Promise<IngestExternalFileAssetResult> => {
	const environment =
		options.environment ?? detectAssetRuntimeEnvironment();
	const mode: AssetStorageMode =
		options.mode ?? (environment === "electron" ? "linked" : "managed");
	const fileName = ensureFileName(options.file.name);

	if (mode === "linked") {
		const filePath = resolveExternalFilePath(options.file);
		if (!filePath) {
			throw new Error("无法解析外部文件路径");
		}
		const hash = await hashFile(options.file);
		return {
			name: fileName,
			locator: {
				type: "linked-file",
				filePath,
			},
			meta: {
				hash,
				fileName,
			},
		};
	}

	const opfsKind = resolveOpfsKind(options.kind);
	const { fileName: managedFileName, hash } = await writeProjectFileToOpfs(
		options.file,
		options.projectId,
		opfsKind,
	);
	return {
		name: fileName,
		locator: {
			type: "managed",
			fileName: managedFileName,
		},
		meta: {
			hash,
			fileName: managedFileName,
		},
	};
};

export const ingestUriAsset = (
	options: IngestUriAssetOptions,
): IngestUriAssetResult => {
	const locator = resolveAssetLocatorFromUri(options.uri, options.kind);
	if (!locator) {
		throw new Error("无法解析素材定位信息");
	}
	const fileName = resolveFileNameFromLocator(locator);
	const name = ensureAssetName(options.name, fileName, options.kind);
	const meta = fileName
		? ({
				fileName,
			} satisfies TimelineAsset["meta"])
		: undefined;
	return {
		name,
		locator,
		meta,
	};
};
