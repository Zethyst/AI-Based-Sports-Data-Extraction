import type { ExtractionMeta } from "./extraction/pipeline";
import type { ExtractedRecord } from "./extraction/schemas";
import type { ErrorCode } from "./errors";
import type { ExtractionType } from "./extraction/types";

export interface ExtractSuccess {
  success: true;
  type: ExtractionType;
  data: ExtractedRecord[];
  meta: ExtractionMeta & { requestId: string };
}

export interface ExtractFailure {
  success: false;
  type: string;
  data: [];
  error: string;
  errorCode: ErrorCode;
  meta: { requestId: string; durationMs: number };
}

export type ExtractResponse = ExtractSuccess | ExtractFailure;
