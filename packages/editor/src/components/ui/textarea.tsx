import { cn } from "@/lib/utils";
import type * as React from "react";

type TextareaProps = React.ComponentProps<"textarea">;

function Textarea({ className, ...props }: TextareaProps) {
	return (
		<textarea
			className={cn(
				"min-h-20 w-full resize-none rounded-md border border-gray-200 px-3.5 py-2 text-base text-gray-900 focus:outline-2 focus:-outline-offset-1 focus:outline-blue-800",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
