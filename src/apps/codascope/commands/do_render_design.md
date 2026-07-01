# Render Design Document as HTML

You are generating a **polished, self-contained HTML document** from a design document's markdown source.

## Epic Context

**Epic**: {{EPIC_TITLE}}
**Document**: {{DOCUMENT_TITLE}}

## Source Markdown

```markdown
{{DOCUMENT_CONTENT}}
```

## Your Task

Transform the markdown above into a **beautiful, self-contained HTML document**. The output must be a complete `<!DOCTYPE html>` document with all styles inline (no external CSS files except CDN libraries).

### Requirements

1. **Self-contained**: All CSS must be embedded in `<style>` tags. Only CDN dependencies allowed:
   - Mermaid.js for diagram rendering: `https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js`
   - highlight.js for syntax highlighting (optional): `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/`

2. **Design quality**: The document should look like a professional engineering design doc, not raw markdown:
   - Dark theme (matching CodaScope's aesthetic)
   - Clean typography with good whitespace
   - Syntax-highlighted code blocks
   - Rendered mermaid diagrams (use `<div class="mermaid">` blocks)
   - Styled tables with alternating row colors
   - Blockquotes with accent borders
   - Collapsible sections for detailed content (use `<details>/<summary>`)

3. **Interactive elements**:
   - Table of contents with anchor links
   - Smooth scroll to sections
   - Collapsible sections where appropriate

4. **Print-friendly**: Include a `@media print` section that switches to light theme

5. **No external images**: Don't reference external images. Mermaid diagrams should render inline.

## Output Format

Return ONLY the complete HTML document — no markdown wrapping, no explanation. Start with `<!DOCTYPE html>` and end with `</html>`.
