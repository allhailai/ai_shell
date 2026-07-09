/* ── CodaScope: Research Synthesizer ─────────────────────────────────
   Batched LLM synthesis for the research pipeline.

   Replaces the per-source agent loop with 1-3 tool-free LLM calls.
   Each batch sends cleaned source content + epic context to the LLM
   and receives structured JSON (WikiPageDraft[]) back.

   Key design: Uses Cursor SDK Agent with ZERO custom tools, eliminating
   the ~15k token overhead of 100 tool definitions per call.
   ──────────────────────────────────────────────────────────────────── */

import { Agent } from "@cursor/sdk";
import type { SDKMessage } from "@cursor/sdk";

// ── Types ───────────────────────────────────────────────────────────

export interface CleanedSource {
  sourceId: string;
  title: string;
  url: string;
  topicAssociations: string[];
  content: string; // cleaned by summarizeForResearch()
}

export interface SynthesisContext {
  epicTitle: string;
  epicDefinition: string;
  scopeText: string;
  existingPages: {
    id: string;
    title: string;
    wordCount: number;
    content: string;
  }[];
}

export interface WikiPageDraft {
  pageId: string; // kebab-case slug
  title: string;
  content: string; // markdown
  sourceRefs: string[]; // source IDs that contributed
}

export interface BatchProgressEvent {
  batchIndex: number;
  batchCount: number;
  topicLabel: string;
}

// ── Constants ───────────────────────────────────────────────────────

/**
 * Approximate chars-per-token ratio for rough token estimation.
 * Conservative estimate — 1 token ≈ 3.5 chars for English text.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Maximum combined source content per batch (in chars).
 * ~80k tokens × 3.5 chars/token ≈ 280k chars.
 * We use a lower threshold to leave room for the prompt + context.
 */
const MAX_BATCH_CHARS = 200_000;

// ── Grouping ────────────────────────────────────────────────────────

/**
 * Group cleaned sources by topic affinity, splitting into batches
 * that stay under the token limit.
 */
export function groupSourcesByTopic(
  sources: CleanedSource[],
): { label: string; sources: CleanedSource[] }[] {
  if (sources.length === 0) return [];

  // Build a topic → sources map
  const topicMap = new Map<string, CleanedSource[]>();
  const ungrouped: CleanedSource[] = [];

  for (const source of sources) {
    if (source.topicAssociations.length > 0) {
      // Use the first topic association as the primary grouping key
      const primaryTopic = source.topicAssociations[0];
      const existing = topicMap.get(primaryTopic) ?? [];
      existing.push(source);
      topicMap.set(primaryTopic, existing);
    } else {
      ungrouped.push(source);
    }
  }

  // Merge ungrouped into the largest topic group (or create a "General" group)
  if (ungrouped.length > 0) {
    if (topicMap.size > 0) {
      // Find the largest group
      let largestKey = "";
      let largestSize = 0;
      for (const [key, val] of topicMap) {
        if (val.length > largestSize) {
          largestSize = val.length;
          largestKey = key;
        }
      }
      topicMap.get(largestKey)!.push(...ungrouped);
    } else {
      topicMap.set("General", ungrouped);
    }
  }

  // Build initial batches from topic groups
  const rawBatches: { label: string; sources: CleanedSource[] }[] = [];
  for (const [topic, topicSources] of topicMap) {
    rawBatches.push({ label: topic, sources: topicSources });
  }

  // Split any batch that exceeds the char limit
  const finalBatches: { label: string; sources: CleanedSource[] }[] = [];
  for (const batch of rawBatches) {
    const totalChars = batch.sources.reduce((sum, s) => sum + s.content.length, 0);
    if (totalChars <= MAX_BATCH_CHARS) {
      finalBatches.push(batch);
    } else {
      // Split into sub-batches
      let currentBatch: CleanedSource[] = [];
      let currentChars = 0;
      let subIndex = 1;

      for (const source of batch.sources) {
        if (currentChars + source.content.length > MAX_BATCH_CHARS && currentBatch.length > 0) {
          finalBatches.push({
            label: `${batch.label} (part ${subIndex})`,
            sources: currentBatch,
          });
          subIndex++;
          currentBatch = [];
          currentChars = 0;
        }
        currentBatch.push(source);
        currentChars += source.content.length;
      }

      if (currentBatch.length > 0) {
        finalBatches.push({
          label: subIndex > 1 ? `${batch.label} (part ${subIndex})` : batch.label,
          sources: currentBatch,
        });
      }
    }
  }

  // If everything fits in one batch, merge all into a single batch
  const totalChars = finalBatches.reduce(
    (sum, b) => sum + b.sources.reduce((s, src) => s + src.content.length, 0),
    0,
  );
  if (totalChars <= MAX_BATCH_CHARS && finalBatches.length > 1) {
    const allSources = finalBatches.flatMap((b) => b.sources);
    const labels = finalBatches.map((b) => b.label);
    return [{ label: labels.join(", "), sources: allSources }];
  }

  return finalBatches;
}

// ── Synthesis ───────────────────────────────────────────────────────

/**
 * Build the synthesis prompt for a single batch.
 */
