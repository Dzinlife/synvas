import { z } from "zod";
import { ensureStudioProjectOt } from "./ot";
import type { CanvasNode, StudioProject } from "./types";

const nonEmptyStringSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();
const defaultCamera = {
	x: 0,
	y: 0,
	zoom: 1,
} as const;

const canvasNodeBaseSchema = z.object({
	id: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	parentId: nonEmptyStringSchema.nullable().default(null),
	x: finiteNumberSchema,
	y: finiteNumberSchema,
	width: z.number().positive(),
	height: z.number().positive(),
	siblingOrder: finiteNumberSchema.optional(),
	zIndex: finiteNumberSchema.optional(),
	locked: z.boolean(),
	hidden: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
	thumbnail: z
		.object({
			assetId: nonEmptyStringSchema,
			sourceSignature: nonEmptyStringSchema,
			frame: z.number().int().nonnegative(),
			generatedAt: z.number(),
			version: z.literal(1),
		})
		.optional(),
});

const sceneNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("scene"),
	sceneId: nonEmptyStringSchema,
});

const videoNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("video"),
	assetId: nonEmptyStringSchema,
	duration: z.number().positive().optional(),
});

const audioNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("audio"),
	assetId: nonEmptyStringSchema,
	duration: z.number().positive().optional(),
});

const imageNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("image"),
	assetId: nonEmptyStringSchema,
});

const textNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("text"),
	text: z.string(),
	fontSize: z.number().positive(),
});

const frameNodeSchema = canvasNodeBaseSchema.extend({
	type: z.literal("frame"),
});

const canvasDocumentSchema = z.object({
	nodes: z.array(
		z.discriminatedUnion("type", [
			sceneNodeSchema,
			videoNodeSchema,
			audioNodeSchema,
			imageNodeSchema,
			textNodeSchema,
			frameNodeSchema,
		]),
	),
});

const repairCanvasNodeParentRelations = (nodes: CanvasNode[]): CanvasNode[] => {
	if (nodes.length === 0) return nodes;
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const parentById = new Map<string, string | null>();
	for (const node of nodes) {
		const rawParentId = node.parentId ?? null;
		if (!rawParentId || rawParentId === node.id) {
			parentById.set(node.id, null);
			continue;
		}
		const parentNode = nodeById.get(rawParentId);
		if (!parentNode || parentNode.type !== "frame") {
			parentById.set(node.id, null);
			continue;
		}
		parentById.set(node.id, rawParentId);
	}

	const cycleNodeIds = new Set<string>();
	for (const node of nodes) {
		let currentNodeId: string | null = node.id;
		const chain: string[] = [];
		const indexByNodeId = new Map<string, number>();
		while (currentNodeId) {
			if (cycleNodeIds.has(currentNodeId)) break;
			const existingIndex = indexByNodeId.get(currentNodeId);
			if (existingIndex !== undefined) {
				for (let index = existingIndex; index < chain.length; index += 1) {
					const cycleNodeId = chain[index];
					if (cycleNodeId) {
						cycleNodeIds.add(cycleNodeId);
					}
				}
				break;
			}
			indexByNodeId.set(currentNodeId, chain.length);
			chain.push(currentNodeId);
			currentNodeId = parentById.get(currentNodeId) ?? null;
		}
	}
	for (const cycleNodeId of cycleNodeIds) {
		parentById.set(cycleNodeId, null);
	}

	let hasChanged = false;
	const nextNodes = nodes.map((node) => {
		const nextParentId = parentById.get(node.id) ?? null;
		if (nextParentId === node.parentId) {
			return node;
		}
		hasChanged = true;
		return {
			...node,
			parentId: nextParentId,
		};
	});
	return hasChanged ? nextNodes : nodes;
};

const normalizeCanvasNodeSiblingOrder = (nodes: CanvasNode[]): CanvasNode[] => {
	if (nodes.length === 0) return nodes;
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const siblingsByParentId = new Map<string | null, CanvasNode[]>();
	for (const node of nodes) {
		const rawParentId = node.parentId ?? null;
		const parentId =
			rawParentId && nodeById.has(rawParentId) ? rawParentId : null;
		const siblings = siblingsByParentId.get(parentId) ?? [];
		siblings.push(node);
		siblingsByParentId.set(parentId, siblings);
	}
	const siblingOrderByNodeId = new Map<string, number>();
	for (const siblings of siblingsByParentId.values()) {
		const orderedSiblings = [...siblings]
			.map((node) => {
				const legacyNode = node as CanvasNode & { zIndex?: number };
				const siblingOrder =
					typeof node.siblingOrder === "number"
						? node.siblingOrder
						: (legacyNode.zIndex ?? 0);
				return {
					node,
					siblingOrder,
				};
			})
			.sort((left, right) => {
				if (left.siblingOrder !== right.siblingOrder) {
					return left.siblingOrder - right.siblingOrder;
				}
				return left.node.id.localeCompare(right.node.id);
			});
		orderedSiblings.forEach((item, index) => {
			siblingOrderByNodeId.set(item.node.id, index);
		});
	}
	let hasChanged = false;
	const nextNodes = nodes.map((node) => {
		const nextSiblingOrder = siblingOrderByNodeId.get(node.id) ?? 0;
		const legacyNode = node as CanvasNode & { zIndex?: number };
		const hasLegacyZIndex = Object.hasOwn(legacyNode, "zIndex");
		if (!hasLegacyZIndex && node.siblingOrder === nextSiblingOrder) {
			return node;
		}
		hasChanged = true;
		const { zIndex: _legacyZIndex, ...restNode } = legacyNode;
		void _legacyZIndex;
		return {
			...restNode,
			siblingOrder: nextSiblingOrder,
		};
	});
	return hasChanged ? nextNodes : nodes;
};

