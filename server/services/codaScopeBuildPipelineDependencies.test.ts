import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const servicesDir = path.dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(servicesDir, relativePath), "utf-8");
}

function importEdges(source: string): string[] {
  const edges = new Set<string>();
  const edgePatterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];

  for (const pattern of edgePatterns) {
    for (const match of source.matchAll(pattern)) edges.add(match[1]);
  }
  return [...edges];
}

describe("build pipeline dependency ownership", () => {
  const buildSource = readSource("codaScopeBuildOrchestrator.ts");
  const deepSource = readSource("codaScopeDeepRunOrchestrator.ts");
  const sharedSource = readSource("codaScopeBuildPipelineShared.ts");
  const routeSource = readSource("../routes/codaScopeBuildRoutes.ts");

  it("keeps the build and Deep Run orchestrators independent siblings", () => {
    expect(importEdges(buildSource)).not.toContain("./codaScopeDeepRunOrchestrator.js");
    expect(importEdges(deepSource)).not.toContain("./codaScopeBuildOrchestrator.js");
  });

  it("keeps the shared module as a type-only leaf below routes and orchestrators", () => {
    const edges = importEdges(sharedSource);
    expect(edges).not.toContain("./codaScopeBuildOrchestrator.js");
    expect(edges).not.toContain("./codaScopeDeepRunOrchestrator.js");
    expect(edges.some((edge) => edge.includes("/routes/") || edge.startsWith("../routes"))).toBe(false);
    expect(sharedSource.match(/^import (?!type\b)/gm)).toBeNull();
  });

  it("makes the build route import each pipeline from its owning module", () => {
    expect(importEdges(routeSource)).toEqual(expect.arrayContaining([
      "../services/codaScopeBuildOrchestrator.js",
      "../services/codaScopeDeepRunOrchestrator.js",
    ]));
    expect(routeSource).toMatch(
      /import\s*\{\s*runAnalyzePipeline\s*\}\s*from\s*"\.\.\/services\/codaScopeBuildOrchestrator\.js"/,
    );
    expect(routeSource).toMatch(
      /import\s*\{\s*runDeepRunPipeline\s*\}\s*from\s*"\.\.\/services\/codaScopeDeepRunOrchestrator\.js"/,
    );
  });

  it("loads both sibling orchestrators without circular initialization", async () => {
    const [buildModule, deepModule] = await Promise.all([
      import("./codaScopeBuildOrchestrator.js"),
      import("./codaScopeDeepRunOrchestrator.js"),
    ]);

    expect(buildModule.runAnalyzePipeline).toBeTypeOf("function");
    expect(buildModule.runEpicDeepenPipeline).toBeTypeOf("function");
    expect(deepModule.runDeepRunPipeline).toBeTypeOf("function");
    expect("runDeepRunPipeline" in buildModule).toBe(false);
    expect("runAnalyzePipeline" in deepModule).toBe(false);
  });
});