function buildSynthesisPrompt(
  batch: CleanedSource[],
  context: SynthesisContext,
): string {
  const existingPagesSection = context.existingPages.length > 0
    ? context.existingPages
        .map((p) => `### ${p.title} (id: ${p.id}, ${p.wordCount} words)\n\n${p.content}`)
        .join("\n\n---\n\n")
    : "_No existing wiki pages._";

  const sourcesSection = batch
    .map(
      (s, i) =>
        `### Source ${i + 1}: ${s.title}\n` +
        `- **URL**: ${s.url}\n` +
        `- **Source ID**: ${s.sourceId}\n` +
        `- **Topics**: ${s.topicAssociations.join(", ") || "unspecified"}\n\n` +
        s.content,
    )
    .join("\n\n---\n\n");

  return `You are CodaScope, an AI research synthesizer. Your task is to analyze the research sources below and produce well-structured wiki pages for an epic knowledge base.

## Epic Context

**Title**: ${context.epicTitle}

**Definition**:
${context.epicDefinition || "_No definition provided._"}

**Scope**:
${context.scopeText || "_No scope entries._"}

## Existing Wiki Pages

These pages already exist. If a source covers the same topic, ENRICH the existing page rather than creating a duplicate. Return the enriched content with the same pageId.

${existingPagesSection}

## Research Sources to Synthesize

${sourcesSection}

## Instructions

1. Analyze ALL sources together — cross-reference, deduplicate, and organize coherently.
2. For each distinct topic, create one wiki page. If an existing page covers the topic, return an enriched version with the same \`pageId\`.
3. Each wiki page should be comprehensive markdown with:
   - Clear headings and structure
   - Key facts, data points, and technical details from the sources
   - Wikilinks ([[page-id]]) to other relevant pages where appropriate
4. Use kebab-case for new page IDs (e.g., "elation-scheduling-api").
5. Include ALL source IDs that contributed to each page in the \`sourceRefs\` array.
6. Do NOT create a page if the sources contain no substantive content for it.

## Required Output Format

Return ONLY a JSON code block with this exact structure:

\`\`\`json
{
  "pages": [
    {
      "pageId": "kebab-case-slug",
      "title": "Human Readable Title",
      "content": "Full markdown content here...\\n\\n## Section...\\n\\nMore content...",
      "sourceRefs": ["source-id-1", "source-id-2"]
    }
  ]
}
\`\`\`

Return the JSON and nothing else outside the code block.`;
}

/**
 * Parse WikiPageDraft[] from the LLM's response text.
 */
function parseSynthesisResponse(responseText: string): WikiPageDraft[] {
  // Try to find JSON in a code block
  const codeBlockMatch = responseText.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : responseText;

  // Try to find a JSON object with "pages"
  const jsonMatch = jsonCandidate.match(/\{[\s\S]*"pages"[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.pages)) return [];

    return parsed.pages
      .map((p: Record<string, unknown>) => ({
        pageId: String(p.pageId ?? ""),
        title: String(p.title ?? ""),
        content: String(p.content ?? ""),
        sourceRefs: Array.isArray(p.sourceRefs)
          ? (p.sourceRefs as string[]).map(String)
          : [],
      }))
      .filter(
        (p: WikiPageDraft) =>
          p.pageId && p.title && p.content.length > 50,
      );
  } catch {
    return [];
  }
}

/**
 * Synthesize a single batch of sources into wiki page drafts.
 *
 * Creates a Cursor SDK agent with ZERO custom tools (eliminating tool
 * definition overhead) and sends a single prompt requesting JSON output.
 */
async function synthesizeBatch(
  batch: CleanedSource[],
  context: SynthesisContext,
  modelId: string,
  apiKey: string,
): Promise<WikiPageDraft[]> {
  const prompt = buildSynthesisPrompt(batch, context);

  // Create a lightweight agent with no tools
  const agent = await Agent.create({
    model: { id: modelId },
    apiKey,
    name: "CodaScope Research Synthesizer",
    local: {
      customTools: {}, // No tools — pure generation
    },
  });

  try {
    // Collect the full response text
    let fullResponse = "";

    const run = await agent.send(prompt, {
      model: { id: modelId },
      onDelta: ({ update }) => {
        if ("text" in update && update.text) {
          fullResponse += update.text;
        }
      },
    });

    await run.wait();

    return parseSynthesisResponse(fullResponse);
  } finally {
    try {
      agent.close();
    } catch {
      // ignore close errors
    }
  }
}

/**
 * Orchestrate the full batched synthesis pipeline.
 *
 * 1. Groups sources by topic affinity
 * 2. For each batch: single LLM call → WikiPageDraft[]
 * 3. Calls onBatchProgress for SSE event emission
 */
export async function synthesizeAll(
  sources: CleanedSource[],
  context: SynthesisContext,
  modelId: string,
  apiKey: string,
  onBatchProgress?: (event: BatchProgressEvent) => void,
): Promise<WikiPageDraft[]> {
  if (sources.length === 0) return [];

  const batches = groupSourcesByTopic(sources);
  const allDrafts: WikiPageDraft[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    onBatchProgress?.({
      batchIndex: i,
      batchCount: batches.length,
      topicLabel: batch.label,
    });

    const drafts = await synthesizeBatch(batch.sources, context, modelId, apiKey);
    allDrafts.push(...drafts);
  }

  // Deduplicate by pageId (last write wins if multiple batches produce same pageId)
  const deduped = new Map<string, WikiPageDraft>();
  for (const draft of allDrafts) {
    const existing = deduped.get(draft.pageId);
    if (existing) {
      // Merge sourceRefs from both
      const mergedRefs = [...new Set([...existing.sourceRefs, ...draft.sourceRefs])];
      deduped.set(draft.pageId, { ...draft, sourceRefs: mergedRefs });
    } else {
      deduped.set(draft.pageId, draft);
    }
  }

  return Array.from(deduped.values());
}
