import { createDisposeScope } from "core/editor/preview/disposeScope";
import { describe, expect, it, vi } from "vitest";

describe("disposeScope", () => {
	it("dispose 幂等：重复调用只执行一次", () => {
		const scope = createDisposeScope();
		const cleanup = vi.fn();
		scope.add(cleanup);

		scope.dispose();
		scope.dispose();

		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("按 LIFO 顺序释放", () => {
		const scope = createDisposeScope();
		const order: string[] = [];
		scope.add(() => {
			order.push("first");
		});
		scope.add(() => {
			order.push("second");
		});
		scope.add(() => {
			order.push("third");
		});

		scope.dispose();

		expect(order).toEqual(["third", "second", "first"]);
	});

	it("父 scope dispose 时会级联释放 child scope", () => {
		const scope = createDisposeScope();
		const child = scope.createChildScope();
		const parentCleanup = vi.fn();
		const childCleanup = vi.fn();
		scope.add(parentCleanup);
		child.add(childCleanup);

		scope.dispose();

		expect(childCleanup).toHaveBeenCalledTimes(1);
		expect(parentCleanup).toHaveBeenCalledTimes(1);
	});

	it("单项 cleanup 抛错不应阻断后续释放", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const scope = createDisposeScope();
		const tailCleanup = vi.fn();
		scope.add(() => {
			throw new Error("cleanup failed");
		});
		scope.add(tailCleanup);

		scope.dispose();

		expect(tailCleanup).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
