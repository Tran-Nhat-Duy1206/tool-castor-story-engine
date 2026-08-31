import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { InteractionSession } from "@actalk/castor-core";

function createSession(): InteractionSession {
  return {
    sessionId: "session-1",
    projectRoot: "/tmp/castor-demo",
    activeBookId: "harbor",
    activeChapterNumber: 12,
    automationMode: "semi",
    currentExecution: {
      status: "writing",
      bookId: "harbor",
      chapterNumber: 12,
      stageLabel: "writing chapter",
    },
    pendingDecision: {
      kind: "review",
      bookId: "harbor",
      chapterNumber: 12,
      summary: "Review chapter 12 before publishing.",
    },
    messages: [
      { role: "user", content: "continue current book", timestamp: 1 },
      { role: "assistant", content: "Working on chapter 12.", timestamp: 2 },
    ],
    events: [
      {
        kind: "task.started",
        timestamp: 3,
        status: "writing",
        bookId: "harbor",
        chapterNumber: 12,
        detail: "Preparing chapter 12.",
      },
    ],
    draftRounds: [],
  };
}

describe("ink dashboard", () => {
  it("renders a codex-like single column with compact status and composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="castor-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("castor-demo");
    expect(frame).toContain("Night Harbor Echo");
    expect(frame).toContain("gpt-5.4 (openai)");
    expect(frame).toContain("writing chapter");
    expect(frame).toContain("│");
    expect(frame).toContain("continue current book");
    expect(frame).not.toContain("You  continue current book");
    expect(frame).not.toContain("Header");
    expect(frame).not.toContain("Conversation");
    expect(frame).not.toContain("Status");
    expect(frame).not.toContain("Composer");
  }, 20_000);

  it("places the initial caret before the placeholder text", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="castor-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
        showComposerCursor
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("│");
  });

  it("renders the compact status strip directly above the composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="castor-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="continue"
        isSubmitting
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("writing chapter");
    expect(frame).toContain("continue");
  });

  it("renders a slash autocomplete dropdown under the composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="castor-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="/c"
        isSubmitting={false}
        slashSuggestions={["/clear", "/config"]}
        selectedSlashIndex={1}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("/clear");
    expect(frame).toContain("/config");
    expect(frame.indexOf("/clear")).toBeGreaterThan(frame.indexOf("› /c"));
  });

  it("renders a low-frequency bar cursor in the active composer", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="en"
        projectName="castor-demo"
        activeBookTitle="Night Harbor Echo"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue="continue"
        isSubmitting={false}
        showComposerCursor
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("continue");
    expect(frame).toContain("│");
  });

  it("defaults dashboard chrome to Vietnamese when locale is vi-VN", async () => {
    const mod = await import("../tui/dashboard.js");

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="vi-VN"
        projectName="castor-demo"
        activeBookTitle="Tiếng Vọng Cảng Đêm"
        modelLabel="gpt-5.4 (openai)"
        session={createSession()}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Dự án castor-demo");
    expect(frame).toContain("Tác phẩm Tiếng Vọng Cảng Đêm");
    expect(frame).toContain("Độ sâu tiêu chuẩn");
    expect(frame).toContain("Dự án");
  });

  it("surfaces the shared creation draft when no active book exists yet", async () => {
    const mod = await import("../tui/dashboard.js");

    const draftSession: InteractionSession = {
      ...createSession(),
      activeBookId: undefined,
      activeChapterNumber: undefined,
      currentExecution: {
        status: "planning",
        stageLabel: "developing book draft",
      },
      pendingDecision: undefined,
      creationDraft: {
        concept: "test_mockHuyen bi，test_mock。",
        title: "test_mock",
        nextQuestion: "test_mock，test_mock？",
        missingFields: ["targetChapters"],
        readyToCreate: false,
      },
      messages: [
        { role: "user", content: "test_mockHuyen bi。", timestamp: 1 },
        { role: "assistant", content: "test_mock。", timestamp: 2 },
      ],
      events: [],
    };

    const { lastFrame } = render(
      <mod.InkTuiDashboard
        locale="vi-VN"
        projectName="castor-demo"
        modelLabel="gpt-5.4 (openai)"
        session={draftSession}
        inputValue=""
        isSubmitting={false}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Bản nháp");
    expect(frame).toContain("test_mock");
  });
});
