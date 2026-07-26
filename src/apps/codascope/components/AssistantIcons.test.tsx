import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconAgent, IconUser } from "./CodaScopeIcons";

describe("assistant chrome icons", () => {
  it("renders centralized SVG assistant and user avatars", () => {
    const agent = renderToStaticMarkup(createElement(IconAgent));
    const user = renderToStaticMarkup(createElement(IconUser));
    expect(agent).toContain("<svg");
    expect(user).toContain("<svg");
  });

  it("does not use robot or user emoji in assistant JSX", () => {
    const source = readFileSync(
      new URL("../CodaScopeAssistant.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain(String.fromCodePoint(0x1f916));
    expect(source).not.toContain(String.fromCodePoint(0x1f464));
    expect(source).toContain("<IconAgent");
    expect(source).toContain("<IconUser");
  });
});
