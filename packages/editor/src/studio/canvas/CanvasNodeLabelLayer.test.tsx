// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { VideoCanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";

const { mockCanvasDrawText, pictureInstances, paintInstances, fontInstances } =
	vi.hoisted(() => ({
		mockCanvasDrawText: vi.fn(),
		pictureInstances: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
		paintInstances: [] as Array<{
			setAntiAlias: ReturnType<typeof vi.fn>;
			setColor: ReturnType<typeof vi.fn>;
			setAlphaf: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		}>,
		fontInstances: [] as Array<{
			setLinearMetrics: ReturnType<typeof vi.fn>;
			setSubpixel: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		}>,
	}));

vi.mock("react-skia-lite", () => ({
	ClipOp: {
		Intersect: 1,
	},
	Group: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	Picture: () => null,
	useSharedValue: <T,>(value: T) => {
		const sharedValue = {
			value,
			_isSharedValue: true as const,
			modify: (modifier: (currentValue: T) => T, _forceUpdate?: boolean) => {
				sharedValue.value = modifier(sharedValue.value);
			},
		};
		return sharedValue;
	},
	Skia: {
		Color: (value: string) => value,
		Paint: () => {
			const paint = {
				setAntiAlias: vi.fn(),
				setColor: vi.fn(),
				setAlphaf: vi.fn(),
				dispose: vi.fn(),
			};
			paintInstances.push(paint);
			return paint;
		},
		Font: (_typeface: unknown, size: number) => {
			const font = {
				getGlyphIDs: (text: string) => {
					return Array.from(text).map((segment) => segment.codePointAt(0) ?? 0);
				},
				getGlyphWidths: (glyphIds: number[]) => {
					return glyphIds.map(() => size - 2);
				},
				getMetrics: () => {
					return {
						ascent: -size * 0.8,
						descent: size * 0.2,
						leading: 0,
					};
				},
				setLinearMetrics: vi.fn(),
				setSubpixel: vi.fn(),
				dispose: vi.fn(),
			};
			fontInstances.push(font);
			return font;
		},
		PictureRecorder: () => {
			const canvas = {
				saveLayer: vi.fn(),
				save: vi.fn(),
				clipRect: vi.fn(),
				drawText: mockCanvasDrawText,
				restore: vi.fn(),
			};
			return {
				beginRecording: vi.fn(() => canvas),
				finishRecordingAsPicture: vi.fn(() => {
					const picture = {
						dispose: vi.fn(),
					};
					pictureInstances.push(picture);
					return picture;
				}),
			};
		},
	},
}));

type Listener<T> = (value: T) => void;

const createSharedValue = <T,>(value: T) => {
	const listeners = new Map<number, Listener<T>>();
	const sharedValue = {
		value,
		_isSharedValue: true as const,
		addListener: (listenerId: number, listener: Listener<T>) => {
			listeners.set(listenerId, listener);
		},
		removeListener: (listenerId: number) => {
			listeners.delete(listenerId);
		},
		emit: () => {
			for (const listener of listeners.values()) {
				listener(sharedValue.value);
			}
		},
	};
	return sharedValue;
};

const createVideoNode = (
	patch: Partial<VideoCanvasNode> = {},
): VideoCanvasNode => ({
	id: "node-a",
	type: "video",
	name: "very-long-node-label",
	x: 0,
	y: 0,
	width: 100,
	height: 60,
	zIndex: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: "asset-a",
	...patch,
});

describe("CanvasNodeLabelLayer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		pictureInstances.length = 0;
		paintInstances.length = 0;
		fontInstances.length = 0;
	});

	it("低级 drawText 会保留单行省略号截断", () => {
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={createSharedValue({ x: 0, y: 0, zoom: 1 })}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 40, height: 60 })
				}
				nodes={[createVideoNode({ name: "abcdef" })]}
				focusedNodeId={null}
			/>,
		);

		const lastDrawTextCall = mockCanvasDrawText.mock.calls.at(-1);
		expect(lastDrawTextCall?.[0]).toBe("abc…");
	});

	it("节点屏幕宽度小于 24px 时不会绘制文字", () => {
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={createSharedValue({ x: 0, y: 0, zoom: 1 })}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 20, height: 60 })
				}
				nodes={[createVideoNode({ width: 20 })]}
				focusedNodeId={null}
			/>,
		);

		expect(mockCanvasDrawText).not.toHaveBeenCalled();
	});

	it("picture 在文本替换和卸载时会 dispose", () => {
		const camera = createSharedValue({ x: 0, y: 0, zoom: 1 });
		const getNodeLayout = () =>
			createSharedValue({ x: 0, y: 0, width: 100, height: 60 });
		const { rerender, unmount } = render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={camera}
				getNodeLayout={getNodeLayout}
				nodes={[createVideoNode({ name: "label-v1" })]}
				focusedNodeId={null}
			/>,
		);
		act(() => {
			camera.emit();
		});
		const disposeCallCountBeforeRerender = pictureInstances.reduce(
			(total, picture) => total + picture.dispose.mock.calls.length,
			0,
		);

		rerender(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={camera}
				getNodeLayout={getNodeLayout}
				nodes={[createVideoNode({ name: "label-v2" })]}
				focusedNodeId={null}
			/>,
		);
		act(() => {
			camera.emit();
		});
		const disposeCallCountAfterRerender = pictureInstances.reduce(
			(total, picture) => total + picture.dispose.mock.calls.length,
			0,
		);
		expect(disposeCallCountAfterRerender).toBeGreaterThan(
			disposeCallCountBeforeRerender,
		);

		unmount();
		vi.runAllTimers();
		const disposeCallCountAfterUnmount = pictureInstances.reduce(
			(total, picture) => total + picture.dispose.mock.calls.length,
			0,
		);
		expect(disposeCallCountAfterUnmount).toBeGreaterThan(
			disposeCallCountAfterRerender,
		);
	});
});
