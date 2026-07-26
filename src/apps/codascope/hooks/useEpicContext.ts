/* ── useEpicContext ─────────────────────────────────────────────────
   Encapsulates epic knowledge polling, curation status polling,
   and automatic conversation switching when navigating into an epic.

   Extracted from CodaScopeAssistant to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import type {
  AssistantChatMessage,
  ConversationSummary,
  EpicDesign,
} from "../codaScopeTypes";
import { createAssistantEndpointAdapter } from "../assistantConversationApi";

export interface EpicKnowledgeSummary {
  sourceCount: number;
  wikiPageCount: number;
  curationReasonCount: number;
  wikiPageTitles: Array<{ id: string; title: string }>;
}

export interface CurationStatus {
  running: boolean;
  step: string;
}

export interface UseEpicContextResult {
  /** The current epic ID from the URL, or null */
  currentEpicId: string | null;
  /** The current epic object, or null */
  currentEpic: EpicDesign | null;
  /** Epic knowledge summary (source/wiki/curation counts) */
  epicKnowledge: EpicKnowledgeSummary;
  /** Curation build status for the current epic */
  curationStatus: CurationStatus;
}

/* ── Hook ────────────────────────────────────────────────────────── */

export function useEpicContext(
  activeProjectId: string | null,
  setActiveConversationId: (id: string | null) => void,
  setActiveTitle: (title: string) => void,
  setMessages: React.Dispatch<React.SetStateAction<AssistantChatMessage[]>>,
  loadConversationList: () => Promise<ConversationSummary[]>,
): UseEpicContextResult {
  const { segments } = useAppSubRoute("codascope");
  const { epics } = useCodaScopeStore();

  // Detect if user is viewing an epic
  const currentEpicId = segments[2] === "epic" ? (segments[3] ?? null) : null;
  const currentEpic = currentEpicId ? (epics.find((e) => e.id === currentEpicId) ?? null) : null;
  const currentEpicIdRef = useRef<string | null>(null);

  // ── Epic knowledge summary ──────────────────────────────────────────

  const [epicKnowledge, setEpicKnowledge] = useState<EpicKnowledgeSummary>({
    sourceCount: 0,
    wikiPageCount: 0,
    curationReasonCount: 0,
    wikiPageTitles: [],
  });

  useEffect(() => {
    if (!activeProjectId || !currentEpicId) {
      setEpicKnowledge({ sourceCount: 0, wikiPageCount: 0, curationReasonCount: 0, wikiPageTitles: [] });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // Fetch sources, wiki pages, and curation reasons in parallel
        const [sourcesRes, wikiRes, reasonsRes] = await Promise.all([
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/knowledge/sources`),
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/knowledge/wiki`),
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/curation/reasons`),
        ]);
        if (cancelled) return;
        const sources = sourcesRes.ok ? await sourcesRes.json() : { sources: [] };
        const wiki = wikiRes.ok ? await wikiRes.json() : { pages: [] };
        const reasons = reasonsRes.ok ? await reasonsRes.json() : { reasons: [] };
        setEpicKnowledge({
          sourceCount: (sources.sources ?? []).length,
          wikiPageCount: (wiki.pages ?? []).length,
          curationReasonCount: (reasons.reasons ?? []).length,
          wikiPageTitles: (wiki.pages ?? []).map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })),
        });
      } catch {
        if (!cancelled) {
          setEpicKnowledge({ sourceCount: 0, wikiPageCount: 0, curationReasonCount: 0, wikiPageTitles: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, currentEpicId]);

  // ── Curation build-status poll ────────────────────────────────────

  const [curationStatus, setCurationStatus] = useState<CurationStatus>({
    running: false,
    step: "",
  });

  useEffect(() => {
    if (!activeProjectId || !currentEpicId) {
      setCurationStatus({ running: false, step: "" });
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/build-status?scope=curation::${currentEpicId}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const build = data.build;

        if (build?.status === "building") {
          const steps = build.pipelineSteps;
          let desc = "Curation in progress…";
          if (Array.isArray(steps) && steps.length > 0) {
            const latest = steps[steps.length - 1];
            desc = latest.detail ?? latest.label ?? latest.id ?? desc;
          }
          setCurationStatus({ running: true, step: desc });
        } else {
          setCurationStatus((prev) => prev.running ? { running: false, step: "" } : prev);
        }
      } catch { /* silent */ }
    };

    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => clearInterval(id);
  }, [activeProjectId, currentEpicId]);

  // ── Auto-switch to epic conversation ──────────────────────────────

  const loadConversationListStable = useCallback(() => loadConversationList(), [loadConversationList]);

  useEffect(() => {
    if (!activeProjectId || !currentEpicId || !currentEpic) {
      currentEpicIdRef.current = null;
      return;
    }
    if (currentEpicIdRef.current === currentEpicId) return;
    currentEpicIdRef.current = currentEpicId;

    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/conversation`,
        );
        if (res.ok) {
          const data = await res.json();
          const conv = data.conversation;
          setActiveConversationId(conv.id);
          setActiveTitle(conv.title || `Epic: ${currentEpic.title}`);
          // Load messages from the epic conversation
          const msgs = (conv.messages ?? [])
            .filter((m: AssistantChatMessage) => m.role === "user" || m.role === "assistant")
            .map((m: AssistantChatMessage) => {
              // Restore image URLs from metadata for conversation history
              const metaImages = m.metadata?.images as Array<{ path: string; filename: string }> | undefined;
              const endpoints = createAssistantEndpointAdapter({
                kind: "project",
                projectId: activeProjectId,
              });
              const images = metaImages?.map((img) => ({
                url: endpoints.displayImage(conv.id, img.filename),
                filename: img.filename,
              }));
              return {
                id: m.id,
                role: m.role,
                content: m.content,
                status: m.status ?? "complete",
                createdAt: m.createdAt,
                metadata: m.metadata,
                images,
              };
            });
          setMessages(msgs);
          // Update conversation list
          await loadConversationListStable();
        }
      } catch { /* silently fail */ }
    })();
  }, [activeProjectId, currentEpicId, currentEpic, setActiveConversationId, setActiveTitle, setMessages, loadConversationListStable]);

  return {
    currentEpicId,
    currentEpic,
    epicKnowledge,
    curationStatus,
  };
}
