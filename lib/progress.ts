export interface ProgressUpdate {
  stage: "parsing" | "extracting" | "merging";
  message: string;
  completedChunks?: number;
  totalChunks?: number;
}
