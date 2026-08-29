import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTuiFrame } from "../tui/app.js";
import { drawInputHint } from "../tui/effects.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tui layout", () => {
  it("renders a codex-like single-column workspace preview", () => {
    const frame = renderTuiFrame({
      locale: "vi-VN",
      projectName: "castor-demo",
      activeBookTitle: undefined,
      automationMode: "semi",
      status: "idle",
    });

    expect(frame).toContain("Dự án castor-demo");
    expect(frame).toContain("Giai đoạn Sẵn sàng");
    expect(frame).toContain("Chế độ bán tự động");
    expect(frame).not.toContain("Header");
    expect(frame).not.toContain("Conversation");
    expect(frame).not.toContain("Status");
    expect(frame).not.toContain("Composer");
    expect(frame).toContain("Nói cho Castor");
  });

  it("keeps the two-line status strip above the composer preview", () => {
    const frame = renderTuiFrame({
      locale: "en",
      projectName: "castor-demo",
      activeBookTitle: "Night Harbor Echo",
      automationMode: "auto",
      status: "writing",
      messages: ["user: continue", "assistant: Completed write_next for harbor."],
      events: ["task.completed: Completed write_next for harbor."],
    });

    expect(frame).toContain("Night Harbor Echo");
    expect(frame).toContain("writing");
    expect(frame).toContain("user: continue");
    expect(frame).toContain("task.completed: Completed write_next for harbor.");
    expect(frame.indexOf("task.completed: Completed write_next for harbor.")).toBeLessThan(frame.indexOf("Ask Castor"));
    expect(frame.indexOf("Mode auto")).toBeLessThan(frame.indexOf("Ask Castor"));
  });

  it("does not add blank lines before the readline prompt", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    drawInputHint();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
