/* ── Slash Command Extension ──────────────────────────────────────────
   Shared CM6 autocomplete extension that triggers a command menu when
   the user types "/" at the start of a line or after whitespace.

   Commands: /heading (/h1–/h6), /todo, /table, /link, /date

   Opt-in via MarkdownEditor prop `showSlashCommands`.
   ──────────────────────────────────────────────────────────────────── */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

// ── Today's date in ISO format ─────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10); // "2026-07-11"
}

// ── Slash command definitions ──────────────────────────────────────

interface SlashCommand {
  label: string;
  detail: string;
  apply: (view: EditorView, from: number, to: number) => void;
}

const slashCommands: SlashCommand[] = [
  {
    label: "/heading",
    detail: "Heading 1",
    apply: (view, from, to) => applyHeading(view, from, to, 1),
  },
  {
    label: "/h1",
    detail: "Heading 1",
    apply: (view, from, to) => applyHeading(view, from, to, 1),
  },
  {
    label: "/h2",
    detail: "Heading 2",
    apply: (view, from, to) => applyHeading(view, from, to, 2),
  },
  {
    label: "/h3",
    detail: "Heading 3",
    apply: (view, from, to) => applyHeading(view, from, to, 3),
  },
  {
    label: "/h4",
    detail: "Heading 4",
    apply: (view, from, to) => applyHeading(view, from, to, 4),
  },
  {
    label: "/h5",
    detail: "Heading 5",
    apply: (view, from, to) => applyHeading(view, from, to, 5),
  },
  {
    label: "/h6",
    detail: "Heading 6",
    apply: (view, from, to) => applyHeading(view, from, to, 6),
  },
  {
    label: "/todo",
    detail: "Task / Checkbox",
    apply: (view, from, to) => {
      const insert = "- [ ] ";
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
      });
    },
  },
  {
    label: "/table",
    detail: "2×2 Table",
    apply: (view, from, to) => {
      const table = [
        "| Column 1 | Column 2 |",
        "| -------- | -------- |",
        "|          |          |",
        "|          |          |",
      ].join("\n");
      view.dispatch({
        changes: { from, to, insert: table },
        selection: EditorSelection.cursor(from + 2), // position inside first header cell
      });
    },
  },
  {
    label: "/link",
    detail: "Hyperlink",
    apply: (view, from, to) => {
      const link = "[text](url)";
      view.dispatch({
        changes: { from, to, insert: link },
        selection: EditorSelection.range(from + 1, from + 5), // select "text"
      });
    },
  },
  {
    label: "/date",
    detail: "Today's date",
    apply: (view, from, to) => {
      const date = todayISO();
      view.dispatch({
        changes: { from, to, insert: date },
        selection: EditorSelection.cursor(from + date.length),
      });
    },
  },
];

// ── Heading helper ──────────────────────────────────────────────────

function applyHeading(view: EditorView, from: number, to: number, level: number): void {
  const { state } = view;
  const line = state.doc.lineAt(from);
  const lineText = line.text;

  // Strip existing heading prefix if any
  const headingMatch = /^(#{1,6})\s/.exec(lineText);
  const lineContentStart = headingMatch ? line.from + headingMatch[0].length : line.from;

  // The slash command itself occupies `from..to` — we want to replace
  // the slash command text and set the heading prefix on the line.
  // Strategy: replace from line start to `to` (end of slash command)
  // with the heading prefix + any text that was between line start and the slash.
  const textBeforeSlash = state.doc.sliceString(lineContentStart, from);
  const prefix = "#".repeat(level) + " ";
  const insert = prefix + textBeforeSlash;

  view.dispatch({
    changes: { from: line.from, to, insert },
    selection: EditorSelection.cursor(line.from + insert.length),
  });
}

// ── Completion source ───────────────────────────────────────────────

function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\/\w*/);
  if (!word) return null;

  // Only trigger if the "/" is at start of line or after whitespace
  if (word.from > 0) {
    const charBefore = context.state.doc.sliceString(word.from - 1, word.from);
    if (charBefore !== "\n" && charBefore !== " " && charBefore !== "\t") {
      // Check if it's at position 0 of the document
      if (word.from !== 0) return null;
    }
  }

  const options: Completion[] = slashCommands.map((cmd) => ({
    label: cmd.label,
    detail: cmd.detail,
    type: "keyword",
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      cmd.apply(view, from, to);
    },
  }));

  return {
    from: word.from,
    options,
    filter: true,
  };
}

// ── Extension entry point ───────────────────────────────────────────

export function buildSlashCommandExtension(): Extension {
  return autocompletion({
    override: [slashCommandSource],
    icons: false,
    optionClass: () => "cm-slash-command-option",
  });
}
