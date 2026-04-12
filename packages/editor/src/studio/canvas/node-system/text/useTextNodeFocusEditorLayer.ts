import type { TextCanvasNode } from "core/studio/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	SkiaPointerEvent,
	SkParagraph,
	SkTypefaceFontProvider,
} from "react-skia-lite";
import { useProjectStore } from "@/projects/projectStore";
import { resolveCanvasNodeLayoutScreenFrame } from "@/studio/canvas/canvasNodeLabelUtils";
import type { CameraState } from "@/studio/canvas/canvasWorkspaceUtils";
import {
	createTextEditingSession,
	resolveTextEditingDecorations,
	resolveTextEditingIndexAtScreenPoint,
	resolveTextEditingOverlayRect,
	resolveTextEditingSelectionFromAnchor,
	type TextEditingSelection,
	type TextEditingSession,
	type TextEditingTarget,
	updateTextEditingSessionComposition,
	updateTextEditingSessionDraft,
	updateTextEditingSessionSelection,
	updateTextEditingSessionTarget,
} from "@/studio/canvas/text-editing";
import { useStudioHistoryStore } from "@/studio/history/studioHistoryStore";
import { fontRegistry } from "@/typography/fontRegistry";
import { buildTextNodeParagraph, disposeTextNodeParagraph } from "./paragraph";
import type {
	TextNodeFocusFrame,
	TextNodeFocusRect,
	TextNodeFocusSkiaLayerProps,
	TextNodeTextEditingDecorations,
} from "./TextNodeFocusSkiaLayer";

interface UseTextNodeFocusEditorLayerOptions {
	width: number;
	height: number;
	camera: CameraState;
	focusedNode: TextCanvasNode | null;
	suspendHover?: boolean;
}

export interface TextNodeFocusTextEditingBridgeState {
	sessionId: string;
	value: string;
	selection: TextEditingSelection;
	isComposing: boolean;
	isActive: boolean;
	canUndo: boolean;
	canRedo: boolean;
	overlayRectScreen: TextNodeFocusRect;
	onValueChange: (value: string, selection: TextEditingSelection) => void;
	onSelectionChange: (selection: TextEditingSelection) => void;
	onCompositionStart: (selection: TextEditingSelection) => void;
	onCompositionUpdate: (selection: TextEditingSelection, data: string) => void;
	onCompositionEnd: (selection: TextEditingSelection, data: string) => void;
	onUndo: () => void;
	onRedo: () => void;
	onCommit: () => void;
	onCancel: () => void;
	onBlur: () => void;
}

export interface TextNodeFocusEditorLayerResult {
	enabled: boolean;
	layerProps: TextNodeFocusSkiaLayerProps | null;
	bridgeProps: TextNodeFocusTextEditingBridgeState | null;
}

const cloneTextNodeSnapshot = (node: TextCanvasNode): TextCanvasNode => {
	if (typeof structuredClone === "function") {
		return structuredClone(node);
	}
	return JSON.parse(JSON.stringify(node)) as TextCanvasNode;
};

const isTextNodeSnapshotEqual = (
	left: TextCanvasNode,
	right: TextCanvasNode,
): boolean => {
	return (
		left.id === right.id &&
		left.type === right.type &&
		left.name === right.name &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height &&
		left.siblingOrder === right.siblingOrder &&
		left.locked === right.locked &&
		left.hidden === right.hidden &&
		left.text === right.text &&
		left.fontSize === right.fontSize &&
		JSON.stringify(left.thumbnail ?? null) ===
			JSON.stringify(right.thumbnail ?? null)
	);
};

const isPointInRect = (
	point: { x: number; y: number },
	rect: TextNodeFocusRect,
) => {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
};

const isTextEditingTargetEqual = (
	left: TextEditingTarget,
	right: TextEditingTarget,
): boolean => {
	return (
		left.id === right.id &&
		left.text === right.text &&
		left.paragraph === right.paragraph &&
		left.frame.cx === right.frame.cx &&
		left.frame.cy === right.frame.cy &&
		left.frame.width === right.frame.width &&
		left.frame.height === right.frame.height &&
		left.frame.rotationRad === right.frame.rotationRad &&
		left.baseSize.width === right.baseSize.width &&
		left.baseSize.height === right.baseSize.height
	);
};

const toFocusFrame = (rect: TextNodeFocusRect): TextNodeFocusFrame => {
	return {
		cx: rect.x + rect.width / 2,
		cy: rect.y + rect.height / 2,
		width: rect.width,
		height: rect.height,
		rotationRad: 0,
	};
};

