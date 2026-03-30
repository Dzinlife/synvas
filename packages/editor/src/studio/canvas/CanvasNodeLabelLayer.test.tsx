// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { VideoCanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";

const {
	paragraphBuilderStyles,
	paragraphRunStyles,
	paragraphInstances,
	pictureInstances,
	paintInstances,
	fontRegistryMock,
} = vi.hoisted(() => {
	type ParagraphInstance = {
		text: string;
		layout: ReturnType<typeof vi.fn>;
		getHeight: ReturnType<typeof vi.fn>;
		paint: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
	const listeners = new Set<() => void>();
	return {
		paragraphBuilderStyles: [] as Array<{
			maxLines?: number;
			ellipsis?: string;
		}>,
		paragraphRunStyles: [] as Array<{
			fontFamilies?: string[];
		}>,
		paragraphInstances: [] as ParagraphInstance[],
		pictureInstances: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
		paintInstances: [] as Array<{
			setAntiAlias: ReturnType<typeof vi.fn>;
			setAlphaf: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		}>,
		fontRegistryMock: {
			getFontProvider: vi.fn().mockResolvedValue({ id: "provider" }),
			ensureCoverage: vi.fn().mockResolvedValue(undefined),
			getParagraphRunPlan: vi.fn((text: string) => {
				if (!text) return [];
				return [
					{
						text,
						fontFamilies: ["Noto Sans SC"],
						status: "primary" as const,
					},
				];
			}),
			subscribe: vi.fn((listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}),
			emitRevision: () => {
				for (const listener of [...listeners]) {
					listener();
				}
			},
			reset: () => {
				listeners.clear();
			},
		},
	};
});

vi.mock("@/typography/fontRegistry", () => ({
	FONT_REGISTRY_PRIMARY_FAMILY: "Noto Sans SC",
	fontRegistry: {
		getFontProvider: fontRegistryMock.getFontProvider,
		ensureCoverage: fontRegistryMock.ensureCoverage,
		getParagraphRunPlan: fontRegistryMock.getParagraphRunPlan,
		subscribe: fontRegistryMock.subscribe,
	},
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
				setAlphaf: vi.fn(),
				dispose: vi.fn(),
			};
			paintInstances.push(paint);
			return paint;
		},
		ParagraphBuilder: {
			Make: (
				style: { maxLines?: number; ellipsis?: string },
				_provider?: unknown,
			) => {
				paragraphBuilderStyles.push(style);
				let paragraphText = "";
				const builder = {
					pushStyle: vi.fn((style: { fontFamilies?: string[] }) => {
						paragraphRunStyles.push(style);
						return builder;
					}),
					addText: vi.fn((text: string) => {
						paragraphText += text;
						return builder;
					}),
					pop: vi.fn(() => builder),
					build: vi.fn(() => {
						const paragraph = {
							text: paragraphText,
							layout: vi.fn(),
							getHeight: vi.fn(() => 12),
							paint: vi.fn(),
							dispose: vi.fn(),
						};
						paragraphInstances.push(paragraph);
						return paragraph;
					}),
					dispose: vi.fn(),
				};
				return builder;
			},
		},
		PictureRecorder: () => {
			const canvas = {
				saveLayer: vi.fn(),
				save: vi.fn(),
				clipRect: vi.fn(),
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
		paragraphBuilderStyles.length = 0;
		paragraphRunStyles.length = 0;
		paragraphInstances.length = 0;
		pictureInstances.length = 0;
		paintInstances.length = 0;
		fontRegistryMock.reset();
	});

	it("会以单行省略号配置构建 paragraph", async () => {
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
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(0);
		});

		const lastStyle = paragraphBuilderStyles.at(-1);
		expect(lastStyle?.maxLines).toBe(1);
		expect(lastStyle?.ellipsis).toBe("…");
		expect(fontRegistryMock.ensureCoverage).toHaveBeenCalledWith({
			text: "abcdef…",
		});
		expect(
			paragraphInstances.some(
				(paragraph) => paragraph.paint.mock.calls.length > 0,
			),
		).toBe(true);
	});

	it("会给正文 run 合并省略号字体链", async () => {
		fontRegistryMock.getParagraphRunPlan.mockImplementation((text: string) => {
			if (text === "…") {
				return [
					{
						text,
						fontFamilies: ["Noto Sans SC__ellipsis"],
						status: "primary" as const,
					},
				];
			}
			if (!text) return [];
			return [
				{
					text,
					fontFamilies: ["Noto Sans SC__label"],
					status: "primary" as const,
				},
			];
		});

		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={createSharedValue({ x: 0, y: 0, zoom: 1 })}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 80, height: 60 })
				}
				nodes={[createVideoNode({ name: "abc" })]}
				focusedNodeId={null}
			/>,
		);

		await waitFor(() => {
			expect(paragraphRunStyles.length).toBeGreaterThan(0);
		});
		expect(
			paragraphRunStyles.some((style) => {
				return (
					style.fontFamilies?.includes("Noto Sans SC__label") &&
					style.fontFamilies?.includes("Noto Sans SC__ellipsis")
				);
			}),
		).toBe(true);
	});

	it("节点屏幕宽度小于 24px 时不会绘制文字", async () => {
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
		await waitFor(() => {
			expect(fontRegistryMock.getFontProvider).toHaveBeenCalled();
		});

		expect(
			paragraphInstances.every(
				(paragraph) => paragraph.paint.mock.calls.length === 0,
			),
		).toBe(true);
	});

	it("picture 和 paragraph 在文本替换与卸载时会 dispose", async () => {
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
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(0);
		});
		act(() => {
			camera.emit();
		});
		const paragraphDisposeBefore = paragraphInstances.reduce(
			(total, paragraph) => {
				return total + paragraph.dispose.mock.calls.length;
			},
			0,
		);
		const pictureDisposeBefore = pictureInstances.reduce((total, picture) => {
			return total + picture.dispose.mock.calls.length;
		}, 0);

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
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(1);
		});
		const paragraphDisposeAfterRerender = paragraphInstances.reduce(
			(total, paragraph) => {
				return total + paragraph.dispose.mock.calls.length;
			},
			0,
		);
		const pictureDisposeAfterRerender = pictureInstances.reduce(
			(total, picture) => {
				return total + picture.dispose.mock.calls.length;
			},
			0,
		);
		expect(paragraphDisposeAfterRerender).toBeGreaterThan(
			paragraphDisposeBefore,
		);
		expect(pictureDisposeAfterRerender).toBeGreaterThan(pictureDisposeBefore);

		unmount();
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
		const paragraphDisposeAfterUnmount = paragraphInstances.reduce(
			(total, paragraph) => {
				return total + paragraph.dispose.mock.calls.length;
			},
			0,
		);
		const pictureDisposeAfterUnmount = pictureInstances.reduce(
			(total, picture) => {
				return total + picture.dispose.mock.calls.length;
			},
			0,
		);
		expect(paragraphDisposeAfterUnmount).toBeGreaterThan(
			paragraphDisposeAfterRerender,
		);
		expect(pictureDisposeAfterUnmount).toBeGreaterThan(
			pictureDisposeAfterRerender,
		);
	});

	it("font registry revision 会触发重建", async () => {
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={createSharedValue({ x: 0, y: 0, zoom: 1 })}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 100, height: 60 })
				}
				nodes={[createVideoNode({ name: "label-v1" })]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(0);
		});
		const buildCountBefore = paragraphBuilderStyles.length;

		act(() => {
			fontRegistryMock.emitRevision();
		});
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(buildCountBefore);
		});
	});
});
