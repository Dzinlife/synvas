import type { SkJSIInstance } from "../JsiInstance";
import type { WebAssetModule, WebAssetSource } from "../../../web/assets";

export type SkData = SkJSIInstance<"Data">;

export type DataModule = WebAssetModule;
export type DataSource = WebAssetSource;
export type DataSourceParam = DataSource | null | undefined;
