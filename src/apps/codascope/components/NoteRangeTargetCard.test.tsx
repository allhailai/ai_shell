import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NoteRangeHandoff } from "../noteRangeHandoff";
import { NoteRangeMessageReference } from "./NoteRangeMessageReference";
import { NoteRangeTargetCard } from "./NoteRangeTargetCard";

function handoff(
  status: NoteRangeHandoff["status"] = "staged",
  selectedText = "  Keep this spacing\nand this line.  ",
): NoteRangeHandoff {
  return {
    handoffId: "handoff-1",
    sourceId: "source-1",
    scopeKey: "workspace",
    status,
    target: {
      kind: "note-range",
      stableId: "note-1",
      scope: "codascope",
      visibility: "private",
      path: "notes/one.md",
      title: "One",
      selectionStart: 4,
      selectionEnd: 4 + selectedText.length,
      selectedText,
      startLine: 3,
      endLine: 4,
      expectedHash: "a".repeat(64),
    },
  };
}

function findButtons(node: ReactNode): Array<{
  props: {
    "aria-label"?: string;
    disabled?: boolean;
    onClick?: () => void;
  };
}> {
  const buttons: ReturnType<typeof findButtons> = [];
  function visit(value: ReactNode): void {
    Children.forEach(value, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === "button") {
        buttons.push(child as unknown as (typeof buttons)[number]);
      }
      visit((child.props as { children?: ReactNode }).children);
    });
  }
  visit(node);
  return buttons;
}

describe("NoteRangeTargetCard", () => {
  it("renders explicit bounded selection custody with accessible actions", () => {
    const text = `  ${"x".repeat(650)}\n  `;
    const remove = vi.fn();
    const quick = vi.fn();
    const element = NoteRangeTargetCard({
      handoff: handoff("staged", text),
      onRemove: remove,
      onQuickAction: quick,
      quickActionDisabled: false,
    });
    const html = renderToStaticMarkup(element);
    const buttons = findButtons(element);

    expect(html).toContain("Editing selection");
    expect(html).toContain("One");
    expect(html).toContain("CodaScope · notes/one.md");
    expect(html).toContain('title="One"');
    expect(html).toContain('title="CodaScope · notes/one.md"');
    expect(html).toContain("Lines 3–4");
    expect(html).toContain("The agent will edit only this selection.");
    expect(html).toContain("Do this");
    expect(html).toContain(`  ${"x".repeat(598)}…`);
    expect(html).not.toContain("x".repeat(599));
    expect(html).toContain("…");
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Remove selected range from One",
      "Apply the instruction in the selected text from One",
    ]);

    buttons[0].props.onClick?.();
    buttons[1].props.onClick?.();
    expect(remove).toHaveBeenCalledOnce();
    expect(quick).toHaveBeenCalledOnce();
  });

  it("locks remove and quick actions while the target is in flight", () => {
    const element = NoteRangeTargetCard({
      handoff: handoff("in-flight"),
      onRemove: vi.fn(),
      onQuickAction: vi.fn(),
      quickActionDisabled: false,
    });
    const html = renderToStaticMarkup(element);
    const buttons = findButtons(element);

    expect(html).toContain("Agent edit in progress");
    expect(html).toContain("Working…");
    expect(buttons.every((button) => button.props.disabled)).toBe(true);
  });
});

describe("NoteRangeMessageReference", () => {
  it("renders a bounded restored reference without making it interactive", () => {
    const text = "y".repeat(300);
    const value = {
      ...handoff("completed", text).target,
      endLine: 3,
    };
    const html = renderToStaticMarkup(
      <NoteRangeMessageReference value={value} />,
    );

    expect(html).toContain("Selected range from One");
    expect(html).toContain("Line 3");
    expect(html).toContain('title="One"');
    expect(html).toContain('title="CodaScope · notes/one.md"');
    expect(html).toContain("y".repeat(240));
    expect(html).not.toContain("y".repeat(241));
    expect(html).not.toContain("<button");
  });

  it("does not render malformed restored metadata", () => {
    expect(renderToStaticMarkup(
      <NoteRangeMessageReference value={{
        ...handoff().target,
        selectionEnd: 2,
      }} />,
    )).toBe("");
  });
});
