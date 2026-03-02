import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetAudioOwnerForTests,
	getOwner,
	releaseOwner,
	requestOwner,
	subscribeOwnerChange,
} from "./owner";

afterEach(() => {
	__resetAudioOwnerForTests();
});

describe("audio owner coordinator", () => {
	it("requestOwner 会更新当前 owner 并返回上一个 owner", () => {
		expect(getOwner()).toBeNull();
		expect(requestOwner("scene:scene-1")).toBeNull();
		expect(getOwner()).toBe("scene:scene-1");
		expect(requestOwner("scene:scene-2")).toBe("scene:scene-1");
		expect(getOwner()).toBe("scene:scene-2");
	});

	it("重复 requestOwner 相同 owner 时不触发变更", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeOwnerChange(listener);
		expect(requestOwner("scene:scene-1")).toBeNull();
		expect(requestOwner("scene:scene-1")).toBe("scene:scene-1");
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("releaseOwner 仅在 owner 匹配时清空", () => {
		requestOwner("scene:scene-1");
		expect(releaseOwner("scene:scene-2")).toBe(false);
		expect(getOwner()).toBe("scene:scene-1");
		expect(releaseOwner("scene:scene-1")).toBe(true);
		expect(getOwner()).toBeNull();
	});

	it("subscribeOwnerChange 会按顺序收到 owner 变更", () => {
		const changes: Array<{ previousOwner: string | null; nextOwner: string | null }> =
			[];
		const unsubscribe = subscribeOwnerChange((change) => {
			changes.push(change);
		});
		requestOwner("scene:scene-1");
		requestOwner("scene:scene-2");
		releaseOwner("scene:scene-2");
		unsubscribe();
		expect(changes).toEqual([
			{ previousOwner: null, nextOwner: "scene:scene-1" },
			{ previousOwner: "scene:scene-1", nextOwner: "scene:scene-2" },
			{ previousOwner: "scene:scene-2", nextOwner: null },
		]);
	});
});
