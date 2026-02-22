import React, { useCallback, useEffect, useState } from "react";
import { useSelectedElement } from "../contexts/TimelineContext";
import MaterialLibrary from "../MaterialLibrary";
import ElementSettingsPanel from "./ElementSettingsPanel";

interface SidebarPanelProps {
	title: string;
	isOpen: boolean;
	onToggle: () => void;
	children: React.ReactNode;
	widthClassName?: string;
	headerActions?: React.ReactNode;
}

const SidebarPanel: React.FC<SidebarPanelProps> = ({
	title,
	isOpen,
	onToggle,
	children,
	widthClassName,
	headerActions,
}) => {
	return (
		<div
			className={`pointer-events-auto bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl flex flex-col min-h-0 max-h-full overflow-hidden ${
				widthClassName ?? "w-60"
			}`}
		>
			<div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
				<button
					type="button"
					className="flex items-center gap-2 text-sm font-medium text-white select-text"
					onClick={onToggle}
				>
					<span>{title}</span>
					<span className="text-neutral-400 text-xs">{isOpen ? "▼" : "▶"}</span>
				</button>
				{headerActions && (
					<div className="flex items-center gap-1">{headerActions}</div>
				)}
			</div>
			{isOpen && (
				<div className="px-3 py-2 max-h-full overflow-y-auto min-h-0 select-text">
					{children}
				</div>
			)}
		</div>
	);
};

const EditorSidebars: React.FC = () => {
	const { selectedElement, setSelectedElementId } = useSelectedElement();
	const [panelOpenState, setPanelOpenState] = useState({
		material: true,
		element: false,
	});

	// 选中元素时自动收起素材库，并展开设置面板
	useEffect(() => {
		if (selectedElement) {
			setPanelOpenState((prev) => ({
				...prev,
				material: false,
				element: true,
			}));
		} else {
			setPanelOpenState((prev) => ({ ...prev, element: false }));
		}
	}, [selectedElement?.id]);

	const togglePanel = useCallback(
		(panelId: "material" | "element") => {
			if (panelId === "element" && !selectedElement) {
				return;
			}
			setPanelOpenState((prev) => ({ ...prev, [panelId]: !prev[panelId] }));
		},
		[selectedElement],
	);

	const handleClearSelection = useCallback(() => {
		setSelectedElementId(null);
	}, [setSelectedElementId]);

	const elementActions = selectedElement ? (
		<button
			type="button"
			onClick={handleClearSelection}
			className="text-neutral-400 hover:text-white transition-colors"
			aria-label="清除选中"
		>
			<svg
				className="w-4 h-4"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	) : null;

	return (
		<div className="absolute inset-0 pointer-events-none">
			<div className="absolute left-4 top-4 bottom-4 flex flex-col gap-2 pointer-events-none overflow-y-auto min-h-0">
				<SidebarPanel
					title="素材库"
					isOpen={panelOpenState.material}
					onToggle={() => togglePanel("material")}
					widthClassName="w-56"
				>
					<MaterialLibrary />
				</SidebarPanel>
				{selectedElement && (
					<SidebarPanel
						title="元素设置"
						isOpen={panelOpenState.element}
						onToggle={() => togglePanel("element")}
						widthClassName="w-64"
						headerActions={elementActions}
					>
						<ElementSettingsPanel />
					</SidebarPanel>
				)}
			</div>
		</div>
	);
};

export default EditorSidebars;
