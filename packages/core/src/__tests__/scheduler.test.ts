import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler, type SchedulerConfig } from "../pipeline/scheduler.js";
import type { BookConfig } from "../models/book.js";

function createConfig(): SchedulerConfig {
  return {
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 1024,
        thinkingBudget: 0,
      },
    } as SchedulerConfig["client"],
    model: "test-model",
    projectRoot: process.cwd(),
    radarCron: "*/1 * * * *",
    writeCron: "*/1 * * * *",
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 0,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 10,
  };
}

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not start a second write cycle while one is still running", async () => {
    const scheduler = new Scheduler(createConfig());
    let releaseCycle: (() => void) | undefined;
    const blockedCycle = new Promise<void>((resolve) => {
      releaseCycle = resolve;
    });

    const runWriteCycle = vi
      .spyOn(scheduler as unknown as { runWriteCycle: () => Promise<void> }, "runWriteCycle")
      .mockImplementation(async () => {
        if (runWriteCycle.mock.calls.length === 1) {
          return;
        }
        await blockedCycle;
      });
    vi.spyOn(scheduler as unknown as { runRadarScan: () => Promise<void> }, "runRadarScan")
      .mockResolvedValue(undefined);

    await scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runWriteCycle).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runWriteCycle).toHaveBeenCalledTimes(2);

    releaseCycle?.();
    await blockedCycle;
    scheduler.stop();
  });

  it("treats state-degraded chapter results as handled failures", async () => {
    const onChapterComplete = vi.fn();
    const scheduler = new Scheduler({
      ...createConfig(),
      onChapterComplete,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockResolvedValue({
        chapterNumber: 3,
        title: "Broken State",
        wordCount: 2100,
        revised: false,
        status: "state-degraded",
        auditResult: {
          passed: true,
          issues: [{
            severity: "warning",
            category: "state-validation",
            description: "state validation still failed after retry",
            suggestion: "repair state before continuing",
          }],
          summary: "clean",
        },
    });
    const handleAuditFailure = vi.spyOn(
      scheduler as unknown as { handleAuditFailure: (bookId: string, chapterNumber: number, issueCategories?: string[]) => Promise<void> },
      "handleAuditFailure",
    ).mockResolvedValue(undefined);

    const success = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<boolean>;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(success).toBe(false);
    expect(handleAuditFailure).toHaveBeenCalledWith("book-1", 3, ["state-validation"]);
    expect(onChapterComplete).toHaveBeenCalledWith("book-1", 3, "state-degraded");
  });

  it("treats needs-state-review as successful publication and pauses further advancement (I-1)", async () => {
    const onChapterComplete = vi.fn();
    const scheduler = new Scheduler({
      ...createConfig(),
      chaptersPerCycle: 3,
      onChapterComplete,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    const writeNextSpy = vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockResolvedValue({
      chapterNumber: 1,
      title: "Gated Chapter",
      wordCount: 2100,
      revised: false,
      status: "needs-state-review",
      auditResult: { passed: true, issues: [], summary: "clean" },
    });
    const handleAuditFailure = vi.spyOn(
      scheduler as unknown as { handleAuditFailure: (bookId: string, chapterNumber: number, issueCategories?: string[]) => Promise<void> },
      "handleAuditFailure",
    ).mockResolvedValue(undefined);
    const recordChapterWritten = vi.spyOn(
      scheduler as unknown as { recordChapterWritten: () => void },
      "recordChapterWritten",
    );

    // Drive the multi-chapter loop directly: a gated result must count as
    // success AND terminate the cycle without retries or a second chapter.
    (scheduler as unknown as { running: boolean }).running = true;
    const success = await (
      scheduler as unknown as {
        processBook: (bookId: string, bookConfig: BookConfig) => Promise<void>;
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<boolean>;
      }
    ).processBook("book-1", bookConfig);

    expect(writeNextSpy).toHaveBeenCalledTimes(1);
    expect(handleAuditFailure).not.toHaveBeenCalled();
    expect(recordChapterWritten).toHaveBeenCalledTimes(1);
    expect(onChapterComplete).toHaveBeenCalledWith("book-1", 1, "needs-state-review");
    void success;
  });

  it("keeps treating ready-for-review as scheduler success (legacy regression)", async () => {
    const onChapterComplete = vi.fn();
    const scheduler = new Scheduler({
      ...createConfig(),
      onChapterComplete,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockResolvedValue({
      chapterNumber: 2,
      title: "Legacy Chapter",
      wordCount: 2100,
      revised: false,
      status: "ready-for-review",
      auditResult: { passed: true, issues: [], summary: "clean" },
    });

    const success = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<boolean>;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(success).toBe(true);
    expect(onChapterComplete).toHaveBeenCalledWith("book-1", 2, "ready-for-review");
  });
});
