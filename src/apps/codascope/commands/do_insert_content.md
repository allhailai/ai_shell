---
name: do_insert_content
description: Generate content for an insertion directive at a specific location in a design document.
---

# Insert Content into Design Document

You are generating content for an **insertion directive** within a CodaScope epic design document.

## Context

**Epic Definition:**
{{EPIC_DEFINITION}}

**Full Document Content:**
```markdown
{{DOCUMENT_CONTENT}}
```

**Insertion Point:**
{{INSERTION_POINT}}

**User Instruction:**
{{INSTRUCTION}}

**Relevant Wiki Pages:**
{{RELEVANT_WIKI}}

**Code Map:**
{{CODE_MAP}}

## Your Task

Generate content that should be inserted at the specified location in the document. Follow these rules:

1. **Fit naturally** into the surrounding document context — match the tone, depth, and formatting of adjacent sections
2. **Reference actual code** — use real file paths, interface names, and architectural patterns from the wiki and code map
3. **Use proper markdown formatting**:
   - Mermaid diagrams for architecture/flow visualizations
   - Code fences with language tags for schemas and examples
   - Tables for structured comparisons
   - Bullet lists for enumerated points
4. **Be substantive** — don't write placeholder or TODO content; produce working-draft quality text
5. **Match the document's voice** — if the document uses first-person plural ("we"), do the same

## Output Format

Return **ONLY** the generated content. Do not include:
- The surrounding document context
- Metadata or explanations
- Markdown fence wrappers around your entire output

Your output will be spliced directly into the document at the insertion point.
