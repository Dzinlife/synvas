import type { CommandDescriptor } from "./types";

const COMMANDS: CommandDescriptor[] = [
	{
		id: "timeline.element.add",
		summary: "向时间线添加一个元素",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				element: {
					type: "object",
					description: "完整的 TimelineElement JSON",
					required: true,
				},
			},
			required: ["element"],
		},
		examples: [
			`timeline.element.add --element '{"id":"clip-1","type":"VideoClip","component":"video-clip","name":"Clip 1","timeline":{"start":0,"end":90,"startTimecode":"00:00:00:00","endTimecode":"00:00:03:00","trackIndex":0},"props":{"uri":"opfs://video.mp4"}}'`,
		],
		requiresShell: false,
	},
	{
		id: "timeline.element.remove",
		summary: "删除一个或多个元素",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					description: "元素 id 列表，支持逗号分隔字符串",
					required: true,
				},
			},
			required: ["ids"],
		},
		examples: ["timeline.element.remove --ids clip-1,clip-2"],
		requiresShell: false,
	},
	{
		id: "timeline.element.move",
		summary: "移动元素位置（保持时长）",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "元素 id", required: true },
				start: { type: "number", description: "目标开始帧（与 delta 二选一）" },
				delta: {
					type: "number",
					description: "相对位移帧数（与 start 二选一）",
				},
				trackIndex: {
					type: "number",
					description: "目标轨道索引（可选）",
				},
			},
			required: ["id"],
		},
		examples: [
			"timeline.element.move --id clip-1 --start 120 --track-index 1",
			"timeline.element.move --id clip-1 --delta -30",
		],
		requiresShell: false,
	},
	{
		id: "timeline.element.trim",
		summary: "裁剪元素时间范围",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "元素 id", required: true },
				start: { type: "number", description: "新的开始帧（可选）" },
				end: { type: "number", description: "新的结束帧（可选）" },
			},
			required: ["id"],
		},
		examples: ["timeline.element.trim --id clip-1 --start 10 --end 80"],
		requiresShell: false,
	},
	{
		id: "timeline.element.split",
		summary: "在指定帧切分元素",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "元素 id", required: true },
				frame: { type: "number", description: "切分帧", required: true },
				newId: { type: "string", description: "右半部分新 id（可选）" },
			},
			required: ["id", "frame"],
		},
		examples: ["timeline.element.split --id clip-1 --frame 150"],
		requiresShell: false,
	},
	{
		id: "timeline.element.quick-split",
		summary: "按画面变化强度自动分割视频片段",
		mode: "runtime",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "目标 VideoClip id", required: true },
				sensitivity: {
					type: "number",
					description: "变化强度阈值（0-100，可选，默认 55）",
				},
				minSegmentSeconds: {
					type: "number",
					description: "最短片段时长（秒，可选，默认 0.8）",
				},
				mode: {
					type: "string",
					description: "分析速度（fast|balanced|fine，可选，默认 balanced）",
				},
			},
			required: ["id"],
		},
		examples: [
			"timeline.element.quick-split --id clip-1",
			"timeline.element.quick-split --id clip-1 --sensitivity 70 --min-segment-seconds 0.6 --mode fine",
		],
		requiresShell: false,
	},
	{
		id: "timeline.track.set-flag",
		summary: "设置轨道或音轨开关状态",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				trackId: {
					type: "string",
					description: "轨道 id（与 trackIndex 二选一）",
				},
				trackIndex: {
					type: "number",
					description: "轨道索引（支持负值音轨）",
				},
				flag: {
					type: "string",
					description: "hidden|locked|muted|solo",
					required: true,
				},
				value: {
					type: "boolean",
					description: "目标值",
					required: true,
				},
			},
			required: ["flag", "value"],
		},
		examples: [
			"timeline.track.set-flag --track-id main-track --flag muted --value true",
			"timeline.track.set-flag --track-index -1 --flag solo --value true",
		],
		requiresShell: false,
	},
	{
		id: "timeline.seek",
		summary: "移动播放头",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				time: {
					type: "number",
					description: "目标帧",
					required: true,
				},
			},
			required: ["time"],
		},
		examples: ["timeline.seek --time 180"],
		requiresShell: false,
	},
	{
		id: "timeline.undo",
		summary: "撤销一次",
		mode: "state",
		schema: {
			type: "object",
			properties: {},
		},
		examples: ["timeline.undo"],
		requiresShell: false,
	},
	{
		id: "timeline.redo",
		summary: "重做一次",
		mode: "state",
		schema: {
			type: "object",
			properties: {},
		},
		examples: ["timeline.redo"],
		requiresShell: false,
	},
	{
		id: "help",
		summary: "查看命令帮助",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "命令 id（可选）" },
			},
		},
		examples: ["help", "help --id timeline.element.move"],
		requiresShell: false,
	},
	{
		id: "schema",
		summary: "查看命令 schema",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "命令 id",
					required: true,
				},
			},
			required: ["id"],
		},
		examples: ["schema --id timeline.element.move"],
		requiresShell: false,
	},
	{
		id: "examples",
		summary: "查看命令示例",
		mode: "state",
		schema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "命令 id",
					required: true,
				},
			},
			required: ["id"],
		},
		examples: ["examples --id timeline.track.set-flag"],
		requiresShell: false,
	},
];

const COMMAND_BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));

export const listCommands = (): CommandDescriptor[] => {
	return [...COMMANDS];
};

export const getCommandDescriptor = (
	id: string,
): CommandDescriptor | undefined => {
	return COMMAND_BY_ID.get(id);
};

export const isKnownCommand = (id: string): boolean => {
	return COMMAND_BY_ID.has(id);
};
