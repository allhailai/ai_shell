/* ── CodaScope: Epic Tools ───────────────────────────────────────────
   Read + write tools for epics, wiki, concepts, scope, research,
   curation, annotations, and design docs. Available to assistant/chat
   (full agent autonomy) and to the curation pipeline.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import type { TopicDepth, CurationReasonType } from "../../../src/apps/codascope/codaScopeTypes.js";
import { searchWeb } from "../codaScopeWebSearchService.js";
import { collectToolResult } from "../codaScopeToolDefinitions.js";

/**
 * Build epic-related write tools and new read tools.
 * These tools are available to assistant/chat (full agent autonomy)
 * and to the curation pipeline.
 */
export function buildEpicTools(
  projectId: string,
  services: ToolServices,
): Record<string, SDKCustomTool> {
  const {
    wiki: wikiService,
    epic: epicService,
    concept: conceptService,
    annotation: annotationService,
    epicKnowledge: epicKnowledgeService,
    curation: curationService,
    buildState: buildStateService,
    designDoc: designDocService,
  } = services;

  return {
    // ── Write Tools ─────────────────────────────────────────────────

    write_wiki_topic: {
      description:
        "Create or enrich a main wiki page. If the topic exists, the content is replaced. " +
        "Use read_wiki_topic first to check existing content and enrich rather than replace. " +
        "Main wiki pages contain code-derived knowledge ONLY — never put research or designs here.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string", description: "The topic slug (kebab-case, e.g. 'auth-flow')" },
          content: { type: "string", description: "Full markdown content for the wiki page" },
          title: { type: "string", description: "Optional human-readable title (derived from topicId if not provided)" },
        },
        required: ["topicId", "content"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        const content = args.content as string;
        if (!topicId || !content) return "topicId and content are required.";
        try {
          await wikiService.updateTopicContent(projectId, topicId, content);
          return `Wiki topic "${topicId}" has been written successfully.`;
        } catch (err) {
          return `Failed to write wiki topic "${topicId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    delete_wiki_topic: {
      description:
        "Request deletion of a main wiki page. This does NOT immediately delete the page — " +
        "it creates a pending deletion record that requires human approval. " +
        "The page remains unchanged until a human approves the deletion in the UI. " +
        "You must provide a reason explaining why the page should be deleted.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string", description: "The topic ID to request deletion for" },
          reason: { type: "string", description: "Explanation of why this page should be deleted" },
          epicId: { type: "string", description: "Optional: the epic that triggered this deletion request" },
          curationId: { type: "string", description: "Optional: the curation run that triggered this" },
        },
        required: ["topicId", "reason"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        const reason = args.reason as string;
        if (!topicId || !reason) return "topicId and reason are required.";
        try {
          await wikiService.addPendingDeletion(projectId, {
            topicId,
            requestedBy: "agent",
            requestedAt: new Date().toISOString(),
            reason,
            epicId: args.epicId as string | undefined,
            curationId: args.curationId as string | undefined,
          });
          return `Deletion of '${topicId}' queued for human approval. The page remains unchanged until approved.`;
        } catch (err) {
          return `Failed to request deletion of "${topicId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    write_epic_wiki_page: {
      description:
        "Create or update an epic-scoped research wiki page. Epic wiki pages contain " +
        "research synthesis — information gathered from external sources, NOT code knowledge. " +
        "Use list_epic_wiki_pages to see existing pages before creating new ones.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          pageId: { type: "string", description: "Page slug (kebab-case)" },
          title: { type: "string", description: "Human-readable page title" },
          content: { type: "string", description: "Full markdown content" },
          sourceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Optional: source IDs that contributed to this page",
          },
        },
        required: ["epicId", "pageId", "title", "content"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const pageId = args.pageId as string;
        const title = args.title as string;
        const content = args.content as string;
        if (!epicId || !pageId || !title || !content) return "epicId, pageId, title, and content are required.";
        try {
          const page = await epicKnowledgeService.writeEpicWikiPage(
            projectId, epicId, pageId, title, content,
            args.sourceRefs as string[] | undefined,
          );
          return `Epic wiki page "${title}" (${pageId}) written successfully. Word count: ${page.wordCount}`;
        } catch (err) {
          return `Failed to write epic wiki page: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    create_concept: {
      description:
        "Create a new domain concept. Concepts represent key abstractions, patterns, " +
        "and vocabulary discovered in the codebase.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concept name" },
          category: {
            type: "string",
            description: "Category: architecture, backend, frontend, data, devops, cross-cutting, features, other",
          },
          description: { type: "string", description: "Description of the concept" },
          relatedConcepts: {
            type: "array",
            items: { type: "string" },
            description: "Optional: IDs of related concepts",
          },
        },
        required: ["name", "category", "description"],
      },
      execute: async (args) => {
        const name = args.name as string;
        const category = args.category as string;
        const description = args.description as string;
        if (!name || !category || !description) return "name, category, and description are required.";
        try {
          const concept = conceptService.createConcept(projectId, {
            name, category, description,
            relatedConcepts: args.relatedConcepts as string[] | undefined,
          });
          return `Concept "${name}" created with ID: ${concept.id}`;
        } catch (err) {
          return `Failed to create concept: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    update_concept: {
      description:
        "Update an existing domain concept. Use list_concepts to find concept IDs. " +
        "Only provided fields are updated.",
      inputSchema: {
        type: "object",
        properties: {
          conceptId: { type: "string", description: "The concept ID to update" },
          name: { type: "string", description: "New name (optional)" },
          description: { type: "string", description: "New description (optional)" },
          category: { type: "string", description: "New category (optional)" },
        },
        required: ["conceptId"],
      },
      execute: async (args) => {
        const conceptId = args.conceptId as string;
        if (!conceptId) return "conceptId is required.";
        try {
          const updated = conceptService.updateConcept(projectId, conceptId, {
            name: args.name as string | undefined,
            description: args.description as string | undefined,
            category: args.category as string | undefined,
          });
          if (!updated) return `Concept "${conceptId}" not found.`;
          return `Concept "${updated.name}" updated successfully.`;
        } catch (err) {
          return `Failed to update concept: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    add_scope_entry: {
      description:
        "Add a topic to an epic's scope. The scope tracks which topics are relevant " +
        "to the epic and their enrichment depth targets.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topicId: { type: "string", description: "The topic slug to add" },
          topicTitle: { type: "string", description: "Human-readable topic title" },
          type: {
            type: "string",
            description: "Topic type: existing-wiki or new",
          },
          targetDepth: {
            type: "string",
            description: "Target enrichment depth: none, stub, outline, developed, comprehensive",
          },
          currentDepth: {
            type: "string",
            description: "Current enrichment depth (defaults to 'none')",
          },
        },
        required: ["epicId", "topicId", "topicTitle", "type", "targetDepth"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topicId = args.topicId as string;
        const topicTitle = args.topicTitle as string;
        const type = args.type as "existing-wiki" | "new";
        const targetDepth = args.targetDepth as TopicDepth;
        const currentDepth = (args.currentDepth as TopicDepth) ?? "none";
        if (!epicId || !topicId || !topicTitle || !type || !targetDepth) {
          return "epicId, topicId, topicTitle, type, and targetDepth are required.";
        }
        try {
          const added = await epicService.addScopeEntry(projectId, epicId, {
            topicId, topicTitle, type,
            source: "agent",
            included: true,
            targetDepth,
            currentDepth,
          });
          if (!added) return `Topic "${topicId}" already exists in scope for epic "${epicId}".`;
          return `Added "${topicTitle}" to epic scope with target depth "${targetDepth}".`;
        } catch (err) {
          return `Failed to add scope entry: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    update_scope_entry: {
      description:
        "Update a scope entry for an epic. Use this to track enrichment progress " +
        "by updating currentDepth after enriching a topic.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topicId: { type: "string", description: "The topic ID in scope to update" },
          included: { type: "boolean", description: "Whether the topic is still included" },
          targetDepth: { type: "string", description: "Updated target depth" },
          currentDepth: { type: "string", description: "Current enrichment depth after enrichment" },
        },
        required: ["epicId", "topicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topicId = args.topicId as string;
        if (!epicId || !topicId) return "epicId and topicId are required.";
        try {
          const changes: Record<string, unknown> = {};
          if (args.included !== undefined) changes.included = args.included;
          if (args.targetDepth) changes.targetDepth = args.targetDepth;
          if (args.currentDepth) {
            changes.currentDepth = args.currentDepth;
            changes.enrichedAt = new Date().toISOString();
          }
          const updated = await epicService.updateScopeEntry(projectId, epicId, topicId, changes);
          if (!updated) return `Scope entry "${topicId}" not found in epic "${epicId}".`;
          return `Scope entry "${topicId}" updated. Current depth: ${updated.currentDepth ?? "unchanged"}.`;
        } catch (err) {
          return `Failed to update scope entry: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    add_curation_reason: {
      description:
        "Register a curation trigger reason. Reasons accumulate until a curation " +
        "run processes them. Use this when you detect changes that warrant curation.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          type: {
            type: "string",
            description: "Reason type: definition_changed, code_delta_processed, research_sources_added, human_content_added, blocked_download_resolved, research_topics_changed, manual",
          },
          detail: { type: "string", description: "Human-readable detail about the reason" },
        },
        required: ["epicId", "type", "detail"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const type = args.type as CurationReasonType;
        const detail = args.detail as string;
        if (!epicId || !type || !detail) return "epicId, type, and detail are required.";
        try {
          await curationService.addReason(projectId, epicId, {
            type, at: new Date().toISOString(), detail,
          });
          return `Curation reason "${type}" added for epic "${epicId}".`;
        } catch (err) {
          return `Failed to add curation reason: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    trigger_curation: {
      description:
        "Trigger a curation run for an epic. This kicks off the curation pipeline " +
        "which processes pending reasons and enriches wiki pages. The pipeline runs " +
        "asynchronously — the UI will show a progress banner automatically. " +
        "Always call get_curation_status first to check pending reasons before triggering.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID to curate" },
          modelId: { type: "string", description: "The model ID to use for curation (use the same model you are running on)" },
        },
        required: ["epicId", "modelId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const modelId = args.modelId as string;
        if (!epicId) return "epicId is required.";
        if (!modelId) return "modelId is required. Pass the model ID you are running on.";

        // Check if already running via build state
        const scope = `curation::${epicId}`;
        const existing = buildStateService.getBuildState(projectId, scope);
        if (existing?.status === "building") {
          return `Curation is already running for this epic (run ${existing.runId}). The UI should show a progress banner.`;
        }

        // Fire the curation pipeline via the curation service
        const result = await services.curation.triggerCurationPipeline(projectId, epicId, modelId);

        if (!result.success) {
          return `Failed to start curation: ${result.error ?? "Unknown error"}`;
        }

        return `Curation pipeline started for epic "${epicId}". The UI will show a progress ` +
          `banner with live step-by-step updates. Pending curation reasons are being processed.`;
      },
    },

    trigger_research: {
      description:
        "Start autonomous research for specific topics. The research pipeline searches " +
        "the web, downloads content, and processes sources into epic wiki pages.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to research",
          },
        },
        required: ["epicId", "topics"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topics = args.topics as string[];
        if (!epicId || !topics?.length) return "epicId and topics are required.";
        // Research pipeline runs via SSE — direct to the API
        return `Research pipeline for epic "${epicId}" on topics [${topics.join(", ")}] ` +
          `should be triggered via the UI or ` +
          `POST /api/codascope/projects/${projectId}/epics/${epicId}/knowledge/research. ` +
          `The pipeline runs autonomously: plan → download → process.`;
      },
    },

    search_web: {
      description:
        "Search the web for research content. Returns web search results " +
        "with titles, URLs, and snippets that can inform research plans.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        if (!query) return "query is required.";

        try {
          const results = await searchWeb(query);

          if (results.length === 0) {
            return `No web search results found for "${query}". Try a different or broader query.`;
          }

          // Format results
          const formatted = results.map((r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
          ).join("\n\n");

          return `Web search results for "${query}":\n\n${formatted}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Web search failed: ${msg}. Try again or use a different query.`;
        }
      },
    },

    create_annotation: {
      description:
        "Create an annotation (comment thread) on a specific block of a design document. " +
        "Use this to suggest improvements, flag gaps, or reference research findings. " +
        "The annotation will appear inline next to the referenced block.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          documentId: { type: "string", description: "The design document ID" },
          blockId: { type: "string", description: "The block ID to annotate (from read_design_doc)" },
          body: { type: "string", description: "Annotation content (supports markdown)" },
          category: {
            type: "string",
            enum: ["suggestion", "question", "gap", "research-ref"],
            description: "Annotation category",
          },
        },
        required: ["epicId", "documentId", "blockId", "body"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const documentId = args.documentId as string;
        const blockId = args.blockId as string;
        const body = args.body as string;
        const category = args.category as string | undefined;
        if (!epicId || !documentId || !blockId || !body) {
          return "epicId, documentId, blockId, and body are required.";
        }
        try {
          const categoryPrefix = category ? `[${category}] ` : "";
          const annotation = await annotationService.createAnnotation(projectId, epicId, documentId, {
            anchor: {
              blockId,
              sectionSlug: "",
              anchorText: "",
              lineNumber: 0,
            },
            author: "agent",
            body: `${categoryPrefix}${body}`,
          });
          return `Annotation created (ID: ${annotation.id}) on block "${blockId}" in document "${documentId}".`;
        } catch (err) {
          return `Failed to create annotation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── New Read Tools ──────────────────────────────────────────────

    list_epic_wiki_pages: {
      description:
        "List all epic-scoped research wiki pages for an epic. These contain " +
        "research synthesis — different from main wiki pages which are code knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const pages = await epicKnowledgeService.listEpicWikiPages(projectId, epicId);
          if (pages.length === 0) return `No epic wiki pages exist yet for epic "${epicId}".`;
          return JSON.stringify(pages, null, 2);
        } catch {
          return `Failed to list epic wiki pages for "${epicId}".`;
        }
      },
    },

    read_epic_wiki_page: {
      description:
        "Read the full content of an epic wiki page. These pages contain research " +
        "synthesis for the epic.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          pageId: { type: "string", description: "The page ID (slug)" },
        },
        required: ["epicId", "pageId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const pageId = args.pageId as string;
        if (!epicId || !pageId) return "epicId and pageId are required.";
        try {
          const content = await epicKnowledgeService.readEpicWikiPage(projectId, epicId, pageId);
          if (content === null) return `Epic wiki page "${pageId}" not found in epic "${epicId}".`;
          return content;
        } catch {
          return `Failed to read epic wiki page "${pageId}".`;
        }
      },
    },

    list_research_sources: {
      description:
        "List all research sources (downloaded and uploaded) for an epic. Shows title, " +
        "type, status, URL, and topic associations.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const sources = await epicKnowledgeService.listSources(projectId, epicId);
          if (sources.length === 0) return `No research sources exist for epic "${epicId}".`;
          return JSON.stringify(
            sources.map((s) => ({
              id: s.id,
              title: s.title,
              type: s.type,
              origin: s.origin,
              status: s.status,
              url: s.url,
              filename: s.filename,
              topicAssociations: s.topicAssociations,
              addedAt: s.addedAt,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to list research sources for "${epicId}".`;
        }
      },
    },

    read_research_source: {
      description:
        "Read the extracted markdown content of a research source. Use list_research_sources " +
        "first to discover source IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          sourceId: { type: "string", description: "The source ID" },
        },
        required: ["epicId", "sourceId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const sourceId = args.sourceId as string;
        if (!epicId || !sourceId) return "epicId and sourceId are required.";
        try {
          const content = await epicKnowledgeService.getSourceContent(projectId, epicId, sourceId);
          if (!content.markdown) {
            return `Source "${sourceId}" has no extracted markdown yet (may still be processing).`;
          }
          return content.markdown;
        } catch {
          return `Failed to read source "${sourceId}".`;
        }
      },
    },

    get_curation_status: {
      description:
        "Get the current curation status for an epic: pending reasons and latest " +
        "curation log summary.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const reasons = await curationService.getReasons(projectId, epicId);
          const latestLog = await curationService.getLatestLog(projectId, epicId);

          const result: Record<string, unknown> = {
            pendingReasons: reasons.length,
            reasons: reasons.map((r) => ({ type: r.type, detail: r.detail, at: r.at })),
          };

          if (latestLog) {
            result.lastCuration = {
              curationId: latestLog.curationId,
              status: latestLog.status,
              triggeredAt: latestLog.triggeredAt,
              completedAt: latestLog.completedAt,
              durationMs: latestLog.durationMs,
              results: latestLog.results,
            };
          } else {
            result.lastCuration = null;
          }

          return JSON.stringify(result, null, 2);
        } catch {
          return `Failed to get curation status for "${epicId}".`;
        }
      },
    },

    // ── Design Doc Write Tools (Reimagined) ─────────────────────────

    create_design_doc: {
      description:
        "Create a new design document within the current epic. The document will appear " +
        "in the Design tab and the user will be notified via an action tag. Always provide " +
        "substantial initial content — never create empty documents.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID to create the doc in" },
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Full markdown content for the document" },
        },
        required: ["epicId", "title", "content"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const title = args.title as string;
        const content = args.content as string;
        if (!epicId || !title || !content) return "epicId, title, and content are required.";
        try {
          const doc = await designDocService.createDesignDoc(projectId, epicId, {
            title,
            content,
            createdBy: "agent",
          });
          // Emit action tag for frontend auto-navigation
          const resultText = `Created design document "${title}" (ID: ${doc.id}) with ${doc.wordCount} words.\n\n` +
            `<codascope_action type="design_doc_created" epicId="${epicId}" docId="${doc.id}">\n` +
            `Created design document "${title}"\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to create design doc: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    edit_design_doc: {
      description:
        "Replace the entire content of a design document. Use edit_design_doc_section " +
        "for targeted edits. Always read the document first before editing.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          docId: { type: "string", description: "The design document ID" },
          content: { type: "string", description: "Full replacement markdown content" },
          editSummary: { type: "string", description: "Brief description of what changed (for version history)" },
        },
        required: ["epicId", "docId", "content", "editSummary"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const docId = args.docId as string;
        const content = args.content as string;
        const editSummary = args.editSummary as string;
        if (!epicId || !docId || !content || !editSummary) {
          return "epicId, docId, content, and editSummary are required.";
        }
        try {
          // Create a version snapshot before editing (Phase 4: version history)
          try { await designDocService.createVersion(projectId, epicId, docId, "agent", editSummary); } catch { /* best effort */ }
          const updated = await designDocService.updateDesignDoc(projectId, epicId, docId, content);
          if (!updated) return `Design doc "${docId}" not found in epic "${epicId}".`;
          if ("conflict" in updated) return `Design doc "${docId}" was modified concurrently. Please re-read and retry.`;

          const resultText = `Updated design document "${updated.doc.title}" — ${updated.doc.wordCount} words. Summary: ${editSummary}\n\n` +
            `<codascope_action type="design_doc_edited" epicId="${epicId}" docId="${docId}" summary="${editSummary}">\n` +
            `${editSummary}\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to edit design doc: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    edit_design_doc_section: {
      description:
        "Edit a specific section of a design document by replacing a range of lines. " +
        "Preferred over edit_design_doc for targeted changes. Read the document first " +
        "to determine the correct line range.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          docId: { type: "string", description: "The design document ID" },
          startLine: { type: "number", description: "Start line number (1-indexed)" },
          endLine: { type: "number", description: "End line number (1-indexed, inclusive)" },
          newContent: { type: "string", description: "Replacement content for the specified line range" },
          editSummary: { type: "string", description: "Brief description of what changed" },
        },
        required: ["epicId", "docId", "startLine", "endLine", "newContent", "editSummary"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const docId = args.docId as string;
        const startLine = args.startLine as number;
        const endLine = args.endLine as number;
        const newContent = args.newContent as string;
        const editSummary = args.editSummary as string;
        if (!epicId || !docId || !startLine || !endLine || newContent === undefined || !editSummary) {
          return "epicId, docId, startLine, endLine, newContent, and editSummary are required.";
        }
        try {
          const result = await designDocService.getDesignDoc(projectId, epicId, docId);
          if (!result) return `Design doc "${docId}" not found in epic "${epicId}".`;

          // Create a version snapshot before editing (Phase 4: version history)
          try { await designDocService.createVersion(projectId, epicId, docId, "agent", editSummary); } catch { /* best effort */ }

          const lines = result.content.split("\n");
          const before = lines.slice(0, startLine - 1);
          const after = lines.slice(endLine);
          const updatedContent = [...before, newContent, ...after].join("\n");

          const updated = await designDocService.updateDesignDoc(projectId, epicId, docId, updatedContent);
          if (!updated) return `Failed to update design doc "${docId}".`;
          if ("conflict" in updated) return `Design doc "${docId}" was modified concurrently. Please re-read and retry.`;

          const resultText = `Updated lines ${startLine}-${endLine} of "${updated.doc.title}". Summary: ${editSummary}\n\n` +
            `<codascope_action type="design_doc_edited" epicId="${epicId}" docId="${docId}" summary="${editSummary}" startLine="${startLine}" endLine="${endLine}">\n` +
            `${editSummary}\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to edit design doc section: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}
