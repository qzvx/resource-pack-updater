import type { SourceVersion, TargetVersion } from './versions';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export type Progress = { percent: number; stage: string };
export type ConversionReport = {
  source: SourceVersion;
  target: TargetVersion;
  inputFiles: number;
  outputFiles: number;
  renamed: number;
  updated: number;
  generated: number;
  archived: number;
  warnings: string[];
};
export type ConvertRequest = { file: File; source: SourceVersion; target: TargetVersion };
export type WorkerResponse =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; zip: Uint8Array<ArrayBuffer>; report: ConversionReport }
  | { type: 'error'; message: string };
