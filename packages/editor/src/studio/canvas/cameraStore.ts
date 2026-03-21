import { create } from "zustand";
import {
	type CameraState,
	DEFAULT_CAMERA,
} from "./canvasWorkspaceUtils";

interface CanvasCameraStoreState {
	camera: CameraState;
	setCamera: (camera: CameraState) => void;
	setFromProject: (camera: CameraState | null | undefined) => void;
	resetCamera: () => void;
}

const isCameraEqual = (left: CameraState, right: CameraState): boolean => {
	return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
};

export const useCanvasCameraStore = create<CanvasCameraStoreState>((set) => ({
	camera: DEFAULT_CAMERA,
	setCamera: (camera) => {
		set((state) => {
			if (isCameraEqual(state.camera, camera)) {
				return state;
			}
			return {
				camera,
			};
		});
	},
	setFromProject: (camera) => {
		set((state) => {
			const nextCamera = camera ?? DEFAULT_CAMERA;
			if (isCameraEqual(state.camera, nextCamera)) {
				return state;
			}
			return {
				camera: nextCamera,
			};
		});
	},
	resetCamera: () => {
		set((state) => {
			if (isCameraEqual(state.camera, DEFAULT_CAMERA)) {
				return state;
			}
			return {
				camera: DEFAULT_CAMERA,
			};
		});
	},
}));

export const getCanvasCamera = (): CameraState => {
	return useCanvasCameraStore.getState().camera;
};

export const setCanvasCameraFromProject = (
	camera: CameraState | null | undefined,
): void => {
	useCanvasCameraStore.getState().setFromProject(camera);
};
