import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";

const Progress = ProgressPrimitive.Root;

function ProgressTrack({
	className,
	...props
}: ProgressPrimitive.Track.Props) {
	return (
		<ProgressPrimitive.Track
			className={cn(
				"h-2 w-full overflow-hidden rounded-full bg-neutral-800",
				className,
			)}
			{...props}
		/>
	);
}

function ProgressIndicator({
	className,
	...props
}: ProgressPrimitive.Indicator.Props) {
	return (
		<ProgressPrimitive.Indicator
			className={cn("h-full bg-emerald-500 transition-[width] duration-150", className)}
			{...props}
		/>
	);
}

function ProgressValue({
	className,
	...props
}: ProgressPrimitive.Value.Props) {
	return (
		<ProgressPrimitive.Value
			className={cn("text-xs text-neutral-300 tabular-nums", className)}
			{...props}
		/>
	);
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressValue };
