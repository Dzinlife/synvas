import type {
	RenderMeta,
	TimelineElement,
	TimelineMeta,
	TrackRole,
	TransformMeta,
	TransitionMeta,
} from "../dsl/types";
import { ELEMENT_TYPE_VALUES } from "../dsl/types";
import type { TranscriptRecord, TranscriptSegment, TranscriptWord } from "@nle/asr/types";
import { framesToTimecode, timecodeToFrames } from "@nle/utils/timecode";
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
	mainTrackMagnetEnabled: boolean;
	previewAxisEnabled: boolean;
}

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

/**
 * 从 JSON 字符串加载时间线
 */
export function loadTimelineFromJSON(jsonString: string): TimelineData {
	try {
		const data: TimelineJSON = JSON.parse(jsonString);
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
export function loadTimelineFromObject(data: TimelineJSON): TimelineData {
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
	return {
		version: "1.0",
		fps,
		canvas: canvasSize,
		...(settings ? { settings } : {}),
		...(serializedTracks ? { tracks: serializedTracks } : {}),
		...(transcripts ? { transcripts } : {}),
		elements: elements.map((el) => ensureTimecodes(el, fps)),
	};
}

/**
 * 验证时间线数据
 */
function validateTimeline(data: TimelineJSON): TimelineData {
	if (!data.version) {
		throw new Error("Timeline JSON missing version field");
	}

	if (!Number.isInteger(data.fps) || data.fps <= 0) {
		throw new Error("Timeline JSON missing or invalid fps");
	}

	if (
		!data.canvas ||
		typeof data.canvas.width !== "number" ||
		typeof data.canvas.height !== "number"
	) {
		throw new Error("Timeline JSON missing or invalid canvas size");
	}

	if (!Array.isArray(data.elements)) {
		throw new Error("Timeline JSON elements must be an array");
	}

	return {
		fps: data.fps,
		canvas: data.canvas,
		tracks: validateTracks(data.tracks, "tracks"),
		transcripts: validateTranscripts(data.transcripts, "transcripts"),
		settings: validateSettings(data.settings, "settings"),
		elements: data.elements.map((el, index) =>
			validateElement(el, index, data.fps),
		),
	};
}

/**
 * 验证单个元素
 */
function validateElement(el: any, index: number, fps: number): TimelineElement {
	const path = `elements[${index}]`;

	if (!el.id || typeof el.id !== "string") {
		throw new Error(`${path}: missing or invalid 'id' field`);
	}

	if (!el.type || typeof el.type !== "string") {
		throw new Error(`${path}: missing or invalid 'type' field`);
	}
	if (!ELEMENT_TYPE_VALUES.includes(el.type)) {
		throw new Error(`${path}.type: unsupported type "${el.type}"`);
	}

	if (!el.component || typeof el.component !== "string") {
		throw new Error(`${path}: missing or invalid 'component' field`);
	}

	if (!el.name || typeof el.name !== "string") {
		throw new Error(`${path}: missing or invalid 'name' field`);
	}

	// 验证 transform
	const transform = validateTransform(el.transform, `${path}.transform`);

	// 验证 timeline
	// 转场允许 0 长度的时间范围
	const allowZeroDuration = false;
	const timeline = validateTimelineProps(
		el.timeline,
		`${path}.timeline`,
		fps,
		allowZeroDuration,
	);

	// 验证 render (可选)
	const render = validateRender(el.render || {}, `${path}.render`);

	// props 可以是任意对象
	const props = el.props || {};

	const clip = el.clip;
	const transition = validateTransition(
		el.transition,
		`${path}.transition`,
		el.type === "Transition",
	);
	if (el.type === "Transition" && !transition) {
		throw new Error(`${path}.transition: required for Transition element`);
	}
	if (el.type === "Transition" && transition) {
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
		id: el.id,
		type: el.type,
		component: el.component,
		name: el.name,
		transform,
		timeline,
		render,
		props,
		clip,
		transition,
	};
}

function validateTracks(
	tracks: any,
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
	transcripts: any,
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

function validateTranscript(record: any, path: string): TranscriptRecord {
	if (!record || typeof record !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	if (!record.id || typeof record.id !== "string") {
		throw new Error(`${path}.id: must be a string`);
	}
	const source = validateTranscriptSource(record.source, `${path}.source`);
	if (typeof record.language !== "string") {
		throw new Error(`${path}.language: must be a string`);
	}
	if (typeof record.model !== "string") {
		throw new Error(`${path}.model: must be a string`);
	}
	if (
		record.model !== "tiny" &&
		record.model !== "large-v3-turbo"
	) {
		throw new Error(`${path}.model: must be one of tiny | large-v3-turbo`);
	}
	if (!Number.isFinite(record.createdAt)) {
		throw new Error(`${path}.createdAt: must be a number`);
	}
	if (!Number.isFinite(record.updatedAt)) {
		throw new Error(`${path}.updatedAt: must be a number`);
	}
	if (!Array.isArray(record.segments)) {
		throw new Error(`${path}.segments: must be an array`);
	}
	const segments = record.segments.map((segment: any, index: number) =>
		validateTranscriptSegment(segment, `${path}.segments[${index}]`),
	);

	return {
		id: record.id,
		source,
		language: record.language,
		model: record.model,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		segments,
	};
}

function validateTranscriptSource(
	source: any,
	path: string,
): TranscriptRecord["source"] {
	if (!source || typeof source !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	if (source.type !== "opfs-audio") {
		throw new Error(`${path}.type: must be opfs-audio`);
	}
	if (typeof source.uri !== "string") {
		throw new Error(`${path}.uri: must be a string`);
	}
	if (typeof source.fileName !== "string") {
		throw new Error(`${path}.fileName: must be a string`);
	}
	if (!Number.isFinite(source.duration) || source.duration < 0) {
		throw new Error(`${path}.duration: must be a non-negative number`);
	}
	return {
		type: "opfs-audio",
		uri: source.uri,
		fileName: source.fileName,
		duration: source.duration,
	};
}

function validateTranscriptSegment(
	segment: any,
	path: string,
): TranscriptSegment {
	if (!segment || typeof segment !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	if (!segment.id || typeof segment.id !== "string") {
		throw new Error(`${path}.id: must be a string`);
	}
	if (!Number.isFinite(segment.start)) {
		throw new Error(`${path}.start: must be a number`);
	}
	if (!Number.isFinite(segment.end)) {
		throw new Error(`${path}.end: must be a number`);
	}
	if (typeof segment.text !== "string") {
		throw new Error(`${path}.text: must be a string`);
	}
	if (!Array.isArray(segment.words)) {
		throw new Error(`${path}.words: must be an array`);
	}
	const words = segment.words.map((word: any, index: number) =>
		validateTranscriptWord(word, `${path}.words[${index}]`),
	);
	return {
		id: segment.id,
		start: segment.start,
		end: segment.end,
		text: segment.text,
		words,
	};
}

function validateTranscriptWord(word: any, path: string): TranscriptWord {
	if (!word || typeof word !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	if (!word.id || typeof word.id !== "string") {
		throw new Error(`${path}.id: must be a string`);
	}
	if (typeof word.text !== "string") {
		throw new Error(`${path}.text: must be a string`);
	}
	if (!Number.isFinite(word.start)) {
		throw new Error(`${path}.start: must be a number`);
	}
	if (!Number.isFinite(word.end)) {
		throw new Error(`${path}.end: must be a number`);
	}
	if (word.confidence !== undefined && !Number.isFinite(word.confidence)) {
		throw new Error(`${path}.confidence: must be a number`);
	}
	return {
		id: word.id,
		text: word.text,
		start: word.start,
		end: word.end,
		...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
	};
}

function validateSettings(
	settings: any,
	path: string,
): TimelineSettings {
	if (settings === undefined) {
		throw new Error(`${path}: required`);
	}
	if (!settings || typeof settings !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	const resolveBoolean = (value: any, field: keyof TimelineSettings): boolean => {
		if (typeof value !== "boolean") {
			throw new Error(`${path}.${field}: must be a boolean`);
		}
		return value;
	};
	return {
		snapEnabled: resolveBoolean(settings.snapEnabled, "snapEnabled"),
		autoAttach: resolveBoolean(settings.autoAttach, "autoAttach"),
		mainTrackMagnetEnabled: resolveBoolean(
			settings.mainTrackMagnetEnabled,
			"mainTrackMagnetEnabled",
		),
		previewAxisEnabled: resolveBoolean(
			settings.previewAxisEnabled,
			"previewAxisEnabled",
		),
	};
}

function validateTrack(
	track: any,
	path: string,
	index: number,
): TimelineTrack {
	if (!track || typeof track !== "object") {
		throw new Error(`${path}: must be an object`);
	}

	if (!track.id || typeof track.id !== "string") {
		throw new Error(`${path}.id: must be a string`);
	}

	let role: TrackRole = index === 0 ? "clip" : "overlay";
	if (track.role !== undefined) {
		if (typeof track.role !== "string") {
			throw new Error(`${path}.role: must be a string`);
		}
		if (
			track.role !== "clip" &&
			track.role !== "overlay" &&
			track.role !== "effect" &&
			track.role !== "audio"
		) {
			throw new Error(
				`${path}.role: must be one of clip | overlay | effect | audio`,
			);
		}
		role = track.role as TrackRole;
	}

	let hidden = false;
	if (track.hidden !== undefined) {
		if (typeof track.hidden !== "boolean") {
			throw new Error(`${path}.hidden: must be a boolean`);
		}
		hidden = track.hidden;
	}

	let locked = false;
	if (track.locked !== undefined) {
		if (typeof track.locked !== "boolean") {
			throw new Error(`${path}.locked: must be a boolean`);
		}
		locked = track.locked;
	}

	let muted = false;
	if (track.muted !== undefined) {
		if (typeof track.muted !== "boolean") {
			throw new Error(`${path}.muted: must be a boolean`);
		}
		muted = track.muted;
	}

	let solo = false;
	if (track.solo !== undefined) {
		if (typeof track.solo !== "boolean") {
			throw new Error(`${path}.solo: must be a boolean`);
		}
		solo = track.solo;
	}

	return {
		id: track.id,
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
function validateTransform(transform: any, path: string): TransformMeta {
	if (!transform || typeof transform !== "object") {
		throw new Error(`${path}: must be an object`);
	}

	if (typeof transform.centerX !== "number") {
		throw new Error(`${path}.centerX: must be a number`);
	}

	if (typeof transform.centerY !== "number") {
		throw new Error(`${path}.centerY: must be a number`);
	}

	if (typeof transform.width !== "number" || transform.width <= 0) {
		throw new Error(`${path}.width: must be a positive number`);
	}

	if (typeof transform.height !== "number" || transform.height <= 0) {
		throw new Error(`${path}.height: must be a positive number`);
	}

	if (typeof transform.rotation !== "number") {
		throw new Error(`${path}.rotation: must be a number (radians)`);
	}

	return {
		centerX: transform.centerX,
		centerY: transform.centerY,
		width: transform.width,
		height: transform.height,
		rotation: transform.rotation,
	};
}

/**
 * 验证 timeline 属性
 */
function validateTimelineProps(
	timeline: any,
	path: string,
	fps: number,
	allowZeroDuration: boolean = false,
): TimelineMeta {
	if (!timeline || typeof timeline !== "object") {
		throw new Error(`${path}: must be an object`);
	}

	if (!Number.isInteger(timeline.start) || timeline.start < 0) {
		throw new Error(`${path}.start: must be a non-negative integer`);
	}

	if (
		!Number.isInteger(timeline.end) ||
		(allowZeroDuration
			? timeline.end < timeline.start
			: timeline.end <= timeline.start)
	) {
		throw new Error(
			`${path}.end: must be greater than${allowZeroDuration ? " or equal to" : ""} start`,
		);
	}

	if (typeof timeline.startTimecode !== "string") {
		throw new Error(`${path}.startTimecode: must be a string`);
	}

	if (typeof timeline.endTimecode !== "string") {
		throw new Error(`${path}.endTimecode: must be a string`);
	}

	const expectedStart = timecodeToFrames(timeline.startTimecode, fps);
	const expectedEnd = timecodeToFrames(timeline.endTimecode, fps);
	if (expectedStart !== timeline.start) {
		throw new Error(`${path}.startTimecode does not match start frame`);
	}
	if (expectedEnd !== timeline.end) {
		throw new Error(`${path}.endTimecode does not match end frame`);
	}

	if (timeline.trackIndex !== undefined) {
		if (typeof timeline.trackIndex !== "number" || timeline.trackIndex < 0) {
			throw new Error(`${path}.trackIndex: must be a non-negative number`);
		}
	}

	if (timeline.offset !== undefined) {
		if (!Number.isInteger(timeline.offset) || timeline.offset < 0) {
			throw new Error(`${path}.offset: must be a non-negative integer`);
		}
	}

	let trackId: string | undefined;
	if (timeline.trackId !== undefined) {
		if (typeof timeline.trackId !== "string") {
			throw new Error(`${path}.trackId: must be a string`);
		}
		trackId = timeline.trackId;
	}

	let role: TrackRole | undefined;
	if (timeline.role !== undefined) {
		if (typeof timeline.role !== "string") {
			throw new Error(`${path}.role: must be a string`);
		}
		const normalizedRole = timeline.role;
		if (
			normalizedRole !== "clip" &&
			normalizedRole !== "overlay" &&
			normalizedRole !== "effect" &&
			normalizedRole !== "audio"
		) {
			throw new Error(
				`${path}.role: must be one of clip | overlay | effect | audio`,
			);
		}
		role = normalizedRole as TrackRole;
	}

	return {
		start: timeline.start,
		end: timeline.end,
		startTimecode: timeline.startTimecode,
		endTimecode: timeline.endTimecode,
		...(timeline.offset !== undefined ? { offset: timeline.offset } : {}),
		...(timeline.trackIndex !== undefined
			? { trackIndex: timeline.trackIndex }
			: {}),
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
	transition: any,
	path: string,
	required: boolean,
): TransitionMeta | undefined {
	if (transition === undefined) {
		if (required) {
			throw new Error(`${path}: required`);
		}
		return undefined;
	}
	if (!transition || typeof transition !== "object") {
		throw new Error(`${path}: must be an object`);
	}
	if (
		typeof transition.duration !== "number" ||
		!Number.isInteger(transition.duration) ||
		transition.duration <= 0
	) {
		throw new Error(`${path}.duration: must be a positive integer`);
	}
	if (
		typeof transition.boundry !== "number" ||
		!Number.isInteger(transition.boundry) ||
		transition.boundry < 0
	) {
		throw new Error(`${path}.boundry: must be a non-negative integer`);
	}
	if (typeof transition.fromId !== "string" || transition.fromId.length === 0) {
		throw new Error(`${path}.fromId: must be a non-empty string`);
	}
	if (typeof transition.toId !== "string" || transition.toId.length === 0) {
		throw new Error(`${path}.toId: must be a non-empty string`);
	}
	return {
		duration: transition.duration,
		boundry: transition.boundry,
		fromId: transition.fromId,
		toId: transition.toId,
	};
}

/**
 * 验证 render 属性
 */
function validateRender(render: any, path: string): RenderMeta {
	if (!render || typeof render !== "object") {
		return {};
	}

	const result: RenderMeta = {};

	if (render.zIndex !== undefined) {
		if (typeof render.zIndex !== "number") {
			throw new Error(`${path}.zIndex: must be a number`);
		}
		result.zIndex = render.zIndex;
	}

	if (render.visible !== undefined) {
		if (typeof render.visible !== "boolean") {
			throw new Error(`${path}.visible: must be a boolean`);
		}
		result.visible = render.visible;
	}

	if (render.opacity !== undefined) {
		if (
			typeof render.opacity !== "number" ||
			render.opacity < 0 ||
			render.opacity > 1
		) {
			throw new Error(`${path}.opacity: must be a number between 0 and 1`);
		}
		result.opacity = render.opacity;
	}

	return result;
}

/**
 * 辅助函数：将旧的 left/top 坐标（左上角坐标系）转换为新的 center 坐标（画布中心坐标系）
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
	pictureSize: { width: number; height: number } = {
		width: 1920,
		height: 1080,
	},
): TransformMeta {
	// 从左上角坐标系转换到画布中心坐标系
	// 元素中心相对于画布左上角的坐标
	const centerXFromTopLeft = layout.left + layout.width / 2;
	const centerYFromTopLeft = layout.top + layout.height / 2;

	// 转换为相对于画布中心的坐标
	const centerX = centerXFromTopLeft - pictureSize.width / 2;
	const centerY = centerYFromTopLeft - pictureSize.height / 2;

	// 解析旋转角度（从 "45deg" 转换为弧度）
	let rotation = 0;
	if (layout.rotate) {
		const match = layout.rotate.match(/^([-\d.]+)deg$/);
		if (match) {
			const degrees = parseFloat(match[1]);
			rotation = (degrees * Math.PI) / 180;
		}
	}

	return {
		centerX,
		centerY,
		width: layout.width,
		height: layout.height,
		rotation,
	};
}

/**
 * 辅助函数：将新的 center 坐标（画布中心坐标系）转换为旧的 left/top 坐标（左上角坐标系，用于向后兼容）
 * @param transform 变换属性（画布中心坐标系）
 * @param pictureSize 画布尺寸，用于坐标系转换
 */
export function convertTransformToLegacyLayout(
	transform: TransformMeta,
	pictureSize: { width: number; height: number } = {
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
	// 从画布中心坐标系转换到左上角坐标系
	// 元素中心相对于画布左上角的坐标
	const centerXFromTopLeft = transform.centerX + pictureSize.width / 2;
	const centerYFromTopLeft = transform.centerY + pictureSize.height / 2;

	// 计算左上角坐标
	const left = centerXFromTopLeft - transform.width / 2;
	const top = centerYFromTopLeft - transform.height / 2;
	const degrees = (transform.rotation * 180) / Math.PI;

	return {
		left,
		top,
		width: transform.width,
		height: transform.height,
		rotate: `${degrees}deg`,
	};
}
