import { describe, expect, it, vi } from "vitest";
import { completeLongForm, mergeExactContinuation } from "../llm/long-form-completion.js";
import { PartialResponseError } from "../llm/provider.js";

describe("long-form completion", () => {
  it("removes only exact repeated overlap", () => {
    expect(mergeExactContinuation("mock_text\nmock_text\nmock_text", "mock_text\nmock_text\nmock_text")).toBe("mock_text\nmock_text\nmock_text\nmock_text");
    expect(mergeExactContinuation("mock_text", "mock_text")).toBe("mock_text\nmock_text");
  });

  it("does not resume an interrupted transport response", async () => {
    const generate = vi.fn().mockRejectedValue(new PartialResponseError(
      "mock_text",
      new Error("connection closed"),
    ));

    await expect(completeLongForm({
      messages: [{ role: "user", content: "mock_text" }],
      generate,
    })).rejects.toThrow("connection closed");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("runs one recovery pass after output-limit continuation fragments are merged", async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new PartialResponseError(
        "# mock_text\n\n## mock_text\nmock_text",
        new Error("model reached the output limit"),
        "output-limit",
      ))
      .mockResolvedValueOnce({
        content: "# mock_text\n\n## mock_text\nmock_text\n\n## mock_text\nmock_text",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    const recoverAfterContinuation = vi.fn().mockResolvedValue(
      "# mock_text\n\n## mock_text\nmock_text\n\n## mock_text\nmock_text",
    );

    const result = await completeLongForm({
      messages: [{ role: "user", content: "mock_text" }],
      generate,
      recoverAfterContinuation,
    });

    expect(recoverAfterContinuation).toHaveBeenCalledTimes(1);
    expect(recoverAfterContinuation.mock.calls[0]?.[0]).toContain("## mock_text");
    expect(result.content.match(/^# mock_text/gmu)).toHaveLength(1);
  });
});
