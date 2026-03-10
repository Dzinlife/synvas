import { useEffect, useMemo, useReducer, useRef } from "react";
import {
	enqueueTextRaster,
	resolveTextRasterEntry,
	subscribeTextRaster,
} from "./textRasterStore";
import type { SkiaUiTextRequest, SkiaUiTextSprite } from "./types";

const resolveSpriteSlotKey = (
	request: SkiaUiTextRequest | undefined,
	index: number,
): string => {
	return request?.slotKey?.trim() || `__index__${index}`;
};

export const useSkiaUiTextSprites = (
	requests: SkiaUiTextRequest[],
): SkiaUiTextSprite[] => {
	const [, forceUpdate] = useReducer((value: number) => value + 1, 0);
	const lastReadySpriteBySlotRef = useRef(new Map<string, SkiaUiTextSprite>());
	const slotKeys = useMemo(() => {
		return requests.map((request, index) => {
			return resolveSpriteSlotKey(request, index);
		});
	}, [requests]);

	const sprites = requests.map((request) => {
		const entry = resolveTextRasterEntry(request);
		return {
			cacheKey: entry.cacheKey,
			text: entry.text,
			image: entry.image,
			textWidth: entry.textWidth,
			textHeight: entry.textHeight,
			ready: entry.ready,
		};
	});
	const displaySprites = useMemo(() => {
		return sprites.map((sprite, index) => {
			if (sprite.ready || sprite.image) {
				return sprite;
			}
			const slotKey = slotKeys[index];
			const lastReadySprite = lastReadySpriteBySlotRef.current.get(slotKey);
			if (!lastReadySprite?.image) {
				return sprite;
			}
			return {
				cacheKey: sprite.cacheKey,
				text: sprite.text,
				image: lastReadySprite.image,
				textWidth: lastReadySprite.textWidth,
				textHeight: lastReadySprite.textHeight,
				ready: sprite.ready,
			};
		});
	}, [slotKeys, sprites]);
	const signatures = useMemo(() => {
		const cacheKeys = new Set<string>();
		for (const sprite of sprites) {
			cacheKeys.add(sprite.cacheKey);
		}
		for (let index = 0; index < sprites.length; index += 1) {
			const sprite = sprites[index];
			if (sprite?.ready || sprite?.image) continue;
			const slotKey = slotKeys[index];
			const lastReadySprite = lastReadySpriteBySlotRef.current.get(slotKey);
			if (lastReadySprite?.image) {
				cacheKeys.add(lastReadySprite.cacheKey);
			}
		}
		return [...cacheKeys];
	}, [slotKeys, sprites]);

	useEffect(() => {
		if (signatures.length === 0) {
			return;
		}
		let disposed = false;
		const unsubs = signatures.map((signature) =>
			subscribeTextRaster(signature, () => {
				forceUpdate();
			}),
		);
		for (let index = 0; index < requests.length; index += 1) {
			const request = requests[index];
			const sprite = sprites[index];
			if (!request || !sprite || sprite.ready) continue;
			void enqueueTextRaster(sprite.cacheKey, request)
				.then(() => {
					if (!disposed) {
						forceUpdate();
					}
				})
				.catch(() => {});
		}
		return () => {
			disposed = true;
			for (const unsub of unsubs) {
				unsub();
			}
		};
	}, [requests, signatures, sprites]);

	useEffect(() => {
		const activeSlotKeys = new Set<string>();
		for (let index = 0; index < sprites.length; index += 1) {
			const sprite = sprites[index];
			const slotKey = slotKeys[index];
			activeSlotKeys.add(slotKey);
			if (sprite?.ready && sprite.image) {
				lastReadySpriteBySlotRef.current.set(slotKey, sprite);
				continue;
			}
			if (sprite?.ready && !sprite.text) {
				lastReadySpriteBySlotRef.current.delete(slotKey);
			}
		}
		for (const slotKey of [...lastReadySpriteBySlotRef.current.keys()]) {
			if (!activeSlotKeys.has(slotKey)) {
				lastReadySpriteBySlotRef.current.delete(slotKey);
			}
		}
	}, [slotKeys, sprites]);

	return displaySprites;
};
