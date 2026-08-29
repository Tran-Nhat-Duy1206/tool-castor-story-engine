import { describe, expect, it } from "vitest";
import { localizeKnownRuntimeMessage } from "./error-copy";

describe("localizeKnownRuntimeMessage", () => {
  it("localizes the state-degraded continuation blocker", () => {
    expect(localizeKnownRuntimeMessage(
      "Latest chapter 1 is state-degraded. Repair state or rewrite that chapter before continuing.",
    )).toBe("Chương mới nhất 1 đang ở trạng thái suy giảm (state-degraded). Trước khi viết chương tiếp theo, hãy sửa trạng thái hoặc viết lại chương này.");
  });

  it("localizes related state repair errors while preserving unknown messages", () => {
    expect(localizeKnownRuntimeMessage("Chapter 3 is not state-degraded.")).toBe(
      "Chương 3 không ở trạng thái suy giảm (state-degraded), không cần sửa theo trạng thái.",
    );
    expect(localizeKnownRuntimeMessage(
      "Only the latest state-degraded chapter can be repaired safely (latest is 5).",
    )).toBe("Chỉ có thể sửa an toàn chương suy giảm trạng thái mới nhất; hiện chương mới nhất là chương 5.");
    expect(localizeKnownRuntimeMessage("Bad request")).toBe("Bad request");
  });

  it("localizes common LLM configuration errors", () => {
    const studioMessage = localizeKnownRuntimeMessage(
      "Studio LLM API key not set. Open Studio services and save an API key for the selected service.",
    );
    expect(studioMessage).toContain("Chưa đặt API Key mô hình Studio");
    expect(studioMessage).not.toMatch(/kkaiapi/i);

    const cliMessage = localizeKnownRuntimeMessage(
      "CASTOR_LLM_API_KEY not set. Run 'castor config set-global' or add it to project .env file.",
    );
    expect(cliMessage).toContain("CASTOR_LLM_API_KEY chưa được đặt");
    expect(cliMessage).not.toMatch(/kkaiapi/i);
  });
});
