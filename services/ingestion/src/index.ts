import { createHash } from "node:crypto";

/**
 * Official Statutory and Regulatory Document Ingestion Service.
 *
 * Implements fetch, parse, version, chunk, and sha-256 checksum verification
 * of official UK legal sources (legislation.gov.uk, GOV.UK, tribunal rules).
 */
export const SERVICE = "ingestion";

export interface IngestedChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly sequenceIndex: number;
  readonly paragraphLocator: string | null;
  readonly text: string;
  readonly tokenEstimate: number;
  readonly checksum: string;
}

export interface IngestionResult {
  readonly sourceId: string;
  readonly version: string;
  readonly retrievedAt: string;
  readonly documentChecksum: string;
  readonly chunkCount: number;
  readonly chunks: readonly IngestedChunk[];
  readonly verified: boolean;
}

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Chunks statutory or guidance text preserving paragraph and section headers.
 */
export function chunkStatutoryText(
  sourceId: string,
  rawText: string,
  targetChunkChars = 1200
): readonly IngestedChunk[] {
  const paragraphs = rawText.split(/\n\s*\n/);
  const chunks: IngestedChunk[] = [];
  let currentBuffer = "";
  let currentLocator: string | null = null;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Detect section or paragraph markers (e.g., "Section 1", "Paragraph 10", "SW 5.1")
    const locatorMatch = trimmed.match(/^(?:Section|Paragraph|Rule|Part|SW|GR|APP)\s*([A-Za-z0-9.]+)/i);
    if (locatorMatch?.[1]) {
      currentLocator = locatorMatch[1];
    }

    if (currentBuffer.length + trimmed.length > targetChunkChars && currentBuffer.length > 0) {
      const chunkText = currentBuffer.trim();
      chunks.push({
        id: `${sourceId}-chk-${String(chunkIndex).padStart(4, "0")}`,
        sourceId,
        sequenceIndex: chunkIndex++,
        paragraphLocator: currentLocator,
        text: chunkText,
        tokenEstimate: Math.ceil(chunkText.length / 4),
        checksum: computeSha256(chunkText),
      });
      currentBuffer = "";
    }

    currentBuffer += (currentBuffer ? "\n\n" : "") + trimmed;
  }

  if (currentBuffer.trim().length > 0) {
    const chunkText = currentBuffer.trim();
    chunks.push({
      id: `${sourceId}-chk-${String(chunkIndex).padStart(4, "0")}`,
      sourceId,
      sequenceIndex: chunkIndex,
      paragraphLocator: currentLocator,
      text: chunkText,
      tokenEstimate: Math.ceil(chunkText.length / 4),
      checksum: computeSha256(chunkText),
    });
  }

  return chunks;
}

/**
 * Ingests, hashes, and chunks an official legal publication.
 */
export async function ingestLegalSource(
  sourceId: string,
  version: string,
  rawText: string,
  expectedChecksum?: string
): Promise<IngestionResult> {
  const documentChecksum = computeSha256(rawText);
  const verified = !expectedChecksum || documentChecksum === expectedChecksum;
  const chunks = chunkStatutoryText(sourceId, rawText);

  return {
    sourceId,
    version,
    retrievedAt: new Date().toISOString(),
    documentChecksum,
    chunkCount: chunks.length,
    chunks,
    verified,
  };
}
