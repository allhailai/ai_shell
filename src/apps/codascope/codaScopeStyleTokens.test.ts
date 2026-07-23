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

const RAW_COLOR_PATTERN =
  String.raw`#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(`;
const MODERN_COLOR_FUNCTIONS = [
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
] as const;
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
const NAMED_COLOR_PATTERN =
  `(?<![-\\w])(?:${CSS_NAMED_COLORS.join("|")})(?![-\\w])`;

interface ColorLiteralMatch {
  index: number;
  value: string;
}

interface AliasDefinition {
  file: string;
  index: number;
  value: string;
}

interface ColorTokenContext {
  shellDefinitions: Set<string>;
  aliasDefinitions: Map<string, AliasDefinition>;
}

const EMPTY_COLOR_TOKEN_CONTEXT: ColorTokenContext = {
  shellDefinitions: new Set(),
  aliasDefinitions: new Map(),
};

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

function maskCssStringsAndUrls(value: string): string {
  const masked = value.split("");
  let index = 0;

  const maskRange = (start: number, end: number): void => {
    for (let cursor = start; cursor < end; cursor += 1) {
      masked[cursor] = " ";
    }
  };

  while (index < value.length) {
    const quote = value[index];
    if (quote === "'" || quote === '"') {
      const start = index;
      index += 1;
      while (index < value.length) {
        if (value[index] === "\\") {
          index += 2;
          continue;
        }
        if (value[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      maskRange(start, index);
      continue;
    }

    const url = value.slice(index).match(/^url\s*\(/i);
    if (url) {
      const start = index;
      index += url[0].length;
      let depth = 1;
      while (index < value.length && depth > 0) {
        const current = value[index];
        if (current === "'" || current === '"') {
          const nestedQuote = current;
          index += 1;
          while (index < value.length) {
            if (value[index] === "\\") {
              index += 2;
              continue;
            }
            if (value[index] === nestedQuote) {
              index += 1;
              break;
            }
            index += 1;
          }
          continue;
        }
        if (current === "(") depth += 1;
        if (current === ")") depth -= 1;
        index += 1;
      }
      maskRange(start, index);
      continue;
    }

    index += 1;
  }

  return masked.join("");
}

function colorLiteralMatches(
  value: string,
  includeNamedColors = true,
): ColorLiteralMatch[] {
  const detectableValue = maskCssStringsAndUrls(value);
  const matches = [
    ...detectableValue.matchAll(new RegExp(RAW_COLOR_PATTERN, "gi")),
    ...(includeNamedColors
      ? detectableValue.matchAll(new RegExp(NAMED_COLOR_PATTERN, "gi"))
      : []),
  ].map((match) => ({
    index: match.index ?? 0,
    value: value.slice(
      match.index ?? 0,
      (match.index ?? 0) + match[0].length,
    ),
  }));

  return matches.sort((left, right) => left.index - right.index);
}

function hasColorLiteral(value: string, includeNamedColors = true): boolean {
  return colorLiteralMatches(value, includeNamedColors).length > 0;
}

function colorPropertyName(name: string): boolean {
  const normalized = name.replace(/^["']|["']$/g, "").toLowerCase();
  const compact = normalized.replace(/-/g, "");
  return (
    normalized.startsWith("--") ||
    compact === "color" ||
    compact.endsWith("color") ||
    compact === "background" ||
    compact === "backgroundimage" ||
    compact.startsWith("border") ||
    compact === "boxshadow" ||
    compact === "textshadow" ||
    compact === "fill" ||
    compact === "stroke" ||
    compact === "filter" ||
    compact === "outline" ||
    compact === "textdecoration" ||
    compact === "textemphasis" ||
    compact === "columnrule" ||
    compact === "scrollbar"
  );
}

function declarationValueViolations(
  file: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const declarationRe = /(^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]+)/gm;
  const detectableSource = maskCssStringsAndUrls(source);

  for (const match of detectableSource.matchAll(declarationRe)) {
    const property = match[2];
    const valueStart =
      (match.index ?? 0) + match[0].length - match[3].length;
    const value = source.slice(valueStart, valueStart + match[3].length);
    for (const literal of colorLiteralMatches(
      value,
      colorPropertyName(property),
    )) {
      const offset = valueStart + literal.index;
      violations.push({
        file,
        line: lineAt(source, offset),
        value: `${property}: ${literal.value}`,
      });
    }
  }

  return violations;
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

function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function functionBody(value: string, functionName: string): string | undefined {
  const match = value.match(
    new RegExp(`^${functionName}\\s*\\(`, "i"),
  );
  if (!match) return undefined;
  const open = match[0].lastIndexOf("(");
  const close = findMatchingParen(value, open);
  if (close === -1 || value.slice(close + 1).trim() !== "") return undefined;
  return value.slice(open + 1, close);
}

function withoutMixWeight(value: string): string {
  return value
    .trim()
    .replace(/\s+(?:\d+(?:\.\d+)?|\.\d+)%\s*$/i, "")
    .trim();
}

function codaScopeAliasResolves(
  name: string,
  context: ColorTokenContext,
  visiting = new Set<string>(),
): boolean {
  if (visiting.has(name)) return false;
  const definition = context.aliasDefinitions.get(name);
  if (!definition) return false;
  const nextVisiting = new Set(visiting).add(name);
  return isTokenDerivedColorInput(definition.value, context, nextVisiting);
}

function isTokenDerivedColorInput(
  value: string,
  context: ColorTokenContext,
  visitingAliases = new Set<string>(),
): boolean {
  const input = withoutMixWeight(value);
  if (/^(?:transparent|currentcolor)$/i.test(input)) return true;

  const variableBody = functionBody(input, "var");
  if (variableBody !== undefined) {
    const [name, ...fallbackParts] = topLevelParts(variableBody);
    const primaryResolves = name.startsWith("--color-")
      ? context.shellDefinitions.has(name)
      : name.startsWith("--codascope-") &&
        codaScopeAliasResolves(name, context, visitingAliases);
    if (!primaryResolves) return false;
    return (
      fallbackParts.length === 0 ||
      isTokenDerivedColorInput(
        fallbackParts.join(","),
        context,
        visitingAliases,
      )
    );
  }

  const mixBody = functionBody(input, "color-mix");
  if (mixBody !== undefined) {
    const parts = topLevelParts(mixBody);
    return (
      parts.length === 3 &&
      /^in\s+[a-z0-9-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?$/i.test(
        parts[0],
      ) &&
      isTokenDerivedColorInput(parts[1], context, visitingAliases) &&
      isTokenDerivedColorInput(parts[2], context, visitingAliases)
    );
  }

  return false;
}

function invalidColorMixes(
  value: string,
  context: ColorTokenContext,
): ColorLiteralMatch[] {
  const detectableValue = maskCssStringsAndUrls(value);
  const violations: ColorLiteralMatch[] = [];
  const pattern = /\bcolor-mix\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(detectableValue)) !== null) {
    const open = match.index + match[0].lastIndexOf("(");
    const close = findMatchingParen(detectableValue, open);
    if (close === -1) {
      violations.push({ index: match.index, value: match[0] });
      continue;
    }
    const expression = value.slice(match.index, close + 1);
    if (!isTokenDerivedColorInput(expression, context)) {
      violations.push({ index: match.index, value: expression });
    }
    pattern.lastIndex = close + 1;
  }
  return violations;
}

function colorMixViolations(
  file: string,
  source: string,
  context: ColorTokenContext,
): Violation[] {
  return invalidColorMixes(source, context).map((match) => ({
    file,
    line: lineAt(source, match.index),
    value: `color-mix() must use token-derived colors: ${match.value}`,
  }));
}

function literalFallbackViolations(
  file: string,
  source: string,
): Violation[] {
  const violations: Violation[] = [];
  const detectableSource = maskCssStringsAndUrls(source);
  let searchFrom = 0;

  while (searchFrom < detectableSource.length) {
    const start = detectableSource.indexOf("var(", searchFrom);
    if (start === -1) break;
    const end = findMatchingParen(detectableSource, start + 3);
    if (end === -1) {
      searchFrom = start + 4;
      continue;
    }

    const body = source.slice(start + 4, end);
    const comma = topLevelComma(body);
    if (comma !== -1) {
      const fallback = body.slice(comma + 1).trim();
      if (hasColorLiteral(fallback)) {
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
  const source = maskCssStringsAndUrls(
    stripCssComments(readFileSync(TOKEN_FILE, "utf8")),
  );
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
  const detectableSource = maskCssStringsAndUrls(source);
  for (const match of detectableSource.matchAll(/var\(\s*(--color-[a-z0-9-]+)/g)) {
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

function colorTokenContext(
  sources: Map<string, string>,
  shellDefinitions: Set<string>,
): ColorTokenContext {
  const aliasDefinitions = new Map<string, AliasDefinition>();
  for (const [file, source] of sources) {
    const detectableSource = maskCssStringsAndUrls(source);
    for (const match of detectableSource.matchAll(
      /(--codascope-[a-z0-9-]+)\s*:\s*([^;{}]+)/g,
    )) {
      const valueStart =
        (match.index ?? 0) + match[0].length - match[2].length;
      aliasDefinitions.set(match[1], {
        file,
        index: match.index ?? 0,
        value: source.slice(valueStart, valueStart + match[2].length).trim(),
      });
    }
  }
  return { shellDefinitions, aliasDefinitions };
}

function codaScopeAliasViolations(
  sources: Map<string, string>,
  context: ColorTokenContext,
): Violation[] {
  const references: Array<{ file: string; index: number; name: string }> = [];

  for (const [file, source] of sources) {
    const detectableSource = maskCssStringsAndUrls(source);
    for (const match of detectableSource.matchAll(
      /var\(\s*(--codascope-[a-z0-9-]+)/g,
    )) {
      references.push({ file, index: match.index ?? 0, name: match[1] });
    }
  }

  const violations: Violation[] = [];
  for (const reference of references) {
    if (!context.aliasDefinitions.has(reference.name)) {
      violations.push({
        file: reference.file,
        line: lineAt(sources.get(reference.file) ?? "", reference.index),
        value: `undefined CodaScope color alias ${reference.name}`,
      });
    }
  }

  for (const [name, definition] of context.aliasDefinitions) {
    if (!codaScopeAliasResolves(name, context)) {
      violations.push({
        file: definition.file,
        line: lineAt(sources.get(definition.file) ?? "", definition.index),
        value: `${name} must derive only from authoritative shell color tokens`,
      });
    }
  }

  return violations;
}

function cssColorContractViolations(
  sources: Map<string, string>,
  shellDefinitions: Set<string>,
): Violation[] {
  const context = colorTokenContext(sources, shellDefinitions);
  return [
    ...[...sources].flatMap(([file, source]) => [
      ...declarationValueViolations(file, source),
      ...literalFallbackViolations(file, source),
      ...colorMixViolations(file, source, context),
      ...unresolvedShellTokenViolations(file, source, shellDefinitions),
    ]),
    ...codaScopeAliasViolations(sources, context),
  ];
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

function isNativeColorInputDefault(attribute: Ts.Node): boolean {
  if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "value") {
    return false;
  }
  const opening = attribute.parent.parent;
  if (
    !opening ||
    (!ts.isJsxSelfClosingElement(opening) &&
      !ts.isJsxOpeningElement(opening))
  ) {
    return false;
  }
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
  contextNode: Ts.Node,
  field: string,
): boolean {
  const path = displayPath(file);
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
    return field === "cssColor" || isNativeColorInputDefault(contextNode);
  }
  return false;
}

interface StaticStringContext {
  sourceFile: Ts.SourceFile;
  constDeclarations: Map<string, Ts.VariableDeclaration[]>;
}

function staticPropertyName(
  name: Ts.PropertyName,
  context: StaticStringContext,
): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return resolveStaticString(name.expression, context);
  }
  return undefined;
}

function nodeContains(ancestor: Ts.Node, node: Ts.Node): boolean {
  return ancestor.pos <= node.pos && ancestor.end >= node.end;
}

function bindingScope(declaration: Ts.VariableDeclaration): Ts.Node {
  let current: Ts.Node = declaration.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isBlock(current) ||
      ts.isModuleBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return current;
}

function scopeDepth(node: Ts.Node): number {
  let depth = 0;
  let current: Ts.Node | undefined = node;
  while (current) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function collectConstDeclarations(
  sourceFile: Ts.SourceFile,
): Map<string, Ts.VariableDeclaration[]> {
  const declarations = new Map<string, Ts.VariableDeclaration[]>();
  const visit = (node: Ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const current = declarations.get(node.name.text) ?? [];
      current.push(node);
      declarations.set(node.name.text, current);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

function localConstInitializer(
  identifier: Ts.Identifier,
  context: StaticStringContext,
): Ts.Expression | undefined {
  const declarations = context.constDeclarations.get(identifier.text) ?? [];
  return declarations
    .filter((declaration) => {
      const scope = bindingScope(declaration);
      return (
        declaration.initializer !== undefined && nodeContains(scope, identifier)
      );
    })
    .sort((left, right) => {
      const depthDifference =
        scopeDepth(bindingScope(right)) - scopeDepth(bindingScope(left));
      return depthDifference !== 0
        ? depthDifference
        : right.getStart(context.sourceFile) - left.getStart(context.sourceFile);
    })[0]?.initializer;
}

function unwrapExpression(expression: Ts.Expression): Ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function objectPropertyInitializer(
  expression: Ts.Expression,
  propertyName: string,
  context: StaticStringContext,
  visiting: Set<number>,
): Ts.Expression | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const initializer = localConstInitializer(current, context);
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    const nextVisiting = new Set(visiting).add(initializer.pos);
    return objectPropertyInitializer(
      initializer,
      propertyName,
      context,
      nextVisiting,
    );
  }
  if (!ts.isObjectLiteralExpression(current)) return undefined;
  for (const property of current.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name, context) === propertyName
    ) {
      return property.initializer;
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === propertyName
    ) {
      return property.name;
    }
  }
  return undefined;
}

function resolveStaticString(
  expression: Ts.Expression,
  context: StaticStringContext,
  visiting = new Set<number>(),
): string | undefined {
  const current = unwrapExpression(expression);
  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current) ||
    ts.isNumericLiteral(current)
  ) {
    return current.text;
  }
  if (current.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (current.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const span of current.templateSpans) {
      const substitution = resolveStaticString(
        span.expression,
        context,
        visiting,
      );
      if (substitution === undefined) return undefined;
      value += substitution + span.literal.text;
    }
    return value;
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticString(current.left, context, visiting);
    const right = resolveStaticString(current.right, context, visiting);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isIdentifier(current)) {
    const initializer = localConstInitializer(current, context);
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    return resolveStaticString(
      initializer,
      context,
      new Set(visiting).add(initializer.pos),
    );
  }
  if (ts.isPropertyAccessExpression(current)) {
    const initializer = objectPropertyInitializer(
      current.expression,
      current.name.text,
      context,
      visiting,
    );
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    return resolveStaticString(
      initializer,
      context,
      new Set(visiting).add(initializer.pos),
    );
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const propertyName = resolveStaticString(
      current.argumentExpression,
      context,
      visiting,
    );
    if (propertyName === undefined) return undefined;
    const initializer = objectPropertyInitializer(
      current.expression,
      propertyName,
      context,
      visiting,
    );
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    return resolveStaticString(
      initializer,
      context,
      new Set(visiting).add(initializer.pos),
    );
  }
  return undefined;
}

function colorCandidateText(
  expression: Ts.Expression,
  context: StaticStringContext,
  visiting = new Set<number>(),
): string | undefined {
  const resolved = resolveStaticString(expression, context, visiting);
  if (resolved !== undefined) return resolved;

  const current = unwrapExpression(expression);
  if (ts.isTemplateExpression(current)) {
    return (
      current.head.text +
      current.templateSpans
        .map(
          (span) =>
            (colorCandidateText(span.expression, context, visiting) ?? " ") +
            span.literal.text,
        )
        .join("")
    );
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = colorCandidateText(current.left, context, visiting) ?? " ";
    const right = colorCandidateText(current.right, context, visiting) ?? " ";
    return left + right;
  }
  if (ts.isIdentifier(current)) {
    const initializer = localConstInitializer(current, context);
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    return colorCandidateText(
      initializer,
      context,
      new Set(visiting).add(initializer.pos),
    );
  }
  if (ts.isPropertyAccessExpression(current)) {
    const initializer = objectPropertyInitializer(
      current.expression,
      current.name.text,
      context,
      visiting,
    );
    if (!initializer || visiting.has(initializer.pos)) return undefined;
    return colorCandidateText(
      initializer,
      context,
      new Set(visiting).add(initializer.pos),
    );
  }
  return undefined;
}

function jsxAttributeExpression(
  attribute: Ts.JsxAttribute,
): Ts.Expression | undefined {
  if (!attribute.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer;
  return ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
}

function tsColorLiteralViolationsForSource(
  file: string,
  source: string,
  tokenContext = EMPTY_COLOR_TOKEN_CONTEXT,
): Violation[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const context: StaticStringContext = {
    sourceFile,
    constDeclarations: collectConstDeclarations(sourceFile),
  };
  const violations: Violation[] = [];

  const inspectExpression = (
    expression: Ts.Expression,
    contextNode: Ts.Node,
    field: string,
  ): void => {
    if (isAllowedContentColor(file, contextNode, field)) return;
    const value = colorCandidateText(expression, context);
    if (value === undefined) return;
    for (const literal of colorLiteralMatches(value)) {
      violations.push({
        file,
        line:
          sourceFile.getLineAndCharacterOfPosition(contextNode.getStart()).line +
          1,
        value: `${field}: ${literal.value}`,
      });
    }
    for (const mix of invalidColorMixes(value, tokenContext)) {
      violations.push({
        file,
        line:
          sourceFile.getLineAndCharacterOfPosition(contextNode.getStart()).line +
          1,
        value: `${field}: color-mix() must use token-derived colors: ${mix.value}`,
      });
    }
  };

  const visit = (node: Ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const field = staticPropertyName(node.name, context);
      if (field && colorPropertyName(field)) {
        inspectExpression(node.initializer, node, field);
      }
    } else if (ts.isShorthandPropertyAssignment(node)) {
      const field = node.name.text;
      if (colorPropertyName(field)) {
        inspectExpression(node.name, node, field);
      }
    } else if (ts.isJsxAttribute(node)) {
      const field = node.name.getText(sourceFile);
      if (colorPropertyName(field) || isNativeColorInputDefault(node)) {
        const expression = jsxAttributeExpression(node);
        if (expression) inspectExpression(expression, node, field);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      colorPropertyName(node.left.name.text)
    ) {
      inspectExpression(node.right, node, node.left.name.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setProperty" &&
      node.arguments.length >= 2
    ) {
      const field = resolveStaticString(node.arguments[0], context);
      if (field && colorPropertyName(field)) {
        inspectExpression(node.arguments[1], node, field);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function productionColorLiteralViolations(
  tokenContext: ColorTokenContext,
): Violation[] {
  return walkSourceFiles(CODASCOPE_DIR).flatMap((file) =>
    tsColorLiteralViolationsForSource(
      file,
      readFileSync(file, "utf8"),
      tokenContext,
    ),
  );
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

describe("literal color detector", () => {
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

  it("rejects every opaque CSS named color in declarations and TS/TSX color properties", () => {
    const css = CSS_NAMED_COLORS.map(
      (color, index) => `.sample-${index} { color: ${color}; }`,
    ).join("\n");
    const tsx = `export const styles = [
      ${CSS_NAMED_COLORS.map((color) => `{ color: "${color}" }`).join(",\n")}
    ];`;

    expect(declarationValueViolations("synthetic.css", css)).toHaveLength(148);
    expect(tsColorLiteralViolationsForSource("Synthetic.tsx", tsx)).toHaveLength(
      148,
    );
    expect(
      tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        'export const sample = { color: "RebeccaPurple" };',
      ),
    ).toHaveLength(1);
  });

  it.each(allowedKeywords)(
    "allows the token-compatible keyword %s in CSS and TS/TSX",
    (keyword) => {
      expect(
        declarationValueViolations(
          "synthetic.css",
          `.sample { color: ${keyword}; }`,
        ),
      ).toEqual([]);
      expect(
        tsColorLiteralViolationsForSource(
          "Synthetic.tsx",
          `export const Sample = () => <div style={{ color: "${keyword}" }} />;`,
        ),
      ).toEqual([]);
    },
  );

  it("rejects every modern literal color function in CSS declarations and TS/TSX properties", () => {
    const values = [
      "hwb(30 10% 20%)",
      "lab(50% 20 30)",
      "lch(50% 40 30)",
      "oklab(60% 0.1 0.1)",
      "oklch(60% 0.2 30)",
      "color(display-p3 1 0 0)",
    ];
    expect(MODERN_COLOR_FUNCTIONS).toHaveLength(values.length);
    for (const [index, value] of values.entries()) {
      const cssViolations = declarationValueViolations(
        "synthetic.css",
        `.sample-${index} { border-color: ${value}; }`,
      );
      const tsViolations = tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        `export const style = { borderColor: "${value}" };`,
      );
      expect(cssViolations, value).toHaveLength(1);
      expect(tsViolations, value).toHaveLength(1);
    }
  });

  it("rejects every modern literal color function in custom-property fallbacks", () => {
    const values = [
      "hwb(30 10% 20%)",
      "lab(50% 20 30)",
      "lch(50% 40 30)",
      "oklab(60% 0.1 0.1)",
      "oklch(60% 0.2 30)",
      "color(display-p3 1 0 0)",
    ];
    const css = values
      .map(
        (value, index) =>
          `.sample-${index} { color: var(--color-missing-${index}, ${value}); }`,
      )
      .join("\n");

    expect(literalFallbackViolations("synthetic.css", css)).toHaveLength(
      values.length,
    );
  });

  it("resolves local const chains, object properties, and template literals in color contexts", () => {
    const source = `
      const danger = "red";
      const alias = danger;
      const palette = { accent: "rebeccapurple" } as const;
      const lightness = 60;
      const modern = \`oklch(\${lightness}% 0.2 30)\`;
      export const styles = {
        color: alias,
        borderColor: palette.accent,
        backgroundColor: modern,
      };
    `;
    const violations = tsColorLiteralViolationsForSource(
      "Synthetic.tsx",
      source,
    );
    expect(violations).toHaveLength(3);
    expect(violations.map(({ value }) => value.toLowerCase())).toEqual([
      "color: red",
      "bordercolor: rebeccapurple",
      "backgroundcolor: oklch(",
    ]);
  });

  it("detects modern functions in partially dynamic color templates", () => {
    const source = `
      declare const channel: number;
      const dynamicColor = \`hwb(\${channel} 10% 20%)\`;
      export const Sample = () => <div color={dynamicColor} />;
    `;
    expect(
      tsColorLiteralViolationsForSource("Synthetic.tsx", source),
    ).toHaveLength(1);
  });

  it("does not mistake prose, labels, identifiers, filenames, URLs, or unrelated strings for colors", () => {
    expect(
      declarationValueViolations(
        "synthetic.css",
        `.sample {
          white-space: nowrap;
          animation-name: red;
          content: "red alert";
          background-image: url("/assets/red.svg");
          color: var(--color-gold);
        }`,
      ),
    ).toEqual([]);
    expect(
      tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        `
          const danger = "red";
          const label = "red alert";
          const filename = "red.svg";
          export const Sample = () => (
            <div
              aria-label={label}
              data-file={filename}
              style={{ backgroundImage: "url('/assets/red.svg')" }}
            />
          );
        `,
      ),
    ).toEqual([]);
  });

  it("keeps token-derived aliases and color-mix while rejecting literals hidden in aliases and fallbacks", () => {
    const shellTokens = new Set(["--color-accent", "--color-warning"]);
    const compliant = new Map([
      [
        "compliant.css",
        `
          :root {
            --codascope-base: var(--color-accent);
            --codascope-mix: color-mix(
              in srgb,
              var(--codascope-base) 70%,
              transparent
            );
          }
          .sample {
            color: color-mix(in srgb, var(--codascope-mix), currentColor);
          }
        `,
      ],
    ]);
    const prohibited = new Map([
      [
        "prohibited.css",
        `
          :root {
            --codascope-modern: color-mix(
              in srgb,
              var(--color-accent),
              oklch(60% 0.2 30)
            );
            --codascope-named: color-mix(
              in srgb,
              var(--color-warning),
              red
            );
            --codascope-fallback: var(
              --color-accent,
              hwb(30 10% 20%)
            );
          }
        `,
      ],
    ]);
    const compliantContext = colorTokenContext(compliant, shellTokens);
    const prohibitedContext = colorTokenContext(prohibited, shellTokens);

    expect(codaScopeAliasViolations(compliant, compliantContext)).toEqual([]);
    expect(
      colorMixViolations(
        "compliant.css",
        compliant.get("compliant.css") ?? "",
        compliantContext,
      ),
    ).toEqual([]);
    expect(
      codaScopeAliasViolations(prohibited, prohibitedContext),
    ).toHaveLength(3);
    expect(
      literalFallbackViolations(
        "synthetic.css",
        ".sample { color: var(--color-accent, red); }",
      ),
    ).toHaveLength(1);
    expect(
      colorMixViolations(
        "synthetic.css",
        ".sample { color: color-mix(in srgb, var(--spacing-2), transparent); }",
        compliantContext,
      ),
    ).toHaveLength(1);
    expect(
      tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        `export const style = {
          color: "color-mix(in srgb, var(--spacing-2), transparent)",
        };`,
      ),
    ).toHaveLength(1);
  });

  it("resolves color-mix variables against real shell tokens and recursive CodaScope aliases", () => {
    const shellTokens = shellColorDefinitions();
    const validSources = new Map([
      [
        "valid.css",
        `
          :root {
            --codascope-base: var(--color-accent);
            --codascope-nested: color-mix(
              in srgb,
              var(--codascope-base),
              var(--color-warning)
            );
          }
          .direct {
            color: color-mix(in srgb, var(--color-accent), transparent);
          }
          .aliased {
            color: color-mix(in srgb, var(--codascope-nested), currentColor);
          }
        `,
      ],
    ]);
    const validContext = colorTokenContext(validSources, shellTokens);

    expect(cssColorContractViolations(validSources, shellTokens)).toEqual([]);
    expect(
      tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        `export const styles = [
          { color: "color-mix(in srgb, var(--color-accent), transparent)" },
          { borderColor: "color-mix(in srgb, var(--codascope-nested), currentColor)" },
        ];`,
        validContext,
      ),
    ).toEqual([]);

    const invalidSources = new Map([
      [
        "invalid.css",
        `
          .unknown-shell {
            color: color-mix(
              in srgb,
              var(--color-does-not-exist),
              transparent
            );
          }
          .unknown-alias {
            color: color-mix(
              in srgb,
              var(--codascope-does-not-exist),
              transparent
            );
          }
          .unknown-with-fallback {
            color: color-mix(
              in srgb,
              var(--color-does-not-exist, var(--color-accent)),
              transparent
            );
          }
        `,
      ],
    ]);
    const invalidContext = colorTokenContext(invalidSources, shellTokens);
    const cssViolations = cssColorContractViolations(
      invalidSources,
      shellTokens,
    );
    expect(
      cssViolations.filter(({ value }) =>
        value.startsWith("color-mix() must use token-derived colors"),
      ),
    ).toHaveLength(3);
    expect(
      tsColorLiteralViolationsForSource(
        "Synthetic.tsx",
        `export const styles = [
          { color: "color-mix(in srgb, var(--color-does-not-exist), transparent)" },
          { borderColor: "color-mix(in srgb, var(--codascope-does-not-exist), transparent)" },
          { outlineColor: "color-mix(in srgb, var(--color-does-not-exist, var(--color-accent)), transparent)" },
        ];`,
        invalidContext,
      ),
    ).toHaveLength(3);

    const cyclicSources = new Map([
      [
        "cycle.css",
        `
          :root {
            --codascope-cycle-a: var(--codascope-cycle-b);
            --codascope-cycle-b: var(--codascope-cycle-a);
          }
          .cycle {
            color: color-mix(
              in srgb,
              var(--codascope-cycle-a),
              transparent
            );
          }
        `,
      ],
    ]);
    expect(cssColorContractViolations(cyclicSources, shellTokens)).not.toEqual(
      [],
    );
  });

  it("applies definition-aware color-mix resolution to direct, local-const, and template values", () => {
    const shellTokens = shellColorDefinitions();
    const aliasSources = new Map([
      [
        "aliases.css",
        `
          :root {
            --codascope-base: var(--color-accent);
            --codascope-nested: color-mix(
              in srgb,
              var(--codascope-base),
              var(--color-warning)
            );
          }
        `,
      ],
    ]);
    const context = colorTokenContext(aliasSources, shellTokens);
    const source = `
      const unknown =
        "color-mix(in srgb, var(--color-does-not-exist), transparent)";
      const chained = unknown;
      const missingAlias = "does-not-exist";
      const templated =
        \`color-mix(in srgb, var(--codascope-\${missingAlias}), transparent)\`;
      const realToken = "accent";
      const validTemplate =
        \`color-mix(in srgb, var(--color-\${realToken}), transparent)\`;
      const validAlias =
        \`color-mix(in srgb, var(--codascope-nested), currentColor)\`;
      export const styles = [
        { color: "color-mix(in srgb, var(--color-does-not-exist), transparent)" },
        { borderColor: chained },
        { backgroundColor: templated },
        { outlineColor: validTemplate },
        { fill: validAlias },
      ];
    `;

    expect(
      tsColorLiteralViolationsForSource("Synthetic.tsx", source, context),
    ).toHaveLength(3);
  });

  it("masks strings and URLs across the combined CSS enforcement pipeline", () => {
    const shellTokens = shellColorDefinitions();
    const quotedSources = new Map([
      [
        "quoted.css",
        `.quoted {
          content: "var(--color-does-not-exist, red)";
          content: "ignored; color: red; --codascope-quoted: var(--codascope-does-not-exist); color-mix(in srgb, var(--color-does-not-exist), red)";
          background-image: url("var(--color-does-not-exist, red)");
          background-image: url("color-mix(in srgb, var(--codascope-does-not-exist), red)");
        }`,
      ],
    ]);
    expect(cssColorContractViolations(quotedSources, shellTokens)).toEqual([]);

    const activeSources = new Map([
      [
        "active.css",
        `.active {
          color: var(--color-does-not-exist, red);
          background: color-mix(in srgb, var(--color-does-not-exist), transparent);
          border-color: var(--color-does-not-exist);
          --codascope-broken: var(--color-does-not-exist);
          outline-color: color-mix(in srgb, var(--codascope-broken), transparent);
        }`,
      ],
    ]);
    const violations = cssColorContractViolations(activeSources, shellTokens);
    const violationLines = new Set(violations.map(({ line }) => line));
    expect(violations).not.toEqual([]);
    expect(violationLines).toEqual(new Set([2, 3, 4, 5, 6]));
  });

  it("keeps persisted-data and native color-input exceptions narrow", () => {
    const toolbar = join(
      CODASCOPE_DIR,
      "components/NoteFormattingToolbar.tsx",
    );
    const settings = join(CODASCOPE_DIR, "views/Settings.tsx");
    expect(
      tsColorLiteralViolationsForSource(
        toolbar,
        'const palette = [{ cssColor: "oklch(60% 0.2 30)" }];',
      ),
    ).toEqual([]);
    expect(
      tsColorLiteralViolationsForSource(
        settings,
        'export const Picker = () => <input type="color" value="#ff9900" />;',
      ),
    ).toEqual([]);
    expect(
      tsColorLiteralViolationsForSource(
        toolbar,
        'export const Chrome = () => <div style={{ color: "red" }} />;',
      ),
    ).toHaveLength(1);
  });
});

describe("CodaScope UI color token contract", () => {
  const sources = new Map(
    STYLE_FILES.map((file) => [
      file,
      stripCssComments(readFileSync(file, "utf8")),
    ]),
  );
  const shellDefinitions = shellColorDefinitions();
  const tokenContext = colorTokenContext(sources, shellDefinitions);

  it("contains no raw or named visual colors in active CSS declarations", () => {
    const violations = [...sources].flatMap(([file, source]) =>
      declarationValueViolations(file, source),
    );
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("contains no literal color fallbacks in var() expressions", () => {
    const violations = [...sources].flatMap(([file, source]) =>
      literalFallbackViolations(file, source),
    );
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("uses only token-derived colors inside color-mix()", () => {
    const violations = [...sources].flatMap(([file, source]) =>
      colorMixViolations(file, source, tokenContext),
    );
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("resolves shell color references and token-derived CodaScope aliases", () => {
    const violations = [
      ...[...sources].flatMap(([file, source]) =>
        unresolvedShellTokenViolations(file, source, shellDefinitions),
      ),
      ...codaScopeAliasViolations(sources, tokenContext),
    ];
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("keeps hard-coded production colors inside the persisted-content exceptions", () => {
    const violations = productionColorLiteralViolations(tokenContext);
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
