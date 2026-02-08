import type {
	RenderMeta,
	TimelineElement,
	TimelineMeta,
	TrackRole,
	TransformMeta,
	TransitionMeta,
} from "../dsl/types";
import { ELEMENT_TYPE_VALUES } from "../dsl/types";
import type {
	TranscriptRecord,
	TranscriptSegment,
	TranscriptWord,
} from "../asr/types";
import { framesToTimecode, timecodeToFrames } from "../utils/timecode";
import type { TimelineTrack } from "./timeline/types";

/**
 * 时间线 JSON 格式定义
 */
export interface TimelineJSON {
	version: string;
	fps: number;
	canvas: {
		width: number;
		height: number;
	};
	settings: TimelineSettings;
	tracks?: TimelineTrackJSON[];
	transcripts?: TranscriptRecord[];
	elements: TimelineElement[];
}

export interface TimelineSettings {
	snapEnabled: boolean;
	autoAttach: boolean;
	rippleEditingEnabled: boolean;
	previewAxisEnabled: boolean;
}

/**
 * 时间线默认配置
 */
export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = {
	snapEnabled: true,
	autoAttach: true,
	rippleEditingEnabled: true,
	previewAxisEnabled: true,
};

export interface TimelineData {
	fps: number;
	canvas: { width: number; height: number };
	tracks: TimelineTrack[];
	elements: TimelineElement[];
	transcripts: TranscriptRecord[];
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

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null;

const expectRecord = (value: unknown, path: string): UnknownRecord => {
	if (!isRecord(value)) {
		throw new Error(`${path}: must be an object`);
	}
	return value;
};

const isTrackRole = (value: unknown): value is TrackRole =>
	value === "clip" ||
	value === "overlay" ||
	value === "effect" ||
	value === "audio";

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const isIntegerNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/**
 * 从 JSON 字符串加载时间线
 */
export function loadTimelineFromJSON(jsonString: string): TimelineData {
	try {
		const data: unknown = JSON.parse(jsonString);
		return validateTimeline(data);
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
export function loadTimelineFromObject(data: unknown): TimelineData {
	return validateTimeline(data);
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
	transcripts?: TranscriptRecord[],
): string {
	return JSON.stringify(
		saveTimelineToObject(elements, fps, canvasSize, tracks, settings, transcripts),
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
	transcripts?: TranscriptRecord[],
): TimelineJSON {
	const serializedTracks = serializeTracks(tracks);
	const resolvedSettings = settings ?? DEFAULT_TIMELINE_SETTINGS;
	return {
		version: "1.0",
		fps,
		canvas: canvasSize,
		settings: resolvedSettings,
		...(serializedTracks ? { tracks: serializedTracks } : {}),
		...(transcripts ? { transcripts } : {}),
		elements: elements.map((el) => ensureTimecodes(el, fps)),
	};
}

/**
 * 验证时间线数据
 */
function validateTimeline(data: unknown): TimelineData {
	const timeline = expectRecord(data, "timeline");

	if (!isNonEmptyString(timeline.version)) {
		throw new Error("Timeline JSON missing version field");
	}
	if (timeline.version !== "1.0") {
		throw new Error(
			`Unsupported timeline version "${timeline.version}", expected "1.0"`,
		);
	}

	if (!isIntegerNumber(timeline.fps) || timeline.fps <= 0) {
		throw new Error("Timeline JSON missing or invalid fps");
	}
	const fps = timeline.fps;

	const canvasRecord = expectRecord(timeline.canvas, "canvas");
	if (
		typeof canvasRecord.width !== "number" ||
		typeof canvasRecord.height !== "number"
	) {
		throw new Error("Timeline JSON missing or invalid canvas size");
	}
	const canvas = {
		width: canvasRecord.width,
		height: canvasRecord.height,
	};

	if (!Array.isArray(timeline.elements)) {
		throw new Error("Timeline JSON elements must be an array");
	}

	return {
		fps,
		canvas,
		tracks: validateTracks(timeline.tracks, "tracks"),
		transcripts: validateTranscripts(timeline.transcripts, "transcripts"),
		settings: validateSettings(timeline.settings, "settings"),
		elements: timeline.elements.map((el, index) =>
			validateElement(el, index, fps),
		),
	};
}

/**
 * 验证单个元素
 */
function validateElement(el: unknown, index: number, fps: number): TimelineElement {
	const path = `elements[${index}]`;
	const element = expectRecord(el, path);

	if (!isNonEmptyString(element.id)) {
		throw new Error(`${path}: missing or invalid 'id' field`);
	}

	if (!isNonEmptyString(element.type)) {
		throw new Error(`${path}: missing or invalid 'type' field`);
	}
	if (!ELEMENT_TYPE_VALUES.includes(element.type as TimelineElement["type"])) {
		throw new Error(`${path}.type: unsupported type "${element.type}"`);
	}
	const type = element.type as TimelineElement["type"];

	if (!isNonEmptyString(element.component)) {
		throw new Error(`${path}: missing or invalid 'component' field`);
	}

	if (!isNonEmptyString(element.name)) {
		throw new Error(`${path}: missing or invalid 'name' field`);
	}

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
		},
	);
	if (type === "AudioClip") {
		if (
			timeline.trackIndex === undefined ||
			!Number.isFinite(timeline.trackIndex) ||
			timeline.trackIndex >= 0
		) {
			throw new Error(`${path}.timeline.trackIndex: AudioClip must use a negative trackIndex`);
		}
	}

	// 验证 render (可选)
	const render = validateRender(element.render ?? {}, `${path}.render`);

	// props 可以是任意对象
	const props = (element.props ?? {}) as TimelineElement["props"];

	const clip = element.clip as TimelineElement["clip"];
	const transition = validateTransition(
		element.transition,
		`${path}.transition`,
		type === "Transition",
	);
	if (type === "Transition" && !transition) {
		throw new Error(`${path}.transition: required for Transition element`);
	}
	if (type === "Transition" && transition) {
		const expectedDuration = timeline.end - timeline.start;
		if (expectedDuration !== transition.duration) {
			throw new Error(
				`${path}.transition.duration does not match timeline range`,
			);
		}
		const expectedBoundary =
			timeline.start + Math.floor(transition.duration / 2);
		if (transition.boundry !== expectedBoundary) {
			throw new Error(
				`${path}.transition.boundry does not match timeline range`,
			);
		}
	}

	return {
		id: element.id,
		type,
		component: element.component,
		name: element.name,
		transform,
		timeline,
		render,
		props,
		clip,
		transition,
	};
}

function validateTracks(
	tracks: unknown,
	path: string,
): TimelineTrack[] {
	if (tracks === undefined) {
		return [];
	}
	if (!Array.isArray(tracks)) {
		throw new Error(`${path}: must be an array`);
	}
	return tracks.map((track, index) =>
		validateTrack(track, `${path}[${index}]`, index),
	);
}

function validateTranscripts(
	transcripts: unknown,
	path: string,
): TranscriptRecord[] {
	if (transcripts === undefined) {
		return [];
	}
	if (!Array.isArray(transcripts)) {
		throw new Error(`${path}: must be an array`);
	}
	return transcripts.map((record, index) =>
		validateTranscript(record, `${path}[${index}]`),
	);
}

function validateTranscript(record: unknown, path: string): TranscriptRecord {
	const transcript = expectRecord(record, path);

	if (!isNonEmptyString(transcript.id)) {
		throw new Error(`${path}.id: must be a string`);
	}
	const source = validateTranscriptSource(transcript.source, `${path}.source`);
	if (typeof transcript.language !== "string") {
		throw new Error(`${path}.language: must be a string`);
	}
	if (typeof transcript.model !== "string") {
		throw new Error(`${path}.model: must be a string`);
	}
	const model = transcript.model;
	if (
		model !== "tiny" &&
		model !== "large-v3-turbo"
	) {
		throw new Error(`${path}.model: must be one of tiny | large-v3-turbo`);
	}
	if (!isFiniteNumber(transcript.createdAt)) {
		throw new Error(`${path}.createdAt: must be a number`);
	}
	if (!isFiniteNumber(transcript.updatedAt)) {
		throw new Error(`${path}.updatedAt: must be a number`);
	}
	const createdAt = transcript.createdAt;
	const updatedAt = transcript.updatedAt;
	if (!Array.isArray(transcript.segments)) {
		throw new Error(`${path}.segments: must be an array`);
	}
	const segments = transcript.segments.map((segment, index) =>
		validateTranscriptSegment(segment, `${path}.segments[${index}]`),
	);

	return {
		id: transcript.id,
		source,
		language: transcript.language,
		model,
		createdAt,
		updatedAt,
		segments,
	};
}

function validateTranscriptSource(
	source: unknown,
	path: string,
): TranscriptRecord["source"] {
	const sourceRecord = expectRecord(source, path);

	if (sourceRecord.type !== "opfs-audio") {
		throw new Error(`${path}.type: must be opfs-audio`);
	}
	if (typeof sourceRecord.uri !== "string") {
		throw new Error(`${path}.uri: must be a string`);
	}
	if (!sourceRecord.uri.startsWith("opfs://projects/")) {
		throw new Error(`${path}.uri: must start with opfs://projects/`);
	}
	if (typeof sourceRecord.fileName !== "string") {
		throw new Error(`${path}.fileName: must be a string`);
	}
	if (!isFiniteNumber(sourceRecord.duration) || sourceRecord.duration < 0) {
		throw new Error(`${path}.duration: must be a non-negative number`);
	}
	const duration = sourceRecord.duration;
	return {
		type: "opfs-audio",
		uri: sourceRecord.uri,
		fileName: sourceRecord.fileName,
		duration,
	};
}

function validateTranscriptSegment(
	segment: unknown,
	path: string,
): TranscriptSegment {
	const current = expectRecord(segment, path);

	if (!isNonEmptyString(current.id)) {
		throw new Error(`${path}.id: must be a string`);
	}
	if (!isFiniteNumber(current.start)) {
		throw new Error(`${path}.start: must be a number`);
	}
	if (!isFiniteNumber(current.end)) {
		throw new Error(`${path}.end: must be a number`);
	}
	const start = current.start;
	const end = current.end;
	if (typeof current.text !== "string") {
		throw new Error(`${path}.text: must be a string`);
	}
	if (!Array.isArray(current.words)) {
		throw new Error(`${path}.words: must be an array`);
	}
	const words = current.words.map((word, index) =>
		validateTranscriptWord(word, `${path}.words[${index}]`),
	);
	return {
		id: current.id,
		start,
		end,
		text: current.text,
		words,
	};
}

function validateTranscriptWord(word: unknown, path: string): TranscriptWord {
	const current = expectRecord(word, path);

	if (!isNonEmptyString(current.id)) {
		throw new Error(`${path}.id: must be a string`);
	}
	if (typeof current.text !== "string") {
		throw new Error(`${path}.text: must be a string`);
	}
	if (!isFiniteNumber(current.start)) {
		throw new Error(`${path}.start: must be a number`);
	}
	if (!isFiniteNumber(current.end)) {
		throw new Error(`${path}.end: must be a number`);
	}
	const start = current.start;
	const end = current.end;
	if (
		current.confidence !== undefined &&
		!isFiniteNumber(current.confidence)
	) {
		throw new Error(`${path}.confidence: must be a number`);
	}
	const confidence = current.confidence;
	return {
		id: current.id,
		text: current.text,
		start,
		end,
		...(confidence !== undefined ? { confidence } : {}),
	};
}

function validateSettings(
	settings: unknown,
	path: string,
): TimelineSettings {
	if (settings === undefined) {
		throw new Error(`${path}: required`);
	}
	const current = expectRecord(settings, path);
	const resolveBoolean = (
		value: unknown,
		field: keyof TimelineSettings,
	): boolean => {
		if (typeof value !== "boolean") {
			throw new Error(`${path}.${field}: must be a boolean`);
		}
		return value;
	};
	const resolveOptionalBoolean = (value: unknown, field: string) => {
		if (value === undefined) return undefined;
		if (typeof value !== "boolean") {
			throw new Error(`${path}.${field}: must be a boolean`);
		}
		return value;
	};
	const rippleEditingEnabled =
		resolveOptionalBoolean(current.rippleEditingEnabled, "rippleEditingEnabled") ??
		resolveOptionalBoolean(
			current.mainTrackMagnetEnabled,
			"mainTrackMagnetEnabled",
		);
	if (rippleEditingEnabled === undefined) {
		throw new Error(`${path}.rippleEditingEnabled: must be a boolean`);
	}
	return {
		snapEnabled: resolveBoolean(current.snapEnabled, "snapEnabled"),
		autoAttach: resolveBoolean(current.autoAttach, "autoAttach"),
		rippleEditingEnabled,
		previewAxisEnabled: resolveBoolean(
			current.previewAxisEnabled,
			"previewAxisEnabled",
		),
	};
}

function validateTrack(
	track: unknown,
	path: string,
	index: number,
): TimelineTrack {
	const current = expectRecord(track, path);

	if (!isNonEmptyString(current.id)) {
		throw new Error(`${path}.id: must be a string`);
	}

	let role: TrackRole = index === 0 ? "clip" : "overlay";
	if (current.role !== undefined) {
		if (!isTrackRole(current.role)) {
			throw new Error(
				`${path}.role: must be one of clip | overlay | effect | audio`,
			);
		}
		role = current.role;
	}

	let hidden = false;
	if (current.hidden !== undefined) {
		if (typeof current.hidden !== "boolean") {
			throw new Error(`${path}.hidden: must be a boolean`);
		}
		hidden = current.hidden;
	}

	let locked = false;
	if (current.locked !== undefined) {
		if (typeof current.locked !== "boolean") {
			throw new Error(`${path}.locked: must be a boolean`);
		}
		locked = current.locked;
	}

	let muted = false;
	if (current.muted !== undefined) {
		if (typeof current.muted !== "boolean") {
			throw new Error(`${path}.muted: must be a boolean`);
		}
		muted = current.muted;
	}

	let solo = false;
	if (current.solo !== undefined) {
		if (typeof current.solo !== "boolean") {
			throw new Error(`${path}.solo: must be a boolean`);
		}
		solo = current.solo;
	}

	return {
		id: current.id,
		role,
		hidden,
		locked,
		muted,
		solo,
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

/**
 * 验证 transform 属性
 */
function validateTransform(transform: unknown, path: string): TransformMeta {
	const current = expectRecord(transform, path);

	if (current.schema !== "v2") {
		throw new Error(`${path}.schema: must be "v2"`);
	}

	const baseSize = expectRecord(current.baseSize, `${path}.baseSize`);
	if (typeof baseSize.width !== "number" || baseSize.width <= 0) {
		throw new Error(`${path}.baseSize.width: must be a positive number`);
	}
	if (typeof baseSize.height !== "number" || baseSize.height <= 0) {
		throw new Error(`${path}.baseSize.height: must be a positive number`);
	}

	const position = expectRecord(current.position, `${path}.position`);
	if (typeof position.x !== "number" || !Number.isFinite(position.x)) {
		throw new Error(`${path}.position.x: must be a finite number`);
	}
	if (typeof position.y !== "number" || !Number.isFinite(position.y)) {
		throw new Error(`${path}.position.y: must be a finite number`);
	}
	if (position.space !== "canvas") {
		throw new Error(`${path}.position.space: must be "canvas"`);
	}

	const anchor = expectRecord(current.anchor, `${path}.anchor`);
	if (typeof anchor.x !== "number" || anchor.x < 0 || anchor.x > 1) {
		throw new Error(`${path}.anchor.x: must be a number between 0 and 1`);
	}
	if (typeof anchor.y !== "number" || anchor.y < 0 || anchor.y > 1) {
		throw new Error(`${path}.anchor.y: must be a number between 0 and 1`);
	}
	if (anchor.space !== "normalized") {
		throw new Error(`${path}.anchor.space: must be "normalized"`);
	}

	const scale = expectRecord(current.scale, `${path}.scale`);
	if (
		typeof scale.x !== "number" ||
		!Number.isFinite(scale.x) ||
		Math.abs(scale.x) < Number.EPSILON
	) {
		throw new Error(`${path}.scale.x: must be a non-zero finite number`);
	}
	if (
		typeof scale.y !== "number" ||
		!Number.isFinite(scale.y) ||
		Math.abs(scale.y) < Number.EPSILON
	) {
		throw new Error(`${path}.scale.y: must be a non-zero finite number`);
	}

	const rotation = expectRecord(current.rotation, `${path}.rotation`);
	if (typeof rotation.value !== "number" || !Number.isFinite(rotation.value)) {
		throw new Error(`${path}.rotation.value: must be a finite number`);
	}
	if (rotation.unit !== "deg") {
		throw new Error(`${path}.rotation.unit: must be "deg"`);
	}

	let crop: TransformMeta["crop"];
	if (current.crop !== undefined) {
		const cropValue = expectRecord(current.crop, `${path}.crop`);
		if (typeof cropValue.left !== "number" || !Number.isFinite(cropValue.left)) {
			throw new Error(`${path}.crop.left: must be a finite number`);
		}
		if (
			typeof cropValue.right !== "number" ||
			!Number.isFinite(cropValue.right)
		) {
			throw new Error(`${path}.crop.right: must be a finite number`);
		}
		if (typeof cropValue.top !== "number" || !Number.isFinite(cropValue.top)) {
			throw new Error(`${path}.crop.top: must be a finite number`);
		}
		if (
			typeof cropValue.bottom !== "number" ||
			!Number.isFinite(cropValue.bottom)
		) {
			throw new Error(`${path}.crop.bottom: must be a finite number`);
		}
		if (cropValue.unit !== "normalized" && cropValue.unit !== "px") {
			throw new Error(`${path}.crop.unit: must be "normalized" or "px"`);
		}
		crop = {
			left: cropValue.left,
			right: cropValue.right,
			top: cropValue.top,
			bottom: cropValue.bottom,
			unit: cropValue.unit,
		};
	}

	let distort: TransformMeta["distort"];
	if (current.distort !== undefined) {
		const distortValue = expectRecord(current.distort, `${path}.distort`);
		if (distortValue.type === "none") {
			distort = { type: "none" };
		} else if (distortValue.type === "cornerPin") {
			if (distortValue.space !== "normalized_local") {
				throw new Error(`${path}.distort.space: must be "normalized_local"`);
			}
			if (!Array.isArray(distortValue.points) || distortValue.points.length !== 4) {
				throw new Error(`${path}.distort.points: must contain 4 points`);
			}
			const points = distortValue.points.map((point, pointIndex) => {
				const pointRecord = expectRecord(
					point,
					`${path}.distort.points[${pointIndex}]`,
				);
				if (
					typeof pointRecord.x !== "number" ||
					!Number.isFinite(pointRecord.x)
				) {
					throw new Error(
						`${path}.distort.points[${pointIndex}].x: must be a finite number`,
					);
				}
				if (
					typeof pointRecord.y !== "number" ||
					!Number.isFinite(pointRecord.y)
				) {
					throw new Error(
						`${path}.distort.points[${pointIndex}].y: must be a finite number`,
					);
				}
				return {
					x: pointRecord.x,
					y: pointRecord.y,
				};
			});
			distort = {
				type: "cornerPin",
				points: [points[0], points[1], points[2], points[3]],
				space: "normalized_local",
			};
		} else {
			throw new Error(`${path}.distort.type: must be "none" or "cornerPin"`);
		}
	}

	return {
		schema: "v2",
		baseSize: {
			width: baseSize.width,
			height: baseSize.height,
		},
		position: {
			x: position.x,
			y: position.y,
			space: "canvas",
		},
		anchor: {
			x: anchor.x,
			y: anchor.y,
			space: "normalized",
		},
		scale: {
			x: scale.x,
			y: scale.y,
		},
		rotation: {
			value: rotation.value,
			unit: "deg",
		},
		...(crop ? { crop } : {}),
		...(distort ? { distort } : {}),
	};
}

/**
 * 验证 timeline 属性
 */
function validateTimelineProps(
	timeline: unknown,
	path: string,
	fps: number,
	allowZeroDuration: boolean = false,
	options?: { allowNegativeTrackIndex?: boolean },
): TimelineMeta {
	const current = expectRecord(timeline, path);

	if (!isIntegerNumber(current.start) || current.start < 0) {
		throw new Error(`${path}.start: must be a non-negative integer`);
	}
	const start = current.start;

	if (
		!isIntegerNumber(current.end) ||
		(allowZeroDuration
			? current.end < start
			: current.end <= start)
	) {
		throw new Error(
			`${path}.end: must be greater than${allowZeroDuration ? " or equal to" : ""} start`,
		);
	}
	const end = current.end;

	if (typeof current.startTimecode !== "string") {
		throw new Error(`${path}.startTimecode: must be a string`);
	}
	const startTimecode = current.startTimecode;

	if (typeof current.endTimecode !== "string") {
		throw new Error(`${path}.endTimecode: must be a string`);
	}
	const endTimecode = current.endTimecode;

	const expectedStart = timecodeToFrames(startTimecode, fps);
	const expectedEnd = timecodeToFrames(endTimecode, fps);
	if (expectedStart !== start) {
		throw new Error(`${path}.startTimecode does not match start frame`);
	}
	if (expectedEnd !== end) {
		throw new Error(`${path}.endTimecode does not match end frame`);
	}

	let trackIndex: number | undefined;
	if (current.trackIndex !== undefined) {
		if (typeof current.trackIndex !== "number") {
			throw new Error(`${path}.trackIndex: must be a number`);
		}
		if (!options?.allowNegativeTrackIndex && current.trackIndex < 0) {
			throw new Error(`${path}.trackIndex: must be a non-negative number`);
		}
		trackIndex = current.trackIndex;
	}

	let offset: number | undefined;
	if (current.offset !== undefined) {
		if (!isIntegerNumber(current.offset) || current.offset < 0) {
			throw new Error(`${path}.offset: must be a non-negative integer`);
		}
		offset = current.offset;
	}

	let trackId: string | undefined;
	if (current.trackId !== undefined) {
		if (typeof current.trackId !== "string") {
			throw new Error(`${path}.trackId: must be a string`);
		}
		trackId = current.trackId;
	}

	let role: TrackRole | undefined;
	if (current.role !== undefined) {
		if (!isTrackRole(current.role)) {
			throw new Error(
				`${path}.role: must be one of clip | overlay | effect | audio`,
			);
		}
		role = current.role;
	}

	return {
		start,
		end,
		startTimecode,
		endTimecode,
		...(offset !== undefined ? { offset } : {}),
		...(trackIndex !== undefined ? { trackIndex } : {}),
		...(trackId ? { trackId } : {}),
		...(role ? { role } : {}),
	};
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
): TransitionMeta | undefined {
	if (transition === undefined) {
		if (required) {
			throw new Error(`${path}: required`);
		}
		return undefined;
	}
	const current = expectRecord(transition, path);
	if (
		typeof current.duration !== "number" ||
		!Number.isInteger(current.duration) ||
		current.duration <= 0
	) {
		throw new Error(`${path}.duration: must be a positive integer`);
	}
	const duration = current.duration;
	if (
		typeof current.boundry !== "number" ||
		!Number.isInteger(current.boundry) ||
		current.boundry < 0
	) {
		throw new Error(`${path}.boundry: must be a non-negative integer`);
	}
	const boundry = current.boundry;
	if (!isNonEmptyString(current.fromId)) {
		throw new Error(`${path}.fromId: must be a non-empty string`);
	}
	if (!isNonEmptyString(current.toId)) {
		throw new Error(`${path}.toId: must be a non-empty string`);
	}
	return {
		duration,
		boundry,
		fromId: current.fromId,
		toId: current.toId,
	};
}

/**
 * 验证 render 属性
 */
function validateRender(render: unknown, path: string): RenderMeta {
	if (!isRecord(render)) {
		return {};
	}
	const current = render;

	const result: RenderMeta = {};

	if (current.zIndex !== undefined) {
		if (typeof current.zIndex !== "number") {
			throw new Error(`${path}.zIndex: must be a number`);
		}
		result.zIndex = current.zIndex;
	}

	if (current.visible !== undefined) {
		if (typeof current.visible !== "boolean") {
			throw new Error(`${path}.visible: must be a boolean`);
		}
		result.visible = current.visible;
	}

	if (current.opacity !== undefined) {
		if (
			typeof current.opacity !== "number" ||
			current.opacity < 0 ||
			current.opacity > 1
		) {
			throw new Error(`${path}.opacity: must be a number between 0 and 1`);
		}
		result.opacity = current.opacity;
	}

	return result;
}

/**
 * 辅助函数：将旧的 left/top 坐标（左上角坐标系）转换为 V2 transform
 * @param layout 旧的布局信息（左上角坐标系）
 * @param pictureSize 画布尺寸，用于坐标系转换
 */
export function convertLegacyLayoutToTransform(
	layout: {
		left: number;
		top: number;
		width: number;
		height: number;
		rotate?: string;
	},
	_pictureSize: { width: number; height: number } = {
		width: 1920,
		height: 1080,
	},
): TransformMeta {
	// 解析旋转角度（保留度数表示）
	let rotation = 0;
	if (layout.rotate) {
		const match = layout.rotate.match(/^([-\d.]+)deg$/);
		if (match) {
			rotation = parseFloat(match[1]);
		}
	}

	return {
		schema: "v2",
		baseSize: {
			width: layout.width,
			height: layout.height,
		},
		position: {
			x: layout.left + layout.width / 2,
			y: layout.top + layout.height / 2,
			space: "canvas",
		},
		anchor: {
			x: 0.5,
			y: 0.5,
			space: "normalized",
		},
		scale: {
			x: 1,
			y: 1,
		},
		rotation: {
			value: rotation,
			unit: "deg",
		},
		distort: {
			type: "none",
		},
	};
}

/**
 * 辅助函数：将 V2 transform 转换为旧的 left/top 坐标（仅调试用途）
 * @param transform 变换属性（V2）
 * @param pictureSize 画布尺寸，用于坐标系转换
 */
export function convertTransformToLegacyLayout(
	transform: TransformMeta,
	_pictureSize: { width: number; height: number } = {
		width: 1920,
		height: 1080,
	},
): {
	left: number;
	top: number;
	width: number;
	height: number;
	rotate: string;
} {
	const width = transform.baseSize.width * Math.abs(transform.scale.x);
	const height = transform.baseSize.height * Math.abs(transform.scale.y);
	const left = transform.position.x - width * transform.anchor.x;
	const top = transform.position.y - height * transform.anchor.y;
	const degrees = transform.rotation.value;

	return {
		left,
		top,
		width,
		height,
		rotate: `${degrees}deg`,
	};
}
