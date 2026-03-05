import { z } from "zod";
import type {
	CompositionProps,
	RenderMeta,
	TimelineElement,
	TimelineMeta,
	TrackRole,
	TransformMeta,
	TransitionMeta,
} from "../element/types";
import {
	ELEMENT_TYPE_VALUES,
	isAssetBackedElementType,
} from "../element/types";
import { framesToTimecode, timecodeToFrames } from "../utils/timecode";
import {
	DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	type ExportAudioDspSettings,
	resolveExportAudioDspSettings,
} from "./audio/dsp/types";
import type { TimelineTrack } from "./timeline/types";

/**
 * 时间线 JSON 格式定义
 */
export interface TimelineJSON {
	fps: number;
	canvas: {
		width: number;
		height: number;
	};
	settings: TimelineSettings;
	tracks?: TimelineTrackJSON[];
	elements: TimelineElement[];
}

export interface TimelineSettings {
	snapEnabled: boolean;
	autoAttach: boolean;
	rippleEditingEnabled: boolean;
	previewAxisEnabled: boolean;
	audio: ExportAudioDspSettings;
}

const cloneDefaultAudioSettings = (): ExportAudioDspSettings => ({
	...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	compressor: { ...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.compressor },
});

/**
 * 时间线默认配置
 */
export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
	snapEnabled: true,
	autoAttach: true,
	rippleEditingEnabled: true,
	previewAxisEnabled: true,
	audio: cloneDefaultAudioSettings(),
};

export interface TimelineData {
	fps: number;
	canvas: { width: number; height: number };
	tracks: TimelineTrack[];
	elements: TimelineElement[];
	settings: TimelineSettings;
}

export interface TimelineTrackJSON {
	id: string;
	role?: TrackRole;
	hidden?: boolean;
	locked?: boolean;
	muted?: boolean;
	solo?: boolean;
}

const trackRoleSchema = z.enum(["clip", "overlay", "effect", "audio"]);
const elementTypeSchema = z.enum(ELEMENT_TYPE_VALUES);
const nonEmptyStringSchema = z.string().min(1);
const finiteNumberSchema = z.number().refine(Number.isFinite, {
	message: "must be a finite number",
});

const timelineAudioCompressorSchema = z.object({
	enabled: z.boolean().optional(),
	thresholdDb: finiteNumberSchema.optional(),
	ratio: finiteNumberSchema.optional(),
	kneeDb: finiteNumberSchema.optional(),
	attackMs: finiteNumberSchema.optional(),
	releaseMs: finiteNumberSchema.optional(),
	makeupGainDb: finiteNumberSchema.optional(),
});

const timelineAudioSettingsSchema = z.object({
	exportSampleRate: z.union([z.literal(44100), z.literal(48000)]).optional(),
	exportBlockSize: z
		.union([z.literal(256), z.literal(512), z.literal(1024)])
		.optional(),
	masterGainDb: finiteNumberSchema.optional(),
	compressor: timelineAudioCompressorSchema.optional(),
});

const timelineSettingsSchema = z.object({
	snapEnabled: z.boolean(),
	autoAttach: z.boolean(),
	rippleEditingEnabled: z.boolean(),
	previewAxisEnabled: z.boolean(),
	audio: timelineAudioSettingsSchema.optional(),
});

const timelineTrackSchema = z.object({
	id: nonEmptyStringSchema,
	role: trackRoleSchema.optional(),
	hidden: z.boolean().default(false),
	locked: z.boolean().default(false),
	muted: z.boolean().default(false),
	solo: z.boolean().default(false),
});

const transformMetaSchema: z.ZodType<TransformMeta> = z.object({
	baseSize: z.object({
		width: z.number().positive(),
		height: z.number().positive(),
	}),
	position: z.object({
		x: finiteNumberSchema,
		y: finiteNumberSchema,
		space: z.literal("canvas"),
	}),
	anchor: z.object({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		space: z.literal("normalized"),
	}),
	scale: z.object({
		x: finiteNumberSchema.refine((value) => Math.abs(value) >= Number.EPSILON, {
			message: "must be a non-zero finite number",
		}),
		y: finiteNumberSchema.refine((value) => Math.abs(value) >= Number.EPSILON, {
			message: "must be a non-zero finite number",
		}),
	}),
	rotation: z.object({
		value: finiteNumberSchema,
		unit: z.literal("deg"),
	}),
	crop: z
		.object({
			left: finiteNumberSchema,
			right: finiteNumberSchema,
			top: finiteNumberSchema,
			bottom: finiteNumberSchema,
			unit: z.enum(["normalized", "px"]),
		})
		.optional(),
	distort: z
		.discriminatedUnion("type", [
			z.object({
				type: z.literal("none"),
			}),
			z.object({
				type: z.literal("cornerPin"),
				points: z.tuple([
					z.object({ x: finiteNumberSchema, y: finiteNumberSchema }),
					z.object({ x: finiteNumberSchema, y: finiteNumberSchema }),
					z.object({ x: finiteNumberSchema, y: finiteNumberSchema }),
					z.object({ x: finiteNumberSchema, y: finiteNumberSchema }),
				]),
				space: z.literal("normalized_local"),
			}),
		])
		.optional(),
});

