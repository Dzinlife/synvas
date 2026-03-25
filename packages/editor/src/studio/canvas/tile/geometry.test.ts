import { describe, expect, it } from "vitest";
import { decodeTileKey, encodeTileKey } from "./geometry";

describe("tile geometry", () => {
	it("远离原点时 tile key 仍可逆", () => {
		const key = encodeTileKey({
			lod: -3,
			tx: 8123,
			ty: -6421,
		});
		expect(decodeTileKey(key)).toEqual({
			lod: -3,
			tx: 8123,
			ty: -6421,
		});
	});

	it("不同 tile 坐标不会产生 key 冲突", () => {
		const first = encodeTileKey({
			lod: 0,
			tx: -12000,
			ty: 24500,
		});
		const second = encodeTileKey({
			lod: 1,
			tx: 12000,
			ty: -24500,
		});
		expect(first).not.toBe(second);
	});

	it("同坐标下不同 lod 不会冲突且可逆", () => {
		const coarse = encodeTileKey({
			lod: -6,
			tx: 5,
			ty: -7,
		});
		const fine = encodeTileKey({
			lod: 2,
			tx: 5,
			ty: -7,
		});
		expect(coarse).not.toBe(fine);
		expect(decodeTileKey(coarse)).toEqual({
			lod: -6,
			tx: 5,
			ty: -7,
		});
		expect(decodeTileKey(fine)).toEqual({
			lod: 2,
			tx: 5,
			ty: -7,
		});
	});
});
