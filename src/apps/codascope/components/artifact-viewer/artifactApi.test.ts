import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeBuildStatus } from "./artifactApi";

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(_url: string) {
    FakeEventSource.latest = this;
  }
}

afterEach(() => {
  FakeEventSource.latest = null;
  vi.unstubAllGlobals();
});

describe("artifact EventSource terminal exception", () => {
  it("does not report idle or malformed status as successful completion", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onDone = vi.fn();
    const onError = vi.fn();
    subscribeBuildStatus("project", "epic", "artifact", vi.fn(), onDone, onError);

    FakeEventSource.latest!.onmessage!({ data: JSON.stringify({ status: "idle" }) });
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Artifact build stream has no active run.",
    }));

    onError.mockClear();
    subscribeBuildStatus("project", "epic", "artifact", vi.fn(), onDone, onError);
    FakeEventSource.latest!.onmessage!({ data: "not-json" });
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Artifact build stream returned malformed status data.",
    }));
  });

  it("keeps an onDone exception from producing a second terminal callback", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onDone = vi.fn(() => { throw new Error("consumer done failure"); });
    const onError = vi.fn();
    subscribeBuildStatus("project", "epic", "artifact", vi.fn(), onDone, onError);
    const source = FakeEventSource.latest!;

    source.onmessage!({ data: JSON.stringify({ status: "complete" }) });
    source.onerror!();
    source.onmessage!({ data: JSON.stringify({ status: "error", error: "late" }) });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("contains an onError exception and preserves exactly-once ownership", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onError = vi.fn(() => { throw new Error("consumer error failure"); });
    subscribeBuildStatus("project", "epic", "artifact", vi.fn(), vi.fn(), onError);
    const source = FakeEventSource.latest!;

    source.onmessage!({ data: JSON.stringify({ status: "error", error: "failed" }) });
    source.onerror!();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
