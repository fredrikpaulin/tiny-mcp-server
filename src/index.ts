// Core
export * from "./mcp";

// Modules
export { default as recall } from "./modules/recall";
export { default as patterns } from "./modules/patterns";
export { default as beacon } from "./modules/beacon";
export { default as scanner } from "./modules/scanner";
export { default as query } from "./modules/query";
export { default as graphExport } from "./modules/export";
export { default as diff } from "./modules/diff";
export { default as stats } from "./modules/stats";
export { default as refactor } from "./modules/refactor";
export { default as prompt } from "./modules/prompt";

// Types
export type { RecallAPI } from "./modules/recall";
export type { PatternsAPI, PatternsNode, PatternsEdge, Direction, TraverseResult, PathResult } from "./modules/patterns";
export type { BeaconAPI, BeaconResult, BeaconSearchResponse } from "./modules/beacon";
export type { ScannerAPI, ScanResult } from "./modules/scanner";
export type { QueryAPI, QueryOptions, QueryResult } from "./modules/query";
export type { ExportAPI, ExportOptions } from "./modules/export";
export type { DiffAPI, DiffResult } from "./modules/diff";
export type { StatsAPI, StatsResult } from "./modules/stats";
export type { RefactorAPI, FindRefsResult, RenameImpact, Reference } from "./modules/refactor";
export type { PromptAPI, PromptResult, PromptSection, PromptOptions } from "./modules/prompt";
