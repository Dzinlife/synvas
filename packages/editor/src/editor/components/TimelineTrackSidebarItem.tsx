import {
	Eye,
	EyeOff,
	Film,
	HeadphoneOff,
	Headphones,
	Layers,
	Lock,
	LockOpen,
	Music2,
	Sparkles,
	Volume2,
	VolumeX,
} from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";
import type { TimelineTrack } from "../timeline/types";

const BUTTON_BASE_CLASS =
	"size-6 transition-colors flex items-center justify-center";

const buildButtonClass = (active: boolean, activeClass: string): string => {
	return cn(BUTTON_BASE_CLASS, active ? activeClass : "text-white/50");
};

interface TimelineTrackSidebarItemProps {
	track: TimelineTrack;
	label: string;
	height: number;
	onToggleVisible?: () => void;
	onToggleLocked?: () => void;
	onToggleMuted?: () => void;
	onToggleSolo?: () => void;
	className?: string;
	labelClassName?: string;
}

const ROLE_ICON_MAP: Record<
	TimelineTrack["role"],
	React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
	clip: Film,
	overlay: Layers,
	effect: Sparkles,
	audio: Music2,
};

const TimelineTrackSidebarItem: React.FC<TimelineTrackSidebarItemProps> = ({
	track,
	label,
	height,
	onToggleVisible,
	onToggleLocked,
	onToggleMuted,
	onToggleSolo,
	className,
	labelClassName,
}) => {
	const RoleIcon = ROLE_ICON_MAP[track.role] ?? Film;
	return (
		<div
			className={cn(
				"flex items-center justify-end gap-2 pr-4 pl-4 text-xs font-medium",
				className,
			)}
			style={{ height }}
		>
			<div className="flex items-center gap-1 w-full">
				<RoleIcon className={cn("size-3 mr-auto opacity-50", labelClassName)} />
				<button
					type="button"
					className={buildButtonClass(track.hidden, "text-emerald-300")}
					onClick={onToggleVisible}
					title={track.hidden ? "显示" : "隐藏"}
				>
					{track.hidden ? (
						<EyeOff className="size-3.5" />
					) : (
						<Eye className="size-3.5" />
					)}
				</button>
				<button
					type="button"
					className={buildButtonClass(track.locked, "text-rose-300")}
					onClick={onToggleLocked}
					title={track.locked ? "解锁" : "锁定"}
				>
					{track.locked ? (
						<Lock className="size-3.5" />
					) : (
						<LockOpen className="size-3.5" />
					)}
				</button>
				<button
					type="button"
					className={buildButtonClass(track.muted, "text-amber-300")}
					onClick={onToggleMuted}
					title={track.muted ? "取消静音" : "静音"}
				>
					{track.muted ? (
						<VolumeX className="size-3.5" />
					) : (
						<Volume2 className="size-3.5" />
					)}
				</button>
				<button
					type="button"
					className={buildButtonClass(track.solo, "text-sky-300")}
					onClick={onToggleSolo}
					title={track.solo ? "取消独奏" : "独奏"}
				>
					{track.solo ? (
						<Headphones className="size-3.5" />
					) : (
						<HeadphoneOff className="size-3.5" />
					)}
				</button>
			</div>
		</div>
	);
};

export default TimelineTrackSidebarItem;
