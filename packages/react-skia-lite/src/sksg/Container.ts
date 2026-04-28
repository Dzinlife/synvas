import type { Skia } from "../skia/types";
import { StaticContainer } from "./StaticContainer";

export const createContainer = (Skia: Skia, canvasId: number) => {
	return new StaticContainer(Skia, canvasId);
};
