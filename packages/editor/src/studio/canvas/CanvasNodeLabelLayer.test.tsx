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
	groupRenderProps,
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
		groupRenderProps: [] as Array<Record<string, unknown>>,
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
	Group: ({
		children,
		...props
	}: { children?: React.ReactNode } & Record<string, unknown>) => {
		groupRenderProps.push(props);
		return <>{children}</>;
	},
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
	useDerivedValue: <T,>(updater: () => T) => {
		return {
			get value() {
				return updater();
			},
			set value(_next: T) {},
			_isSharedValue: true as const,
			modify: (modifier: (currentValue: T) => T, _forceUpdate?: boolean) => {
				void modifier(updater());
			},
		};
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

const resolveSharedTransform = (
	transform: unknown,
): Array<{ translateX?: number; translateY?: number }> => {
	if (Array.isArray(transform)) {
		return transform as Array<{ translateX?: number; translateY?: number }>;
	}
	if (
		transform &&
		typeof transform === "object" &&
		"value" in transform &&
		Array.isArray((transform as { value: unknown }).value)
	) {
		return (
			transform as {
				value: Array<{ translateX?: number; translateY?: number }>;
			}
		).value;
	}
	return [];
};

const resolveLatestLabelPanCompensation = (): { x: number; y: number } => {
	const transform = [...groupRenderProps]
		.reverse()
		.map((props) => props.transform)
		.find((candidate) => candidate !== undefined);
	const operations = resolveSharedTransform(transform);
	let x = 0;
	let y = 0;
	for (const operation of operations) {
		if (Number.isFinite(operation.translateX)) {
			x = Number(operation.translateX);
		}
		if (Number.isFinite(operation.translateY)) {
			y = Number(operation.translateY);
		}
	}
	return { x, y };
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
		groupRenderProps.length = 0;
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
		expect(fontRegistryMock.ensureCoverage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("abcdef"),
			}),
		);
		expect(fontRegistryMock.ensureCoverage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("…"),
			}),
		);
		expect(fontRegistryMock.ensureCoverage).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Hg国"),
			}),
		);
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

	it("pan 发生时会输出非零平移补偿", async () => {
		const camera = createSharedValue({ x: 0, y: 0, zoom: 1 });
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={camera}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 120, height: 60 })
				}
				nodes={[createVideoNode({ name: "pan-compensation" })]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(0);
		});

		act(() => {
			camera.value = { x: 36, y: -18, zoom: 1 };
		});

		const compensation = resolveLatestLabelPanCompensation();
		expect(compensation.x).toBeCloseTo(36, 3);
		expect(compensation.y).toBeCloseTo(-18, 3);
		expect(Math.abs(compensation.x)).toBeGreaterThan(0.001);
		expect(Math.abs(compensation.y)).toBeGreaterThan(0.001);
	});

	it("zoom 变化时平移补偿保持 identity", async () => {
		const camera = createSharedValue({ x: 0, y: 0, zoom: 1 });
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={camera}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 120, height: 60 })
				}
				nodes={[createVideoNode({ name: "zoom-identity" })]}
				focusedNodeId={null}
			/>,
		);
		await waitFor(() => {
			expect(paragraphBuilderStyles.length).toBeGreaterThan(0);
		});

		act(() => {
			camera.value = { x: 36, y: -18, zoom: 1.25 };
		});

		const compensation = resolveLatestLabelPanCompensation();
		expect(compensation.x).toBeCloseTo(0, 6);
		expect(compensation.y).toBeCloseTo(0, 6);
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
