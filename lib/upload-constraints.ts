export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

export const ACCEPTED_EXTENSIONS = [
  "pdf",
  "csv",
  "xlsx",
  "xls",
  "docx",
  "txt",
  "jpg",
  "jpeg",
  "png",
] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");
