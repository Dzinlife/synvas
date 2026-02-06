import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	return (
		<label
			className={cn(
				"cursor-default text-sm leading-5 font-medium text-gray-900",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