const resolvePrimaryButton = (event: SkiaPointerEvent): boolean => {
	const buttons = (event as unknown as { buttons?: number }).buttons ?? 0;
	return (buttons & 1) === 1;
};

export const useTextNodeFocusEditorLayer = ({
	width,
	height,
	camera,
	focusedNode,
	suspendHover = false,
}: UseTextNodeFocusEditorLayerOptions): TextNodeFocusEditorLayerResult => {
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const [fontProvider, setFontProvider] =
		useState<SkTypefaceFontProvider | null>(null);
	const [fontRevision, setFontRevision] = useState(0);
	const [sessionState, setSessionState] = useState<TextEditingSession | null>(
		null,
	);
	const [isEditing, setIsEditing] = useState(false);

	const sessionRef = useRef<TextEditingSession | null>(null);
	const pointerSelectingRef = useRef(false);
	const selectionAnchorRef = useRef<number | null>(null);

	useEffect(() => {
		sessionRef.current = sessionState;
	}, [sessionState]);

	useEffect(() => {
		let disposed = false;
		void fontRegistry
			.getFontProvider()
			.then((provider) => {
				if (disposed) return;
				setFontProvider(provider);
			})
			.catch((error) => {
				console.warn("[TextNodeFocus] Failed to init font provider:", error);
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		const unsubscribe = fontRegistry.subscribe(() => {
			setFontRevision((previous) => previous + 1);
			void fontRegistry
				.getFontProvider()
				.then((provider) => {
					setFontProvider(provider);
				})
				.catch((error) => {
					console.warn(
						"[TextNodeFocus] Failed to refresh font provider:",
						error,
					);
				});
		});
		return () => {
			unsubscribe();
		};
	}, []);

	const frameScreen = useMemo<TextNodeFocusRect | null>(() => {
		if (!focusedNode) return null;
		const frame = resolveCanvasNodeLayoutScreenFrame(focusedNode, camera);
		return {
			x: frame.x,
			y: frame.y,
			width: frame.width,
			height: frame.height,
		};
	}, [camera, focusedNode]);
	const focusedNodeId = focusedNode?.id ?? null;

	const draftText = sessionState?.draftText ?? focusedNode?.text ?? "";

	useEffect(() => {
		void fontRevision;
		if (!draftText) return;
		void fontRegistry.ensureCoverage({ text: draftText }).catch((error) => {
			console.warn("[TextNodeFocus] Failed to ensure font coverage:", error);
		});
	}, [draftText, fontRevision]);

	const paragraph = useMemo<SkParagraph | null>(() => {
		void fontRevision;
		if (!focusedNode) return null;
		const built = buildTextNodeParagraph({
			text: draftText,
			fontSize: focusedNode.fontSize,
			fontProvider,
		});
		if (!built) return null;
		try {
			built.layout(Math.max(1, Math.abs(focusedNode.width)));
		} catch (error) {
			console.warn("[TextNodeFocus] Failed to layout paragraph:", error);
		}
		return built;
	}, [draftText, focusedNode, fontProvider, fontRevision]);

	useEffect(() => {
		return () => {
			disposeTextNodeParagraph(paragraph);
		};
	}, [paragraph]);

	const textEditingTarget = useMemo<TextEditingTarget | null>(() => {
		if (!focusedNode || !frameScreen || !paragraph) return null;
		const baseWidth = Math.max(1, Math.abs(focusedNode.width));
		const baseHeight = Math.max(1, Math.abs(focusedNode.height));
		return {
			id: focusedNode.id,
			text: draftText,
			paragraph,
			frame: toFocusFrame(frameScreen),
			baseSize: {
				width: baseWidth,
				height: baseHeight,
			},
		};
	}, [draftText, focusedNode, frameScreen, paragraph]);

	const applyDraftToNode = useCallback(
		(nodeId: string, nextText: string) => {
			updateCanvasNode(nodeId, {
				text: nextText,
			} as never);
		},
		[updateCanvasNode],
	);

	useEffect(() => {
		if (!focusedNode || !textEditingTarget) {
			setSessionState(null);
			setIsEditing(false);
			pointerSelectingRef.current = false;
			selectionAnchorRef.current = null;
			return;
		}
		setSessionState((previousSession) => {
			if (!previousSession || previousSession.target.id !== focusedNode.id) {
				selectionAnchorRef.current = textEditingTarget.text.length;
				return createTextEditingSession({
					target: textEditingTarget,
				});
			}
			if (isTextEditingTargetEqual(previousSession.target, textEditingTarget)) {
				return previousSession;
			}
			return updateTextEditingSessionTarget(previousSession, textEditingTarget);
		});
		setIsEditing(true);
	}, [focusedNode, textEditingTarget]);

	useEffect(() => {
		if (!focusedNodeId) {
			setSessionState(null);
			setIsEditing(false);
			return;
		}
		const currentProject = useProjectStore.getState().currentProject;
		const currentNode = currentProject?.canvas.nodes.find(
			(node) => node.id === focusedNodeId,
		);
		if (!currentNode || currentNode.type !== "text") {
			setSessionState(null);
			setIsEditing(false);
			return;
		}
		const beforeSnapshot = cloneTextNodeSnapshot(currentNode);
		setIsEditing(true);
		return () => {
			pointerSelectingRef.current = false;
			selectionAnchorRef.current = null;
			const latestProject = useProjectStore.getState().currentProject;
			const latestNode = latestProject?.canvas.nodes.find(
				(node) => node.id === beforeSnapshot.id,
			);
			if (!latestNode || latestNode.type !== "text") return;
			const afterSnapshot = cloneTextNodeSnapshot(latestNode);
			if (isTextNodeSnapshotEqual(beforeSnapshot, afterSnapshot)) return;
			pushHistory({
				kind: "canvas.node-update",
				nodeId: beforeSnapshot.id,
				before: beforeSnapshot,
				after: afterSnapshot,
				focusNodeId: latestProject?.ui.focusedNodeId ?? null,
			});
		};
	}, [focusedNodeId, pushHistory]);

	const beginPointerSelection = useCallback(
		(screenPoint: { x: number; y: number }, extendSelection: boolean) => {
			const currentSession = sessionRef.current;
			if (!currentSession) return;
			const focusIndex = resolveTextEditingIndexAtScreenPoint(
				currentSession,
				screenPoint,
			);
			const anchorIndex = extendSelection
				? (selectionAnchorRef.current ?? currentSession.selection.start)
				: focusIndex;
			const nextSelection = extendSelection
				? resolveTextEditingSelectionFromAnchor(anchorIndex, focusIndex)
				: {
						start: focusIndex,
						end: focusIndex,
						direction: "none" as const,
					};
			selectionAnchorRef.current = anchorIndex;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionSelection(
					previousSession,
					nextSelection,
				);
			});
		},
		[],
	);

	const handleValueChange = useCallback(
		(value: string, selection: TextEditingSelection) => {
			const currentSession = sessionRef.current;
			if (!currentSession) return;
			selectionAnchorRef.current = selection.end;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionDraft(previousSession, {
					draftText: value,
					selection,
				});
			});
			applyDraftToNode(currentSession.target.id, value);
		},
		[applyDraftToNode],
	);

	const handleSelectionChange = useCallback(
		(selection: TextEditingSelection) => {
			selectionAnchorRef.current = selection.end;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionSelection(previousSession, selection);
			});
		},
		[],
	);

	const handleCompositionStart = useCallback(
		(selection: TextEditingSelection) => {
			selectionAnchorRef.current = selection.end;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, selection);
			});
		},
		[],
	);

	const handleCompositionUpdate = useCallback(
		(selection: TextEditingSelection, _data?: string) => {
			selectionAnchorRef.current = selection.end;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, selection);
			});
		},
		[],
	);

	const handleCompositionEnd = useCallback(
		(selection: TextEditingSelection, _data?: string) => {
			selectionAnchorRef.current = selection.end;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				const withSelection = updateTextEditingSessionSelection(
					previousSession,
					selection,
				);
				return updateTextEditingSessionComposition(withSelection, null);
			});
		},
		[],
	);

	const handleLayerPointerDown = useCallback(
		(event: SkiaPointerEvent) => {
			if (suspendHover) return;
			const currentSession = sessionRef.current;
			if (!currentSession || !frameScreen) return;
			const button = (event as unknown as { button?: number }).button ?? 0;
			if (button !== 0) return;
			const screenPoint = { x: event.x, y: event.y };
			const isInside = isPointInRect(screenPoint, frameScreen);
			if (!isInside) {
				pointerSelectingRef.current = false;
				if (isEditing) {
					setIsEditing(false);
				}
				return;
			}
			if (!isEditing) {
				setIsEditing(true);
			}
			pointerSelectingRef.current = true;
			beginPointerSelection(screenPoint, Boolean(event.shiftKey));
		},
		[beginPointerSelection, frameScreen, isEditing, suspendHover],
	);

	const handleLayerDoubleClick = useCallback(
		(event: SkiaPointerEvent) => {
			if (suspendHover) return;
			const currentSession = sessionRef.current;
			if (!currentSession || !frameScreen) return;
			const button = (event as unknown as { button?: number }).button ?? 0;
			if (button !== 0) return;
			const screenPoint = { x: event.x, y: event.y };
			if (!isPointInRect(screenPoint, frameScreen)) return;
			setIsEditing(true);
			const caretIndex = resolveTextEditingIndexAtScreenPoint(
				currentSession,
				screenPoint,
			);
			selectionAnchorRef.current = caretIndex;
			setSessionState((previousSession) => {
				if (!previousSession) return previousSession;
				return updateTextEditingSessionSelection(previousSession, {
					start: caretIndex,
					end: caretIndex,
					direction: "none",
				});
			});
		},
		[frameScreen, suspendHover],
	);

	const handleLayerPointerMove = useCallback(
		(event: SkiaPointerEvent) => {
			if (!isEditing) return;
			if (!pointerSelectingRef.current) return;
			if (!resolvePrimaryButton(event)) {
				pointerSelectingRef.current = false;
				return;
			}
			beginPointerSelection({ x: event.x, y: event.y }, true);
		},
		[beginPointerSelection, isEditing],
	);

	const handleLayerPointerUp = useCallback(() => {
		pointerSelectingRef.current = false;
	}, []);

	const handleLayerPointerLeave = useCallback(() => {
		if (pointerSelectingRef.current) return;
	}, []);

	const textEditingDecorations =
		useMemo<TextNodeTextEditingDecorations | null>(() => {
			if (!isEditing || !sessionState) return null;
			const decorations = resolveTextEditingDecorations(sessionState);
			return {
				frameScreen: decorations.frame,
				selectionRectsLocal: decorations.selectionRects.map((rect) => ({
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				})),
				compositionRectsLocal: decorations.compositionRects.map((rect) => ({
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				})),
				caretRectLocal: decorations.caretRect
					? {
							x: decorations.caretRect.x,
							y: decorations.caretRect.y,
							width: decorations.caretRect.width,
							height: decorations.caretRect.height,
						}
					: null,
			};
		}, [isEditing, sessionState]);

	const bridgeProps =
		useMemo<TextNodeFocusTextEditingBridgeState | null>(() => {
			if (!sessionState) return null;
			return {
				sessionId: `text-node-focus-edit-${sessionState.target.id}`,
				value: sessionState.draftText,
				selection: sessionState.selection,
				isComposing: sessionState.mode === "composing",
				isActive: isEditing,
				canUndo: false,
				canRedo: false,
				overlayRectScreen: resolveTextEditingOverlayRect(
					sessionState.target.frame,
				),
				onValueChange: handleValueChange,
				onSelectionChange: handleSelectionChange,
				onCompositionStart: handleCompositionStart,
				onCompositionUpdate: handleCompositionUpdate,
				onCompositionEnd: handleCompositionEnd,
				onUndo: () => {},
				onRedo: () => {},
				onCommit: () => {
					setIsEditing(false);
				},
				onCancel: () => {
					setFocusedNode(null);
				},
				onBlur: () => {
					setIsEditing(false);
				},
			};
		}, [
			handleCompositionEnd,
			handleCompositionStart,
			handleCompositionUpdate,
			handleSelectionChange,
			handleValueChange,
			isEditing,
			sessionState,
			setFocusedNode,
		]);

	const enabled = Boolean(focusedNode);
	const layerProps = useMemo<TextNodeFocusSkiaLayerProps | null>(() => {
		if (!enabled || !frameScreen) return null;
		return {
			width,
			height,
			frameScreen,
			isEditing,
			textEditingDecorations,
			disabled: suspendHover,
			onLayerPointerDown: handleLayerPointerDown,
			onLayerDoubleClick: handleLayerDoubleClick,
			onLayerPointerMove: handleLayerPointerMove,
			onLayerPointerUp: handleLayerPointerUp,
			onLayerPointerLeave: handleLayerPointerLeave,
		};
	}, [
		enabled,
		frameScreen,
		handleLayerDoubleClick,
		handleLayerPointerDown,
		handleLayerPointerLeave,
		handleLayerPointerMove,
		handleLayerPointerUp,
		height,
		isEditing,
		suspendHover,
		textEditingDecorations,
		width,
	]);

	return {
		enabled,
		layerProps,
		bridgeProps,
	};
};
