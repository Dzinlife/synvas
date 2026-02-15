// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "../contexts/TimelineContext";
import AgentCliPanel from "./AgentCliPanel";

const createElement = (id: string, start: number, end: number): TimelineElement => ({
	id,
	type: "VideoClip",
	component: "video-clip",
	name: id,
	timeline: {
		start,
		end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:03:00",
		trackIndex: 0,
		trackId: "main-track",
	},
	props: {},
});

const initialState = useTimelineStore.getState();

afterEach(() => {
	useTimelineStore.setState(initialState, true);
});

describe("AgentCliPanel", () => {
	it("支持计划->dry-run->确认->应用流程", () => {
		useTimelineStore.setState({
			elements: [createElement("clip-1", 0, 30)],
			tracks: [
				{
					id: "main-track",
					role: "clip",
					hidden: false,
					locked: false,
					muted: false,
					solo: false,
				},
			],
			historyPast: [],
			historyFuture: [],
		});

		render(<AgentCliPanel />);

		const input = screen.getByLabelText("命令输入（每行一条）");
		fireEvent.change(input, {
			target: {
				value: "timeline.element.remove --ids clip-1",
			},
		});

		fireEvent.click(screen.getByRole("button", { name: "生成计划" }));
		expect(screen.getByText(/计划已生成/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Dry Run" }));
		expect(screen.getByText(/Dry-run 成功/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "确认计划" }));
		expect(screen.getByText(/计划已确认/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "应用计划" }));
		expect(screen.getByText(/执行完成/)).toBeTruthy();
		expect(useTimelineStore.getState().elements).toHaveLength(0);
	});
});