const transitionMetaSchema = z.object({
	duration: z.number().int().positive(),
	boundry: z.number().int().nonnegative(),
	fromId: nonEmptyStringSchema,
	toId: nonEmptyStringSchema,
});

const compositionPropsSchema: z.ZodType<CompositionProps> = z.object({
	sceneId: nonEmptyStringSchema,
});

const renderMetaSchema = z.object({
	zIndex: z.number().optional(),
	visible: z.boolean().optional(),
	opacity: z.number().min(0).max(1).optional(),
});

const timelineElementBaseSchema = z.object({
	id: nonEmptyStringSchema,
	type: elementTypeSchema,
	component: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	assetId: nonEmptyStringSchema.optional(),
	transform: transformMetaSchema.optional(),
	timeline: z.unknown(),
	render: z.unknown().optional(),
	props: z.unknown().optional(),
	clip: z.unknown().optional(),
	transition: z.unknown().optional(),
});

const timelineSchema = z.object({
	fps: z.number().int().positive(),
	canvas: z.object({
		width: z.number(),
		height: z.number(),
	}),
	settings: timelineSettingsSchema,
	tracks: z.array(z.unknown()).optional(),
	elements: z.array(z.unknown()),
});

const formatPath = (segments: (string | number)[]): string => {
	let result = "";
	for (const segment of segments) {
		if (typeof segment === "number") {
			result += `[${segment}]`;
			continue;
		}
		result += result.length > 0 ? `.${segment}` : segment;
	}
	return result;
};

const withBasePath = (
	basePath: string | undefined,
	segments: (string | number)[],
): string => {
	const suffix = formatPath(segments);
	if (!basePath) return suffix;
	if (!suffix) return basePath;
	return suffix.startsWith("[")
		? `${basePath}${suffix}`
		: `${basePath}.${suffix}`;
};

const parseWithSchema = <T>(
	schema: z.ZodType<T>,
	data: unknown,
	basePath?: string,
): T => {
	const parsed = schema.safeParse(data);
	if (parsed.success) {
		return parsed.data;
	}
	const issue = parsed.error.issues[0];
	if (!issue) {
		throw new Error(basePath ? `${basePath}: invalid value` : "invalid value");
	}
	const path = withBasePath(basePath, issue.path);
	throw new Error(path ? `${path}: ${issue.message}` : issue.message);
};

/**
 * 从 JSON 字符串加载时间线
 */
