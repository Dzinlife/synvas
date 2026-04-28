import { Skia } from "../Skia";
import type { DataSourceParam, SkImage } from "../types";

import { useRawData } from "./Data";

const imgFactory = Skia.Image.MakeImageFromEncoded.bind(Skia.Image);

/**
 * Returns a Skia Image object
 * */
export const useImage = (
	source: DataSourceParam,
	onError?: (err: Error) => void,
) => useRawData(source, imgFactory, onError);

/**
 * Creates an image from a given view reference. The callback is called with
 * the view ref and is expected to resolve a Skia Image object.
 * @param viewRef Ref to the view we're creating an image from
 * @returns A promise that resolves to a Skia Image object or rejects
 * with an error if the callback cannot create the image.
 */
export const makeImageFromView = <T>(
	viewRef: React.RefObject<T>,
	callback: (viewRef: React.RefObject<T>) => Promise<SkImage | null>,
) => callback(viewRef);
