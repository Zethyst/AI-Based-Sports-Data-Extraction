import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { PROVIDER_TIMEOUT_MS, getModel } from "@/lib/config";
import { ExtractionError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { buildRepairPrompt, buildSystemPrompt, chunkNote, wrapDocument } from "../prompt";
import { envelopeSchemaFor, normalizeRecords } from "../schemas";
import type { ExtractedRecord } from "../schemas";
import type { ExtractionType, SourceDocument } from "../types";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new ExtractionError(
      "AI_NOT_CONFIGURED",
      "The extraction service is not configured. Please contact whoever set up this deployment.",
      "OPENAI_API_KEY is missing from the environment",
    );
  }

  cachedClient = new OpenAI({ apiKey, timeout: PROVIDER_TIMEOUT_MS });
  return cachedClient;
}

export interface ExtractChunkArgs {
  type: ExtractionType;
  doc: SourceDocument;
  /** Parsed text for this chunk. Absent for vision documents, which send the file itself. */
  chunkText?: string;
  chunkIndex: number;
  chunkCount: number;
  logger: Logger;
}

export interface ExtractChunkResult {
  records: ExtractedRecord[];
  repairAttempts: number;
}

/**
 * One model call for one chunk, with the schema attached and the result validated.
 *
 * The schema goes with the request, so malformed JSON and invented field names are
 * not failure modes we handle — they are failure modes the decoder prevents. But the
 * validator still runs on every path: refusals, truncation against the
 * token ceiling, and SDK-level surprises all still produce something this function
 * must not return unchecked.
 */
export async function extractChunk(args: ExtractChunkArgs): Promise<ExtractChunkResult> {
  const { type, doc, chunkText, chunkIndex, chunkCount, logger } = args;

  const client = getClient();
  const model = getModel();
  const schema = envelopeSchemaFor(type);

  const systemPrompt = buildSystemPrompt(type);
  const content = buildContent(doc, chunkText, chunkIndex, chunkCount);

  // Conversation state for the repair attempt: the second call sees the first
  // response and the validator's complaint about it, not a blank slate.
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let repairAttempts = 0;

  for (let attempt = 0; ; attempt += 1) {
    const response = await client.responses.parse({
      model,
      instructions: systemPrompt,
      input: [
        { role: "user", content },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      ],
      text: { format: zodTextFormat(schema, `${type}_extraction`) },
    });

    const refusal = findRefusal(response);
    if (refusal) {
      throw new ExtractionError(
        "AI_INVALID_RESPONSE",
        "The extraction service declined to process this file.",
        `refusal: ${refusal}`,
      );
    }

    // `parsed` is the SDK's own schema-validated result. Re-running our Zod schema
    // over it is the gate that has no bypass — if the SDK ever hands back something
    // it shouldn't, it stops here rather than in a consumer's database.
    const validation = schema.safeParse(response.output_parsed ?? tryParseText(response.output_text));

    if (validation.success) {
      const records = normalizeRecords(validation.data.data as Record<string, unknown>[]);
      return { records: records as ExtractedRecord[], repairAttempts };
    }

    const issues = formatIssues(validation.error);

    if (attempt >= 1) {
      logger.error("validation_exhausted", { chunkIndex, issues });
      throw new ExtractionError(
        "AI_INVALID_RESPONSE",
        "The extraction service returned data in an unexpected format. Please try again.",
        issues,
      );
    }

    logger.warn("validation_failed_repairing", { chunkIndex, issues });
    repairAttempts += 1;

    history.push(
      { role: "assistant", content: response.output_text ?? "" },
      { role: "user", content: buildRepairPrompt(issues) },
    );
  }
}

/**
 * Builds the model input for whichever shape the parser produced. This is the only
 * place the three SourceDocument variants are distinguished.
 */
function buildContent(
  doc: SourceDocument,
  chunkText: string | undefined,
  chunkIndex: number,
  chunkCount: number,
): ResponseInputContent[] {
  const note = chunkNote(chunkIndex, chunkCount);

  if (doc.kind === "text") {
    return [{ type: "input_text", text: wrapDocument(chunkText ?? doc.text, note) }];
  }

  if (doc.kind === "images") {
    return [
      {
        type: "input_text",
        text: "Read the attached image and extract the requested records from it.",
      },
      ...doc.images.map(
        (image) =>
          ({
            type: "input_image",
            image_url: image.dataUrl,
            detail: "high",
          }) satisfies ResponseInputContent,
      ),
    ];
  }

  return [
    {
      type: "input_text",
      text: "Read the attached document, including any pages that are scanned images, and extract the requested records from it.",
    },
    {
      type: "input_file",
      filename: doc.meta.fileName,
      file_data: `data:${doc.mimeType};base64,${doc.base64}`,
    },
  ];
}

function findRefusal(response: { output?: unknown }): string | null {
  const output = response.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      const candidate = part as { type?: string; refusal?: string };
      if (candidate?.type === "refusal" && candidate.refusal) return candidate.refusal;
    }
  }

  return null;
}

function tryParseText(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Flattens Zod issues into a message the model can act on — path included. */
function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `- ${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("\n");
}