export function loadTimelineFromJSON(
	jsonString: string,
	assetIdSet?: ReadonlySet<string>,
): TimelineData {
	try {
		const data: unknown = JSON.parse(jsonString);
		return validateTimeline(data, assetIdSet);
	} catch (error) {
		console.error("Failed to parse timeline JSON:", error);
		throw new Error(
			`Invalid timeline JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * 从 JSON 对象加载时间线
 */
export function loadTimelineFromObject(
	data: unknown,
	assetIdSet?: ReadonlySet<string>,
): TimelineData {
	return validateTimeline(data, assetIdSet);
}

/**
 * 将时间线元素导出为 JSON 字符串
 */
export function saveTimelineToJSON(
	elements: TimelineElement[],
	fps: number,
	canvasSize: { width: number; height: number } = { width: 1920, height: 1080 },
	tracks?: TimelineTrack[],
	settings?: TimelineSettings,
): string {
	return JSON.stringify(
		saveTimelineToObject(elements, fps, canvasSize, tracks, settings),
		null,
		2,
	);
}

/**
 * 将时间线元素导出为 JSON 对象
 */
export function saveTimelineToObject(
	elements: TimelineElement[],
	fps: number,
	canvasSize: { width: number; height: number } = { width: 1920, height: 1080 },
	tracks?: TimelineTrack[],
	settings?: TimelineSettings,
): TimelineJSON {
	const serializedTracks = serializeTracks(tracks);
	const resolvedSettings: TimelineSettings = {
		snapEnabled: settings?.snapEnabled ?? DEFAULT_TIMELINE_SETTINGS.snapEnabled,
		autoAttach: settings?.autoAttach ?? DEFAULT_TIMELINE_SETTINGS.autoAttach,
		rippleEditingEnabled:
			settings?.rippleEditingEnabled ??
			DEFAULT_TIMELINE_SETTINGS.rippleEditingEnabled,
		previewAxisEnabled:
			settings?.previewAxisEnabled ??
			DEFAULT_TIMELINE_SETTINGS.previewAxisEnabled,
		audio: resolveExportAudioDspSettings(settings?.audio),
	};
	return {
		fps,
		canvas: canvasSize,
		settings: resolvedSettings,
		...(serializedTracks ? { tracks: serializedTracks } : {}),
		elements: elements.map((element) =>
			removeLegacyUriFromProps(ensureTimecodes(element, fps)),
		),
	};
}

/**
 * 验证时间线数据
 */
function validateTimeline(
	data: unknown,
	assetIdSet?: ReadonlySet<string>,
): TimelineData {
	const timeline = parseWithSchema(timelineSchema, data, "timeline");
	const fps = timeline.fps;
	const elements = timeline.elements.map((element, index) =>
		validateElement(element, index, fps, assetIdSet),
	);

	return {
		fps,
		canvas: {
			width: timeline.canvas.width,
			height: timeline.canvas.height,
		},
		tracks: validateTracks(timeline.tracks, "tracks"),
		settings: validateSettings(timeline.settings, "settings"),
		elements,
	};
}

/**
 * 验证单个元素
 */
function validateElement(
	el: unknown,
	index: number,
	fps: number,
	assetIdSet?: ReadonlySet<string>,
): TimelineElement {
	const path = `elements[${index}]`;
	const element = parseWithSchema(timelineElementBaseSchema, el, path);
	const type = element.type;

	// 验证 transform
	const transform = validateTransform(element.transform, `${path}.transform`);

	// 验证 timeline
	// 转场允许 0 长度的时间范围
	const allowZeroDuration = false;
	const timeline = validateTimelineProps(
		element.timeline,
		`${path}.timeline`,
		fps,
		allowZeroDuration,
		{
			allowNegativeTrackIndex: type === "AudioClip",
			requireNegativeTrackIndex: type === "AudioClip",
		},
	);

	// 验证 render (可选)
	const render = validateRender(element.render ?? {}, `${path}.render`);

	// props 可以是任意对象
	let props = (element.props ?? {}) as TimelineElement["props"];
	const mediaProps = props as { uri?: unknown };
	if (isAssetBackedElementType(type) && mediaProps.uri !== undefined) {
		throw new Error(`${path}.props.uri: must use assetId instead`);
	}
	if (type === "Composition") {
		props = validateCompositionProps(props, `${path}.props`);
	}

	if (isAssetBackedElementType(type)) {
		if (!element.assetId) {
			throw new Error(`${path}.assetId: required for ${type}`);
		}
		if (assetIdSet && !assetIdSet.has(element.assetId)) {
			throw new Error(`${path}.assetId: asset "${element.assetId}" not found`);
		}
	}

	const clip = element.clip as TimelineElement["clip"];
	const transition = validateTransition(
		element.transition,
		`${path}.transition`,
		type === "Transition",
		type === "Transition" ? timeline : undefined,
	);

	return {
		id: element.id,
		type,
		component: element.component,
		name: element.name,
		assetId: element.assetId,
		transform,
		timeline,
		render,
		props,
		clip,
		transition,
	};
}

function validateTracks(tracks: unknown, path: string): TimelineTrack[] {
	const values = parseWithSchema(
		z.array(timelineTrackSchema).optional(),
		tracks,
		path,
	);
	if (!values) {
		return [];
	}
	return values.map((track, index) => ({
		id: track.id,
		role: track.role ?? (index === 0 ? "clip" : "overlay"),
		hidden: track.hidden ?? false,
		locked: track.locked ?? false,
		muted: track.muted ?? false,
		solo: track.solo ?? false,
	}));
}

function validateSettings(settings: unknown, path: string): TimelineSettings {
	const parsed = parseWithSchema(timelineSettingsSchema, settings, path);
	return {
		snapEnabled: parsed.snapEnabled,
		autoAttach: parsed.autoAttach,
		rippleEditingEnabled: parsed.rippleEditingEnabled,
		previewAxisEnabled: parsed.previewAxisEnabled,
		audio: resolveExportAudioDspSettings(parsed.audio),
	};
}

function serializeTracks(
	tracks?: TimelineTrack[],
): TimelineTrack[] | undefined {
	if (!tracks || tracks.length === 0) {
		return undefined;
	}
	return tracks.map((track) => ({
		id: track.id,
		role: track.role,
		hidden: track.hidden ?? false,
		locked: track.locked ?? false,
		muted: track.muted ?? false,
		solo: track.solo ?? false,
	}));
}

const removeLegacyUriFromProps = (
	element: TimelineElement,
): TimelineElement => {
	if (!isAssetBackedElementType(element.type)) {
		return element;
	}
	const currentProps = (element.props ?? {}) as Record<string, unknown>;
	if (!Object.hasOwn(currentProps, "uri")) {
		return element;
	}
	const { uri: _removed, ...rest } = currentProps;
	return {
		...element,
		props: rest,
	};
};

/**
 * 验证 timeline 属性
 */
function createTimelineMetaSchema(
	fps: number,
	allowZeroDuration: boolean,
	options?: {
		allowNegativeTrackIndex?: boolean;
		requireNegativeTrackIndex?: boolean;
	},
): z.ZodType<TimelineMeta> {
	return z
		.object({
			start: z.number().int().nonnegative(),
			end: z.number().int(),
			startTimecode: z.string(),
			endTimecode: z.string(),
			trackIndex: z.number().optional(),
			offset: z.number().int().nonnegative().optional(),
			trackId: z.string().optional(),
			role: trackRoleSchema.optional(),
		})
		.superRefine((value, ctx) => {
			if (
				allowZeroDuration ? value.end < value.start : value.end <= value.start
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["end"],
					message: `must be greater than${allowZeroDuration ? " or equal to" : ""} start`,
				});
			}

			if (
				value.trackIndex !== undefined &&
				!options?.allowNegativeTrackIndex &&
				value.trackIndex < 0
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["trackIndex"],
					message: "must be a non-negative number",
				});
			}

			if (
				options?.requireNegativeTrackIndex &&
				(value.trackIndex === undefined ||
					!Number.isFinite(value.trackIndex) ||
					value.trackIndex >= 0)
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["trackIndex"],
					message: "AudioClip must use a negative trackIndex",
				});
			}

			let expectedStart: number;
			let expectedEnd: number;
			try {
				expectedStart = timecodeToFrames(value.startTimecode, fps);
				expectedEnd = timecodeToFrames(value.endTimecode, fps);
			} catch {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["startTimecode"],
					message: "invalid timecode",
				});
				return;
			}

			if (expectedStart !== value.start) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["startTimecode"],
					message: "does not match start frame",
				});
			}
			if (expectedEnd !== value.end) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["endTimecode"],
					message: "does not match end frame",
				});
			}
		});
}

function validateTimelineProps(
	timeline: unknown,
	path: string,
	fps: number,
	allowZeroDuration: boolean = false,
	options?: {
		allowNegativeTrackIndex?: boolean;
		requireNegativeTrackIndex?: boolean;
	},
): TimelineMeta {
	return parseWithSchema(
		createTimelineMetaSchema(fps, allowZeroDuration, options),
		timeline,
		path,
	);
}

/**
 * 验证 transform 属性
 */
function validateTransform(
	transform: unknown,
	path: string,
): TransformMeta | undefined {
	return parseWithSchema(transformMetaSchema.optional(), transform, path);
}

function ensureTimecodes(
	element: TimelineElement,
	fps: number,
): TimelineElement {
	const startTimecode = framesToTimecode(element.timeline.start, fps);
	const endTimecode = framesToTimecode(element.timeline.end, fps);
	if (
		element.timeline.startTimecode === startTimecode &&
		element.timeline.endTimecode === endTimecode
	) {
		return element;
	}
	return {
		...element,
		timeline: {
			...element.timeline,
			startTimecode,
			endTimecode,
		},
	};
}

/**
 * 验证 transition 属性
 */
function validateTransition(
	transition: unknown,
	path: string,
	required: boolean,
	timeline?: TimelineMeta,
): TransitionMeta | undefined {
	const transitionSchemaWithTimeline = timeline
		? transitionMetaSchema.superRefine((value, ctx) => {
				const expectedDuration = timeline.end - timeline.start;
				if (value.duration !== expectedDuration) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["duration"],
						message: "does not match timeline range",
					});
				}
				const expectedBoundary =
					timeline.start + Math.floor(value.duration / 2);
				if (value.boundry !== expectedBoundary) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["boundry"],
						message: "does not match timeline range",
					});
				}
			})
		: transitionMetaSchema;
	const schema = required
		? transitionSchemaWithTimeline
		: transitionSchemaWithTimeline.optional();
	return parseWithSchema(schema, transition, path);
}

/**
 * 验证 composition 属性
 */
function validateCompositionProps(
	props: unknown,
	path: string,
): CompositionProps {
	return parseWithSchema(compositionPropsSchema, props, path);
}

/**
 * 验证 render 属性
 */
function validateRender(render: unknown, path: string): RenderMeta {
	return parseWithSchema(renderMetaSchema, render, path);
}
