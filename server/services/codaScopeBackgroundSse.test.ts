import { describe, expect, it, vi } from "vitest";
import { startBackgroundSsePump } from "./codaScopeBackgroundSse";

describe("startBackgroundSsePump", () => {
  it("catches background reader failures instead of creating an unhandled rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("reader disconnected");
      },
    }));

    expect(startBackgroundSsePump(response, "start-only-test")).toBe(true);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
      "[start-only-test] Background SSE reader failed:",
      expect.objectContaining({ message: "reader disconnected" }),
    ));
    log.mockRestore();
  });

  it("rejects a start-only response without a body", () => {
    expect(startBackgroundSsePump(new Response(null), "start-only-test")).toBe(false);
  });
});
