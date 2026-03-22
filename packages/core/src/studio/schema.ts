import { z } from "zod";
import { ensureStudioProjectOt } from "./ot";
import type { StudioProject } from "./types";

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
	x: finiteNumberSchema,
	y: finiteNumberSchema,
	width: z.number().positive(),
	height: z.number().positive(),
	zIndex: z.number().int(),
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

const canvasDocumentSchema = z.object({
	nodes: z.array(
		z.discriminatedUnion("type", [
			sceneNodeSchema,
			videoNodeSchema,
			audioNodeSchema,
			imageNodeSchema,
			textNodeSchema,
		]),
	),
});

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

const assetKindSchema = z.enum(["video", "audio", "image", "lottie", "unknown"]);
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
		camera: z.object({
			x: finiteNumberSchema,
			y: finiteNumberSchema,
			zoom: z.number().positive(),
		}).default(defaultCamera),
	}),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const parseStudioProject = (value: unknown): StudioProject => {
	const parsed = studioProjectSchema.parse(value) as StudioProject;
	if (parsed.ot) return parsed;
	return {
		...parsed,
		ot: ensureStudioProjectOt(parsed),
	};
};
