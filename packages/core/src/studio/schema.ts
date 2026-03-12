import { z } from "zod";
import { ensureStudioProjectOt } from "./ot";
import type { StudioProject } from "./types";

const nonEmptyStringSchema = z.string().min(1);
const finiteNumberSchema = z.number().finite();

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
	assets: z.array(z.unknown()),
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
		}),
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
