/// <reference types="node" />

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Ts from "typescript";
import { describe, expect, it } from "vitest";

const ts: typeof import("typescript") = createRequire(import.meta.url)("typescript");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CODASCOPE_DIR = join(REPO_ROOT, "src/apps/codascope");
const TOKEN_FILE = join(REPO_ROOT, "src/styles/01-tokens.css");
const STYLE_FILES = [
  join(CODASCOPE_DIR, "codascope.css"),
  join(CODASCOPE_DIR, "CodaScopeAssistant.css"),
  join(CODASCOPE_DIR, "codascope-notes.css"),
];

const RAW_COLOR_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|\b(?:rgb|hsl)a?\s*\(/gi;
// CSS Color 4 §6.1 opaque named colors. `transparent` and `currentColor`
// are intentionally absent because they are allowed token-compatible keywords.
const CSS_NAMED_COLORS = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
  deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
  honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
  limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
  mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
  peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle
  tomato turquoise violet wheat white whitesmoke yellow yellowgreen
`
  .trim()
  .split(/\s+/);
const NAMED_COLOR_RE = new RegExp(
  `(?<![-\\w])(?:${CSS_NAMED_COLORS.join("|")})(?![-\\w])`,
  "gi",
);

interface Violation {
  file: string;
  line: number;
  value: string;
}

function displayPath(file: string): string {
  return relative(REPO_ROOT, file);
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map(({ file, line, value }) => `${displayPath(file)}:${line}: ${value}`)
    .join("\n");
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

function regexViolations(
  file: string,
  source: string,
  pattern: RegExp,
): Violation[] {
  return [...source.matchAll(pattern)].map((match) => ({
    file,
    line: lineAt(source, match.index ?? 0),
    value: match[0],
  }));
}

function declarationValueViolations(
  file: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const declarationRe = /(^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]+)/gm;

  for (const match of source.matchAll(declarationRe)) {
    const value = match[3];
    NAMED_COLOR_RE.lastIndex = 0;
    for (const named of value.matchAll(NAMED_COLOR_RE)) {
      const offset = (match.index ?? 0) + match[0].indexOf(value) + (named.index ?? 0);
      violations.push({
        file,
        line: lineAt(source, offset),
        value: `${match[2]}: ${named[0]}`,
      });
    }
  }

  return violations;
}

function resetColorPatterns(): void {
  RAW_COLOR_RE.lastIndex = 0;
  NAMED_COLOR_RE.lastIndex = 0;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function topLevelComma(value: string): number {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) return index;
  }
  return -1;
}

function literalFallbackViolations(
  file: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const start = source.indexOf("var(", searchFrom);
    if (start === -1) break;
    const end = findMatchingParen(source, start + 3);
    if (end === -1) {
      searchFrom = start + 4;
      continue;
    }

    const body = source.slice(start + 4, end);
    const comma = topLevelComma(body);
    if (comma !== -1) {
      const fallback = body.slice(comma + 1).trim();
      resetColorPatterns();
      if (RAW_COLOR_RE.test(fallback) || NAMED_COLOR_RE.test(fallback)) {
        violations.push({
          file,
          line: lineAt(source, start),
          value: `literal var() fallback: ${fallback}`,
        });
      }
    }

    searchFrom = end + 1;
  }

  return violations;
}

function shellColorDefinitions(): Set<string> {
  const source = stripCssComments(readFileSync(TOKEN_FILE, "utf8"));
  return new Set(
    [...source.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
}

function unresolvedShellTokenViolations(
  file: string,
  source: string,
  definitions: Set<string>,
): Violation[] {
  const violations: Violation[] = [];
  for (const match of source.matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) {
    if (!definitions.has(match[1])) {
      violations.push({
        file,
        line: lineAt(source, match.index ?? 0),
        value: `undefined shell color token ${match[1]}`,
      });
    }
  }
  return violations;
}

interface AliasDefinition {
  file: string;
  index: number;
  value: string;
}

function codaScopeAliasViolations(
  sources: Map<string, string>,
  shellDefinitions: Set<string>,
): Violation[] {
  const definitions = new Map<string, AliasDefinition>();
  const references: Array<{ file: string; index: number; name: string }> = [];

  for (const [file, source] of sources) {
    for (const match of source.matchAll(/(--codascope-[a-z0-9-]+)\s*:\s*([^;{}]+)/g)) {
      definitions.set(match[1], {
        file,
        index: match.index ?? 0,
        value: match[2].trim(),
      });
    }
    for (const match of source.matchAll(/var\(\s*(--codascope-[a-z0-9-]+)/g)) {
      references.push({ file, index: match.index ?? 0, name: match[1] });
    }
  }

  const violations: Violation[] = [];
  for (const reference of references) {
    if (!definitions.has(reference.name)) {
      violations.push({
        file: reference.file,
        line: lineAt(sources.get(reference.file) ?? "", reference.index),
        value: `undefined CodaScope color alias ${reference.name}`,
      });
    }
  }

  const resolvesToShellColor = (
    name: string,
    visiting = new Set<string>(),
  ): boolean => {
    if (visiting.has(name)) return false;
    const definition = definitions.get(name);
    if (!definition) return false;
    const nextVisiting = new Set(visiting).add(name);
    const refs = [
      ...definition.value.matchAll(/var\(\s*(--(?:color|codascope)-[a-z0-9-]+)/g),
    ].map((match) => match[1]);
    return (
      refs.length > 0 &&
      refs.every(
        (reference) =>
          shellDefinitions.has(reference) ||
          (reference.startsWith("--codascope-") &&
            resolvesToShellColor(reference, nextVisiting)),
      )
    );
  };

  for (const [name, definition] of definitions) {
    resetColorPatterns();
    if (
      RAW_COLOR_RE.test(definition.value) ||
      NAMED_COLOR_RE.test(definition.value) ||
      !resolvesToShellColor(name)
    ) {
      violations.push({
        file: definition.file,
        line: lineAt(sources.get(definition.file) ?? "", definition.index),
        value: `${name} must derive only from authoritative shell color tokens`,
      });
    }
  }

  return violations;
}

function walkSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(path));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function propertyName(node: Ts.Node): string | undefined {
  let current: Ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      return current.name.getText().replace(/^["']|["']$/g, "");
    }
    if (ts.isJsxAttribute(current)) return current.name.getText();
    if (
      ts.isVariableDeclaration(current) ||
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function isNativeColorInputDefault(node: Ts.Node): boolean {
  const attribute = node.parent;
  if (!attribute || !ts.isJsxAttribute(attribute) || attribute.name.getText() !== "value") {
    return false;
  }
  const opening = attribute.parent.parent;
  if (!opening || !ts.isJsxSelfClosingElement(opening)) return false;
  const typeAttribute = opening.attributes.properties.find(
    (candidate): candidate is Ts.JsxAttribute =>
      ts.isJsxAttribute(candidate) && candidate.name.getText() === "type",
  );
  return (
    opening.tagName.getText() === "input" &&
    typeAttribute?.initializer !== undefined &&
    ts.isStringLiteral(typeAttribute.initializer) &&
    typeAttribute.initializer.text === "color"
  );
}

function isAllowedContentColor(
  file: string,
  node: Ts.Node,
): boolean {
  const path = displayPath(file);
  const field = propertyName(node);
  if (
    path.endsWith("components/NoteFormattingToolbar.test.ts") ||
    path.endsWith("codaScopeStyleTokens.test.ts")
  ) {
    return true;
  }
  if (path.endsWith("manifest.tsx")) return field === "accentColor";
  if (path.endsWith("components/NoteFormattingToolbar.tsx")) {
    return field === "cssColor";
  }
  if (path.endsWith("views/Settings.tsx")) {
    return field === "cssColor" || isNativeColorInputDefault(node);
  }
  return false;
}

function productionColorLiteralViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkSourceFiles(CODASCOPE_DIR)) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: Ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        const value = node.getText(sourceFile);
        RAW_COLOR_RE.lastIndex = 0;
        if (RAW_COLOR_RE.test(value) && !isAllowedContentColor(file, node)) {
          violations.push({
            file,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            value: `unapproved TS/TSX color literal ${value}`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

function inlineStyleColorViolationsForSource(
  file: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: Ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      const value = node.initializer.expression.getText(sourceFile);
      resetColorPatterns();
      const match = RAW_COLOR_RE.exec(value) ?? NAMED_COLOR_RE.exec(value);
      if (match) {
        violations.push({
          file,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          value: `inline style color ${match[0]}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function inlineStyleColorViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walkSourceFiles(CODASCOPE_DIR)) {
    violations.push(
      ...inlineStyleColorViolationsForSource(
        file,
        readFileSync(file, "utf8"),
      ),
    );
  }
  return violations;
}

