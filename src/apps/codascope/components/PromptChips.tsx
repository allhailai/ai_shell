/* ── CodaScope: PromptChips ──────────────────────────────────────────
   Context-aware prompt chips rendered above the chat input.
   Shows 2-3 contextual action suggestions based on the current
   view, epic state, and available data.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import type { EpicStatus } from "../codaScopeTypes";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface PromptChip {
  label: string;
  prompt: string;       // The message to send when clicked
  primary?: boolean;    // First chip gets primary styling
}

export interface PromptChipsProps {
  onSend: (prompt: string) => void;
  context: PromptChipContext;
}

export interface PromptChipContext {
  currentView: string;           // "define" | "scope" | "knowledge" | "design" | "history" | etc.
  hasDefinition: boolean;
  hasScope: boolean;
  hasResearch: boolean;
  hasCuratedKnowledge: boolean;
  curationReasonCount: number;
  epicStatus: EpicStatus | null;
  epicTab: string | null;        // the specific tab within an epic
  isEpicView: boolean;           // whether user is viewing an epic at all
}

/* ── Chip Resolution Logic ──────────────────────────────────────────── */

function resolveChips(context: PromptChipContext): PromptChip[] {
  const chips: PromptChip[] = [];

  // Epic-scoped context
  if (context.isEpicView && context.epicTab) {
    switch (context.epicTab) {
      case "define":
        if (!context.hasDefinition) {
          chips.push({
            label: "Start Interview",
            prompt: "Help me define this epic — let's start with the interview",
            primary: true,
          });
        } else {
          chips.push({
            label: "Refine Definition",
            prompt: "Review the current definition and suggest improvements",
            primary: true,
          });
          if (!context.hasScope) {
            chips.push({
              label: "Scope This Epic",
              prompt: "Analyze the definition and suggest a scope — identify relevant code areas and topics",
            });
          }
        }
        break;

      case "scope":
        if (context.hasScope) {
          chips.push({
            label: "Deepen Coverage",
            prompt: "Review the scope and identify topics that need deeper wiki coverage",
            primary: true,
          });
          chips.push({
            label: "Re-scan Scope",
            prompt: "Re-analyze the codebase and update the scope with any new relevant topics",
          });
        } else if (context.hasDefinition) {
          chips.push({
            label: "Generate Scope",
            prompt: "Analyze the definition and generate an initial scope of relevant code topics",
            primary: true,
          });
        }
        break;

      case "design":
        if (context.hasDefinition) {
          chips.push({
            label: "Suggest Design Docs",
            prompt: "Based on the epic definition and scope, suggest which design documents we should create",
            primary: true,
          });
          if (context.hasCuratedKnowledge) {
            chips.push({
              label: "Draft Based on Research",
              prompt: "Create a design document draft based on the curated knowledge and research",
            });
          }
        }
        break;

      case "history":
        chips.push({
          label: "Summarize Progress",
          prompt: "Summarize the current state and recent progress of this epic",
          primary: true,
        });
        break;

      default:
        break;
    }

    // Cross-tab chips for epic context
    if (context.curationReasonCount > 0 && chips.length < 3) {
      chips.push({
        label: `${context.curationReasonCount} Curation Trigger${context.curationReasonCount !== 1 ? "s" : ""}`,
        prompt: "Show me the pending curation reasons and run a curation pass",
      });
    }
  } else {
    // Non-epic views
    switch (context.currentView) {
      case "wiki":
        chips.push({
          label: "Explain This Topic",
          prompt: "Explain this wiki topic in detail — what does it do and how does it work?",
          primary: true,
        });
        chips.push({
          label: "Find Related Code",
          prompt: "Find the source code related to this topic and explain the key implementation details",
        });
        break;

      case "quality":
        chips.push({
          label: "Explain Top Issues",
          prompt: "Walk me through the top quality issues — what are they and how should I fix them?",
          primary: true,
        });
        break;

      case "dashboard":
        chips.push({
          label: "Project Overview",
          prompt: "Give me a quick overview of this project — what's it about and what's the current state?",
          primary: true,
        });
        break;

      default:
        break;
    }
  }

  // Cap at 3 chips
  return chips.slice(0, 3);
}

/* ── Component ───────────────────────────────────────────────────────── */

export function PromptChips({ onSend, context }: PromptChipsProps) {
  const chips = useMemo(() => resolveChips(context), [context]);

  if (chips.length === 0) return null;

  return (
    <div className="codascope-prompt-chips">
      {chips.map((chip) => (
        <button
          key={chip.label}
          className={`codascope-prompt-chip${chip.primary ? " codascope-prompt-chip-primary" : ""}`}
          onClick={() => onSend(chip.prompt)}
          type="button"
          title={chip.prompt}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