const timelineSchema = z.object({
	fps: z.number().int().positive(),
	canvas: z.object({
		width: z.number().positive(),
		height: z.number().positive(),
	}),
	settings: z.unknown(),
	tracks: z.array(z.unknown()),
	elements: z.array(z.unknown()),
});

const assetKindSchema = z.enum([
	"video",
	"audio",
	"image",
	"lottie",
	"unknown",
]);
const linkedRemoteUriSchema = nonEmptyStringSchema.refine(
	(value) =>
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("blob:"),
	{
		message: "must be http(s):// or blob: uri",
	},
);

const timelineAssetLocatorSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("linked-file"),
		filePath: nonEmptyStringSchema,
	}),
	z.object({
		type: z.literal("linked-remote"),
		uri: linkedRemoteUriSchema,
	}),
	z.object({
		type: z.literal("managed"),
		fileName: nonEmptyStringSchema,
	}),
]);

const timelineAssetMetaSchema = z
	.object({
		hash: nonEmptyStringSchema.optional(),
		fileName: nonEmptyStringSchema.optional(),
		sourceSize: z
			.object({
				width: z.number().positive(),
				height: z.number().positive(),
			})
			.optional(),
	})
	.catchall(z.unknown());

const timelineAssetSchema = z.object({
	id: nonEmptyStringSchema,
	kind: assetKindSchema,
	name: nonEmptyStringSchema,
	locator: timelineAssetLocatorSchema,
	meta: timelineAssetMetaSchema.optional(),
});

const sceneDocumentSchema = z.object({
	id: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	timeline: timelineSchema,
	posterFrame: z.number().int().nonnegative(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

const otCommandSchema = z.object({
	id: nonEmptyStringSchema,
	args: z.record(z.unknown()),
});

const otOpEnvelopeSchema = z.object({
	opId: nonEmptyStringSchema,
	txnId: nonEmptyStringSchema,
	streamId: nonEmptyStringSchema,
	actorId: nonEmptyStringSchema,
	seq: z.number().int().positive(),
	lamport: z.number().int().nonnegative(),
	createdAt: z.number(),
	command: otCommandSchema,
	causedBy: z.array(nonEmptyStringSchema),
	inverseOf: nonEmptyStringSchema.optional(),
});

const otTransactionSchema = z.object({
	txnId: nonEmptyStringSchema,
	opIds: z.array(nonEmptyStringSchema),
	createdAt: z.number(),
	ops: z.array(otOpEnvelopeSchema),
});

const otStreamCursorSchema = z.object({
	opIds: z.array(nonEmptyStringSchema),
	undoStack: z.array(nonEmptyStringSchema),
	redoStack: z.array(nonEmptyStringSchema),
});

const studioOtSchema = z.object({
	version: z.literal(1),
	actorId: nonEmptyStringSchema,
	lamport: z.number().int().nonnegative(),
	streams: z.record(nonEmptyStringSchema, otStreamCursorSchema),
	ops: z.array(otOpEnvelopeSchema),
	transactions: z.array(otTransactionSchema),
	tombstones: z.object({
		scenes: z.record(
			nonEmptyStringSchema,
			z.object({
				scene: sceneDocumentSchema,
				node: sceneNodeSchema,
				deletedAt: z.number(),
			}),
		),
	}),
});

const studioProjectSchema = z.object({
	id: nonEmptyStringSchema,
	revision: z.number().int().nonnegative(),
	canvas: canvasDocumentSchema,
	scenes: z.record(nonEmptyStringSchema, sceneDocumentSchema),
	assets: z.array(timelineAssetSchema),
	ot: studioOtSchema.optional(),
	ui: z.object({
		activeSceneId: nonEmptyStringSchema.nullable(),
		focusedNodeId: nonEmptyStringSchema.nullable(),
		activeNodeId: nonEmptyStringSchema.nullable(),
		canvasSnapEnabled: z.boolean().default(true),
		camera: z
			.object({
				x: finiteNumberSchema,
				y: finiteNumberSchema,
				zoom: z.number().positive(),
			})
			.default(defaultCamera),
	}),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const parseStudioProject = (value: unknown): StudioProject => {
	const parsed = studioProjectSchema.parse(value) as StudioProject;
	const repairedCanvasNodes = repairCanvasNodeParentRelations(
		parsed.canvas.nodes,
	);
	const normalizedCanvasNodes = normalizeCanvasNodeSiblingOrder(
		repairedCanvasNodes,
	);
	const normalizedProject: StudioProject =
		normalizedCanvasNodes === parsed.canvas.nodes
			? parsed
			: {
					...parsed,
					canvas: {
						...parsed.canvas,
						nodes: normalizedCanvasNodes,
					},
				};
	if (normalizedProject.ot) return normalizedProject;
	return {
		...normalizedProject,
		ot: ensureStudioProjectOt(normalizedProject),
	};
};
