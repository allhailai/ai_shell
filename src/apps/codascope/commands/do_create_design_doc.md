---
name: do_create_design_doc
description: Agent prompt for drafting an initial design document from a template with deep codebase context and research backing.
variables:
  - TEMPLATE_CONTENT
  - EPIC_DEFINITION
  - ENRICHED_WIKI_PAGES
  - CODE_MAP
  - CONCEPTS
  - EXISTING_DESIGN_DOCS
  - EPIC_WIKI_PAGES
  - RESEARCH_SOURCES
  - SCOPE_TOPICS
---

# Create Design Document

You are drafting a design document for an engineering epic. You have deep codebase context from enriched wiki pages, a code map, concept definitions, and curated research. Use this context to produce a substantive, populated design document — not placeholder text.

## Template

The following template defines the structure. Fill in every section with real, specific content:

{{TEMPLATE_CONTENT}}

## Epic Definition

This is the epic you are designing for:

{{EPIC_DEFINITION}}

## Existing Design Documents

These design documents already exist for this epic. Avoid duplicating their content. Reference them where relevant:

{{EXISTING_DESIGN_DOCS}}

## Codebase Context

### Enriched Wiki Pages

These wiki pages contain detailed analysis of the relevant codebase areas:

{{ENRICHED_WIKI_PAGES}}

### Code Map

Structural overview of the codebase:

{{CODE_MAP}}

### Concepts

Key concepts and patterns in this codebase:

{{CONCEPTS}}

## Curated Research Context

### Epic Wiki Pages

These pages synthesize research findings relevant to this epic. Reference specific findings, data points, and insights from these pages in your design:

{{EPIC_WIKI_PAGES}}

### Research Sources

These are the curated research sources that informed the epic wiki pages. Cite sources by name when you reference their findings:

{{RESEARCH_SOURCES}}

### Scope Topics with Depth

Current scope with enrichment depth. Pay special attention to topics with shallow coverage (currentDepth: "none" or "stub") — they represent areas where your design should acknowledge gaps:

{{SCOPE_TOPICS}}

## Instructions

1. **Read the template structure** — understand what each section expects
2. **Cross-reference with wiki pages** — use real file paths, interface names, and architectural patterns from the enriched wiki
3. **Ground in research** — reference specific findings from epic wiki pages and research sources. Don't make generic claims when curated evidence exists.
4. **Generate substantive content** — every section should contain specific, actionable information. No "TBD" or "describe X here" placeholders.
5. **Include diagrams** — use mermaid diagrams where the template calls for visual elements (architecture diagrams, data flow, entity relationships, dependency graphs)
6. **Reference real code** — cite actual file paths, function names, and interfaces from the wiki and code map
7. **Use wikilinks** — include `[[topic-id]]` wikilinks to relevant wiki topics throughout the document for cross-referencing
8. **Cite research sources** — when referencing research findings, cite the source (e.g., "Based on [source title]: ..." or "Research from [URL] indicates...")
9. **Consider existing design docs** — if other design documents exist, reference them and maintain consistency
10. **Surface trade-offs** — explicitly state alternatives considered and the rationale for your recommendations
11. **Flag scope gaps** — if the scope includes topics with shallow coverage ("none" or "stub" depth), note these as areas requiring further investigation
12. **Mark open questions** — use `- [ ]` checkboxes for items that need team discussion

## Output Format

Return only the populated design document content in markdown format. Do not wrap it in code fences or include any preamble — just the document itself.

Use `update_design_doc` action to save the content:

<codascope_action type="update_design_doc" epicId="{{EPIC_ID}}" docId="{{DOC_ID}}">
  Save the drafted design document
</codascope_action>
