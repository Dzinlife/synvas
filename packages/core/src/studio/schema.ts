import { z } from "zod";
import { SOURCE_KIND_VALUES } from "../dsl/types";
import type { StudioProject } from "./types";

const nonEmptyStringSchema = z.string().min(1);

const scopeSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("main") }),
	z.object({
		type: z.literal("composition"),
		compositionId: nonEmptyStringSchema,
	}),
]);

const assetSchema = z.object({
	id: nonEmptyStringSchema,
	kind: z.enum(SOURCE_KIND_VALUES),
	uri: nonEmptyStringSchema,
	name: z.string().optional(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

const compositionSchema = z.object({
	id: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	elements: z.array(z.unknown()),
	durationFrames: z.number().int().nonnegative(),
	createdAt: z.number(),
	updatedAt: z.number(),
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

const studioProjectSchema = z.object({
	id: nonEmptyStringSchema,
	revision: z.number().int().nonnegative(),
	timeline: timelineSchema,
	compositions: z.record(nonEmptyStringSchema, compositionSchema),
	assets: z.record(nonEmptyStringSchema, assetSchema),
	ui: z.object({
		activeMainView: z.union([z.literal("preview"), z.literal("canvas")]),
		activeScope: scopeSchema,
	}),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const parseStudioProject = (value: unknown): StudioProject => {
	return studioProjectSchema.parse(value) as StudioProject;
};
