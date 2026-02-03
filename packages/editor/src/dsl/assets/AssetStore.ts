export type AssetKind = "video" | "image" | "font";

export type AssetHandle<T> = {
	asset: T;
	release: () => void;
};

type AssetEntry<T> = {
	kind: AssetKind;
	key: string;
	refCount: number;
	value?: T;
	promise?: Promise<T>;
	dispose?: (value: T) => void;
	releaseWhenReady?: boolean;
};

class AssetStore {
	private entries = new Map<string, AssetEntry<unknown>>();

	async acquire<T>(
		kind: AssetKind,
		key: string,
		create: () => Promise<T>,
		dispose?: (value: T) => void,
	): Promise<AssetHandle<T>> {
		const id = this.getId(kind, key);
		let entry = this.entries.get(id) as AssetEntry<T> | undefined;

		if (!entry) {
			entry = { kind, key, refCount: 0 };
			this.entries.set(id, entry);
		}

		entry.refCount += 1;
		entry.releaseWhenReady = false;
		if (dispose && !entry.dispose) {
			entry.dispose = dispose;
		}

		try {
			if (!entry.value) {
				if (!entry.promise) {
					entry.promise = (async () => {
						const value = await create();
						entry.value = value;
						return value;
					})().finally(() => {
						entry.promise = undefined;
					});
				}

				const value = await entry.promise;
				if (entry.releaseWhenReady && entry.refCount === 0) {
					this.disposeEntry(id, entry);
				}

				return {
					asset: value,
					release: () => this.release(kind, key),
				};
			}

			return {
				asset: entry.value,
				release: () => this.release(kind, key),
			};
		} catch (error) {
			entry.refCount = Math.max(0, entry.refCount - 1);
			entry.promise = undefined;
			if (entry.refCount === 0 && !entry.value) {
				this.entries.delete(id);
			}
			throw error;
		}
	}

	private release(kind: AssetKind, key: string) {
		const id = this.getId(kind, key);
		const entry = this.entries.get(id) as AssetEntry<unknown> | undefined;

		if (!entry) return;

		entry.refCount = Math.max(0, entry.refCount - 1);
		if (entry.refCount > 0) return;

		if (entry.value) {
			this.disposeEntry(id, entry);
			return;
		}

		if (entry.promise) {
			entry.releaseWhenReady = true;
			return;
		}

		this.entries.delete(id);
	}

	private disposeEntry(id: string, entry: AssetEntry<unknown>) {
		try {
			entry.dispose?.(entry.value);
		} finally {
			this.entries.delete(id);
		}
	}

	private getId(kind: AssetKind, key: string) {
		return `${kind}:${key}`;
	}
}

export const assetStore = new AssetStore();
