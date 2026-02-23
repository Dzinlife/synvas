import "./registerBuiltins";
import {
	getCanvasNodeDefinition as getCanvasNodeDefinitionFromCore,
	getCanvasNodeDefinitionList,
	registerCanvasNodeDefinition,
} from "./registryCore";

export const canvasNodeDefinitionList = getCanvasNodeDefinitionList();

export const getCanvasNodeDefinition = getCanvasNodeDefinitionFromCore;

export { registerCanvasNodeDefinition };