function paletteValues(file: string, variableName: string): string[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let values: string[] | undefined;

  const visit = (node: Ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === variableName &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      values = node.initializer.elements.flatMap((element) => {
        if (!ts.isObjectLiteralExpression(element)) return [];
        const color = element.properties.find(
          (property): property is Ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile) === "cssColor",
        );
        return color?.initializer && ts.isStringLiteral(color.initializer)
          ? [color.initializer.text]
          : [];
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values ?? [];
}

describe("CSS named-color detector", () => {
  const rejectedColors = [
    "cyan",
    "gold",
    "navy",
    "teal",
    "lime",
    "magenta",
    "rebeccapurple",
    "RebeccaPurple",
  ];
  const allowedKeywords = [
    "transparent",
    "currentColor",
    "TRANSPARENT",
    "CURRENTCOLOR",
    "inherit",
    "none",
  ];

  it("contains the complete CSS Color 4 opaque named-color set", () => {
    expect(CSS_NAMED_COLORS).toHaveLength(148);
    expect(new Set(CSS_NAMED_COLORS).size).toBe(148);
  });

  it.each(rejectedColors)(
    "rejects the named color %s in CSS declarations and inline styles",
    (color) => {
      const cssViolations = declarationValueViolations(
        "synthetic.css",
        `.sample { color: ${color}; }`,
      );
      const inlineViolations = inlineStyleColorViolationsForSource(
        "Synthetic.tsx",
        `export const Sample = () => <div style={{ color: "${color}" }} />;`,
      );

      expect(cssViolations).toHaveLength(1);
      expect(cssViolations[0]?.value.toLowerCase()).toContain(
        color.toLowerCase(),
      );
      expect(inlineViolations).toHaveLength(1);
      expect(inlineViolations[0]?.value.toLowerCase()).toContain(
        color.toLowerCase(),
      );
    },
  );

  it.each(allowedKeywords)(
    "allows the token-compatible keyword %s in CSS declarations and inline styles",
    (keyword) => {
      expect(
        declarationValueViolations(
          "synthetic.css",
          `.sample { color: ${keyword}; }`,
        ),
      ).toEqual([]);
      expect(
        inlineStyleColorViolationsForSource(
          "Synthetic.tsx",
          `export const Sample = () => <div style={{ color: "${keyword}" }} />;`,
        ),
      ).toEqual([]);
    },
  );

  it("does not mistake non-color identifiers for named-color values", () => {
    expect(
      declarationValueViolations(
        "synthetic.css",
        ".sample { white-space: nowrap; color: var(--color-gold); }",
      ),
    ).toEqual([]);
  });
});

describe("CodaScope UI color token contract", () => {
  const sources = new Map(
    STYLE_FILES.map((file) => [
      file,
      stripCssComments(readFileSync(file, "utf8")),
    ]),
  );

  it("contains no raw or named visual colors in active CSS declarations", () => {
    const violations = [...sources].flatMap(([file, source]) => [
      ...regexViolations(file, source, RAW_COLOR_RE),
      ...declarationValueViolations(file, source),
    ]);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("contains no literal color fallbacks in var() expressions", () => {
    const violations = [...sources].flatMap(([file, source]) =>
      literalFallbackViolations(file, source),
    );
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("resolves shell color references and token-derived CodaScope aliases", () => {
    const shellDefinitions = shellColorDefinitions();
    const violations = [
      ...[...sources].flatMap(([file, source]) =>
        unresolvedShellTokenViolations(file, source, shellDefinitions),
      ),
      ...codaScopeAliasViolations(sources, shellDefinitions),
    ];
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("keeps hard-coded production colors inside the persisted-content exceptions", () => {
    const violations = [
      ...productionColorLiteralViolations(),
      ...inlineStyleColorViolations(),
    ];
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("uses the warning-token class for the projects-root warning title", () => {
    const projectList = readFileSync(
      join(CODASCOPE_DIR, "views/ProjectList.tsx"),
      "utf8",
    );
    const primaryStyles = sources.get(STYLE_FILES[0]) ?? "";
    expect(projectList).toContain(
      'className="codascope-modal-title codascope-modal-title-warning"',
    );
    expect(primaryStyles).toMatch(
      /\.codascope-modal-title-warning\s*\{[^}]*color:\s*var\(--color-warning\)/,
    );
  });

  it("preserves persisted note and settings color values exactly", () => {
    const toolbar = join(
      CODASCOPE_DIR,
      "components/NoteFormattingToolbar.tsx",
    );
    const settings = join(CODASCOPE_DIR, "views/Settings.tsx");

    expect(paletteValues(toolbar, "DEFAULT_HIGHLIGHT_COLORS")).toEqual([
      "hsla(45, 90%, 55%, 0.5)",
      "hsla(0, 80%, 55%, 0.5)",
      "hsla(140, 70%, 45%, 0.5)",
      "hsla(220, 80%, 55%, 0.5)",
      "hsla(270, 70%, 55%, 0.5)",
      "hsla(30, 90%, 55%, 0.5)",
      "hsla(330, 80%, 55%, 0.5)",
      "hsla(180, 70%, 45%, 0.5)",
    ]);
    expect(paletteValues(toolbar, "DEFAULT_TEXT_COLORS")).toEqual([
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
      "#3b82f6",
      "#a855f7",
      "#ec4899",
    ]);
    expect(paletteValues(settings, "DEFAULT_HIGHLIGHT_PALETTE")).toEqual([
      "hsla(45, 90%, 55%, 0.5)",
      "hsla(0, 80%, 55%, 0.5)",
      "hsla(140, 70%, 45%, 0.5)",
    ]);
    expect(readFileSync(settings, "utf8")).toMatch(
      /<input[\s\S]*?type="color"[\s\S]*?value="#ff9900"/,
    );
  });
});
