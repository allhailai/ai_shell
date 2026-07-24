import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownViewer } from "./MarkdownViewer";

describe("MarkdownViewer links", () => {
  it("renders a www Markdown destination as an external HTTPS link", () => {
    const markup = renderToStaticMarkup(createElement(MarkdownViewer, {
      content: "[Foo](www.cnn.com)",
    }));

    expect(markup).toContain('href="https://www.cnn.com"');
    expect(markup).toContain(">Foo</a>");
  });

  it("preserves internal CodaScope destinations", () => {
    const markup = renderToStaticMarkup(createElement(MarkdownViewer, {
      content: "[Project](/codascope/project/demo)",
    }));

    expect(markup).toContain('href="/codascope/project/demo"');
  });

  it("keeps unsafe destinations inert", () => {
    const markup = renderToStaticMarkup(createElement(MarkdownViewer, {
      content: "[Unsafe](javascript:alert(1))",
    }));

    expect(markup).toContain('href=""');
  });
});
