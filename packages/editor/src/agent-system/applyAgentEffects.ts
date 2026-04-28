import type {
	AgentArtifact,
	AgentEffectApplication,
	AgentRun,
} from "@synvas/agent";
import { ingestExternalFileAsset } from "@/projects/assetIngest";
import { useProjectStore } from "@/projects/projectStore";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import type { CanvasNode, ImageCanvasNode } from "@/studio/project/types";

const base64ToUint8Array = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
};

const normalizeFileName = (name: string): string => {
	const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, "-");
	return trimmed || "agent-image.png";
};

const createFileFromArtifact = async (
	artifact: AgentArtifact,
): Promise<File> => {
	if (artifact.source.type === "inline-bytes") {
		const bytes = base64ToUint8Array(artifact.source.base64);
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		return new File([buffer], normalizeFileName(artifact.name), {
			type: artifact.source.mimeType,
		});
	}
	const response = await fetch(artifact.source.url);
	if (!response.ok) {
		throw new Error(`Agent artifact fetch failed: ${response.status}`);
	}
	const blob = await response.blob();
	return new File([blob], normalizeFileName(artifact.name), {
		type: artifact.mimeType,
	});
};

const resolveNodeById = (nodeId: string): CanvasNode | null => {
	const project = useProjectStore.getState().currentProject;
	return project?.canvas.nodes.find((node) => node.id === nodeId) ?? null;
};

const isImageNode = (node: CanvasNode | null): node is ImageCanvasNode => {
	return node?.type === "image";
};

export const applyAgentEffects = async (
	run: AgentRun,
): Promise<AgentEffectApplication[]> => {
	const projectStore = useProjectStore.getState();
	const historyStore = useStudioHistoryStore.getState();
	const project = projectStore.currentProject;
	if (!project) {
		return run.effects.map((effect) => ({
			effectId: effect.id,
			status: "failed",
			reason: "error",
			message: "Project is not loaded.",
		}));
	}

	const assetIdByArtifactId = new Map<string, string>();
	for (const artifact of run.artifacts) {
		if (artifact.kind !== "image") continue;
		const file = await createFileFromArtifact(artifact);
		const ingested = await ingestExternalFileAsset({
			file,
			kind: "image",
			projectId: project.id,
			mode: "managed",
		});
		const assetId = projectStore.ensureProjectAsset({
			kind: "image",
			name: ingested.name,
			locator: ingested.locator,
			meta: {
				...(ingested.meta ?? {}),
				sourceSize: {
					width: artifact.width,
					height: artifact.height,
				},
				agentRunId: run.id,
			},
		});
		assetIdByArtifactId.set(artifact.id, assetId);
	}

	const applications: AgentEffectApplication[] = [];
	for (const effect of run.effects) {
		if (effect.type !== "image-node.bind-artifact") {
			applications.push({
				effectId: effect.id,
				status: "failed",
				reason: "unsupported_effect",
			});
			continue;
		}
		const assetId = assetIdByArtifactId.get(effect.artifactId);
		if (!assetId) {
			applications.push({
				effectId: effect.id,
				status: "failed",
				reason: "artifact_missing",
			});
			continue;
		}
		const beforeNode = resolveNodeById(effect.nodeId);
		if (!isImageNode(beforeNode)) {
			applications.push({
				effectId: effect.id,
				status: "skipped",
				reason: "target_missing",
			});
			continue;
		}
		projectStore.updateCanvasNode(effect.nodeId, {
			assetId,
			ai: {
				sourceRunId: run.id,
				sourceNodeId: effect.metadata?.sourceNodeId,
			},
		} as never);
		const afterNode = resolveNodeById(effect.nodeId);
		if (!afterNode) {
			applications.push({
				effectId: effect.id,
				status: "skipped",
				reason: "target_missing",
			});
			continue;
		}
		historyStore.push({
			kind: "canvas.node-update",
			nodeId: effect.nodeId,
			before: beforeNode,
			after: afterNode,
			focusNodeId: project.ui.focusedNodeId,
		});
		applications.push({
			effectId: effect.id,
			status: "applied",
		});
	}
	return applications;
};
