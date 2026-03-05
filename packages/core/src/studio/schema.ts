import { z } from "zod";
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

const studioProjectSchema = z.object({
	id: nonEmptyStringSchema,
	revision: z.number().int().nonnegative(),
	canvas: canvasDocumentSchema,
	scenes: z.record(nonEmptyStringSchema, sceneDocumentSchema),
	assets: z.array(z.unknown()),
	ui: z.object({
		activeSceneId: nonEmptyStringSchema.nullable(),
		focusedNodeId: nonEmptyStringSchema.nullable(),
		activeNodeId: nonEmptyStringSchema.nullable(),
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
	return studioProjectSchema.parse(value) as StudioProject;
};
