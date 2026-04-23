type DisposeCleanup = () => void;

type DisposableLike = {
	dispose?: (() => void) | undefined;
};

export interface DisposeScope {
	add: (cleanup: DisposeCleanup | null | undefined) => void;
	addDisposable: (target: DisposableLike | null | undefined) => void;
	createChildScope: () => DisposeScope;
	dispose: () => void;
	readonly disposed: boolean;
}

export const createDisposeScope = (): DisposeScope => {
	const cleanups: DisposeCleanup[] = [];
	let disposed = false;

	const runCleanup = (cleanup: DisposeCleanup) => {
		try {
			cleanup();
		} catch (error) {
			// 清理失败仅记录，不阻断其他资源释放。
			console.error("DisposeScope cleanup failed:", error);
		}
	};

	const add = (cleanup: DisposeCleanup | null | undefined) => {
		if (typeof cleanup !== "function") return;
		if (disposed) {
			runCleanup(cleanup);
			return;
		}
		cleanups.push(cleanup);
	};

	const addDisposable = (target: DisposableLike | null | undefined) => {
		const dispose = target?.dispose;
		if (typeof dispose !== "function") return;
		add(() => {
			dispose.call(target);
		});
	};

	const createChildScope = (): DisposeScope => {
		const child = createDisposeScope();
		add(() => child.dispose());
		return child;
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (let index = cleanups.length - 1; index >= 0; index -= 1) {
			runCleanup(cleanups[index]);
		}
		cleanups.length = 0;
	};

	return {
		add,
		addDisposable,
		createChildScope,
		dispose,
		get disposed() {
			return disposed;
		},
	};
};
