import { z } from "zod";
import type { StudioProject } from "./types";

const nonEmptyStringSchema = z.string().min(1);

const sceneNodeSchema = z.object({
	id: nonEmptyStringSchema,
	type: z.literal("scene"),
	sceneId: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().positive(),
	height: z.number().positive(),
	zIndex: z.number().int(),
	locked: z.boolean(),
	hidden: z.boolean(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

const canvasDocumentSchema = z.object({
	nodes: z.array(sceneNodeSchema),
});

const timelineSchema = z.object({
	fps: z.number().int().positive(),
	canvas: z.object({
		width: z.number().positive(),
		height: z.number().positive(),
	}),
	settings: z.unknown(),
	tracks: z.array(z.unknown()),
	assets: z.array(z.unknown()),
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
	ui: z.object({
		activeSceneId: nonEmptyStringSchema.nullable(),
		focusedSceneId: nonEmptyStringSchema.nullable(),
		camera: z.object({
			x: z.number().finite(),
			y: z.number().finite(),
			zoom: z.number().positive(),
		}),
	}),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const parseStudioProject = (value: unknown): StudioProject => {
	return studioProjectSchema.parse(value) as StudioProject;
};
