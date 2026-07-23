import { describe, expect, it, vi } from "vitest";
import {
  completeSsePipeline,
  createSseTerminalWriter,
  failSsePipeline,
  handlePreStreamError,
  initSsePipeline,
} from "./ssePipelineHelper";

function response(headersSent = false, closeOnEnd = false) {
  const listeners = new Map<string, () => void>();
  const res = {
    headersSent,
    writableEnded: false,
    writeHead: vi.fn(() => { res.headersSent = true; }),
    write: vi.fn(),
    end: vi.fn(() => {
      if (closeOnEnd) listeners.get("close")?.();
      res.writableEnded = true;
    }),
    on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener); }),
    status: vi.fn(() => ({ json: vi.fn() })),
  };
  return { res, listeners };
}

function buildService(cancelled = false) {
  return {
    registerProjectDir: vi.fn(),
    startBuild: vi.fn(() => "run-1"),
    isCancelled: vi.fn(() => cancelled),
    clearCancellation: vi.fn(),
    appendOutput: vi.fn(),
    completeBuild: vi.fn(),
    failBuild: vi.fn(),
  };
}

describe("SSE terminal writer", () => {
  it("delivers exactly one terminal event during a success/error race", () => {
    const { res } = response(true);
    const terminal = createSseTerminalWriter(res as never);

    expect(terminal.done({ ok: true })).toBe(true);
    expect(terminal.error("late failure")).toBe(false);
    expect(terminal.cancelled()).toBe(false);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith("event: done\ndata: {\"ok\":true}\n\n");
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("turns a post-header exception into one SSE error frame", () => {
    const { res } = response(true);
    handlePreStreamError(res as never, new Error("after headers"));
    expect(res.write).toHaveBeenCalledWith(
      "event: error\ndata: {\"error\":\"after headers\"}\n\n",
    );
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("falls back to one serializable error and closes for a circular done payload", () => {
    const { res } = response(true);
    const terminal = createSseTerminalWriter(res as never);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(terminal.done(circular)).toBe(true);
    expect(terminal.terminalEvent()).toBe("error");
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain("event: error\n");
    expect(res.write.mock.calls[0][0]).toContain("could not serialize done terminal payload");
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("falls back to one serializable error and closes for a BigInt cancelled payload", () => {
    const { res } = response(true);
    const terminal = createSseTerminalWriter(res as never);

    expect(terminal.cancelled({ sequence: 1n })).toBe(true);
    expect(terminal.terminalEvent()).toBe("error");
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain("event: error\n");
    expect(res.write.mock.calls[0][0]).toContain("could not serialize cancelled terminal payload");
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe("pipeline terminal ownership", () => {
  it("marks success and emits one done terminal", () => {
    const buildSvc = buildService();
    const { res } = response();
    const pipeline = initSsePipeline({} as never, res as never, {
      projectId: "project",
      scope: "research::epic",
      buildType: "research",
      modelId: "model",
      buildSvc: buildSvc as never,
    });
    expect(pipeline).not.toBeNull();

    completeSsePipeline(res as never, {
      projectId: "project",
      scope: "research::epic",
      buildSvc: buildSvc as never,
    }, "run-1", pipeline!.callbacks);

    expect(buildSvc.completeBuild).toHaveBeenCalledTimes(1);
    expect(buildSvc.failBuild).not.toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledWith("event: done\ndata: {}\n\n");
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["done", "event: done", "complete"],
    ["error", "event: error", "failed"],
    ["cancelled", "event: cancelled", "failed"],
  ] as const)("preserves an orchestrator-owned %s terminal and durable outcome across immediate close", (
    event,
    frame,
    outcome,
  ) => {
    const buildSvc = buildService(event === "cancelled");
    const { res } = response(false, true);
    const pipeline = initSsePipeline({} as never, res as never, {
      projectId: "project",
      scope: "epic-deepen::epic",
      buildType: "epic-deepen",
      modelId: "model",
      buildSvc: buildSvc as never,
    })!;

    if (outcome === "complete") buildSvc.completeBuild("project", "run-1");
    else buildSvc.failBuild("project", "run-1", "orchestrator outcome");
    pipeline.callbacks.sendEvent(event, event === "error"
      ? { error: "orchestrator outcome" }
      : { runId: "run-1" });

    completeSsePipeline(res as never, {
      projectId: "project",
      scope: "epic-deepen::epic",
      buildSvc: buildSvc as never,
    }, "run-1", pipeline.callbacks);

    expect(pipeline.callbacks.isClientDisconnected()).toBe(false);
    expect(buildSvc.completeBuild).toHaveBeenCalledTimes(outcome === "complete" ? 1 : 0);
    expect(buildSvc.failBuild).toHaveBeenCalledTimes(outcome === "failed" ? 1 : 0);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain(frame);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("emits one error terminal and keeps failed build state aligned", () => {
    const buildSvc = buildService();
    const { res } = response();
    const pipeline = initSsePipeline({} as never, res as never, {
      projectId: "project",
      scope: "research::epic",
      buildType: "research",
      modelId: "model",
      buildSvc: buildSvc as never,
    })!;

    failSsePipeline(res as never, {
      projectId: "project",
      scope: "research::epic",
      buildSvc: buildSvc as never,
    }, "run-1", new Error("research exploded"), pipeline.callbacks);
    completeSsePipeline(res as never, {
      projectId: "project",
      scope: "research::epic",
      buildSvc: buildSvc as never,
    }, "run-1", pipeline.callbacks);

    expect(buildSvc.failBuild).toHaveBeenCalledTimes(1);
    expect(buildSvc.completeBuild).not.toHaveBeenCalled();
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(
      "event: error\ndata: {\"error\":\"research exploded\"}\n\n",
    );
  });
});
