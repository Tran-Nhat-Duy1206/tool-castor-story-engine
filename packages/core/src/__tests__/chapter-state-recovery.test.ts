import { describe, expect, it, vi } from "vitest";
import type { AuditIssue } from "../agents/continuity.js";
import type {
  ValidationResult,
  ValidationWarning,
} from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import {
  buildStateDegradedPersistenceOutput,
  buildStateDegradedReviewNote,
  parseStateDegradedReviewNote,
  resolveStateDegradedBaseStatus,
  retrySettlementAfterValidationFailure,
} from "../pipeline/chapter-state-recovery.js";

function createBook(): BookConfig {
  return {
    id: "test-book",
    title: "Test Book",
    platform: "tomato",
    genre: "xuanhuan",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 3000,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function createValidationWarning(
  overrides: Partial<ValidationWarning> = {},
): ValidationWarning {
  return {
    category: overrides.category ?? "current-state",
    description: overrides.description ?? "mock_text",
  };
}

function createValidationResult(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    passed: overrides.passed ?? false,
    warnings: overrides.warnings ?? [createValidationWarning()],
  };
}

function createWriteChapterOutput(
  overrides: Partial<WriteChapterOutput> = {},
): WriteChapterOutput {
  return {
    chapterNumber: 3,
    title: "Chương mock_text",
    content: "mock_text。",
    wordCount: "mock_text。".length,
    preWriteCheck: "ok",
    postSettlement: "ok",
    updatedState: "new state",
    updatedLedger: "new ledger",
    updatedHooks: "new hooks",
    chapterSummary: "| 3 | Chương mock_text |",
    updatedSubplots: "new subplots",
    updatedEmotionalArcs: "new emotional arcs",
    updatedCharacterMatrix: "new character matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
    ...overrides,
  };
}

function createChapterMeta(
  overrides: Partial<ChapterMeta> = {},
): ChapterMeta {
  return {
    number: 3,
    title: "Chương mock_text",
    status: "state-degraded",
    wordCount: 1200,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    auditIssues: [],
    lengthWarnings: [],
    ...overrides,
  };
}

describe("chapter-state-recovery", () => {
  it("retries settlement with localized validation feedback and recovers on a clean retry", async () => {
    let capturedFeedback = "";
    const writer = {
      settleChapterState: vi.fn(async (input: { validationFeedback?: string }) => {
        capturedFeedback = input.validationFeedback ?? "";
        return createWriteChapterOutput({
          updatedState: "fixed state",
          updatedHooks: "fixed hooks",
        });
      }),
    };
    const validator = {
      validate: vi.fn(async () => createValidationResult({
        passed: true,
        warnings: [],
      })),
    };
    const logWarn = vi.fn();
    const warn = vi.fn();

    const result = await retrySettlementAfterValidationFailure({
      writer: writer as never,
      validator: validator as never,
      book: createBook(),
      bookDir: "/tmp/test-book",
      chapterNumber: 3,
      title: "Chương mock_text",
      content: "mock_text。",
      oldState: "old state",
      oldHooks: "old hooks",
      originalValidation: createValidationResult(),
      language: "vi",
      logWarn,
      logger: { warn } as never,
    });

    expect(result.kind).toBe("recovered");
    expect(capturedFeedback).toContain("mock_text");
    expect(capturedFeedback).toContain("mock_text");
    expect(writer.settleChapterState).toHaveBeenCalledWith(expect.objectContaining({
      allowReapply: true,
    }));
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({
      vi: expect.stringContaining("mock_text"),
    }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns localized degraded issues when settlement retry still fails", async () => {
    const validatorWarning = createValidationWarning({
      description: "mock_text",
    });
    const result = await retrySettlementAfterValidationFailure({
      writer: {
        settleChapterState: vi.fn(async () => createWriteChapterOutput()),
      } as never,
      validator: {
        validate: vi.fn(async () => createValidationResult({
          passed: false,
          warnings: [validatorWarning],
        })),
      } as never,
      book: createBook(),
      bookDir: "/tmp/test-book",
      chapterNumber: 3,
      title: "Chương mock_text",
      content: "mock_text。",
      oldState: "old state",
      oldHooks: "old hooks",
      originalValidation: createValidationResult({
        warnings: [validatorWarning],
      }),
      language: "vi",
      logWarn: vi.fn(),
      logger: { warn: vi.fn() } as never,
    });

    expect(result.kind).toBe("degraded");
    if (result.kind === "degraded") {
      expect(result.issues).toEqual([
        expect.objectContaining({
          category: "state-validation",
          description: "mock_text",
          suggestion: "mock_text state，mock_text。",
        }),
      ]);
    }
  });

  it("freezes truth outputs when degrading persisted settlement", () => {
    const output = createWriteChapterOutput({
      runtimeStateDelta: { chapter: 3 } as never,
      runtimeStateSnapshot: {
        chapter: 3,
        facts: [],
        hooks: [],
        chapterSummary: undefined,
      } as never,
      updatedChapterSummaries: "| 3 | mock_text |",
    });

    const degraded = buildStateDegradedPersistenceOutput({
      output,
      oldState: "stable state",
      oldHooks: "stable hooks",
      oldLedger: "stable ledger",
    });

    expect(degraded.updatedState).toBe("stable state");
    expect(degraded.updatedHooks).toBe("stable hooks");
    expect(degraded.updatedLedger).toBe("stable ledger");
    expect(degraded.runtimeStateDelta).toBeUndefined();
    expect(degraded.runtimeStateSnapshot).toBeUndefined();
    expect(degraded.updatedChapterSummaries).toBeUndefined();
  });

  it("round-trips degraded review metadata and resolves fallback base status", () => {
    const issues: AuditIssue[] = [{
      severity: "warning",
      category: "state-validation",
      description: "mock_text。",
      suggestion: "mock_text state，mock_text。",
    }];
    const note = buildStateDegradedReviewNote("audit-failed", issues);

    expect(parseStateDegradedReviewNote(note)).toEqual({
      kind: "state-degraded",
      baseStatus: "audit-failed",
      injectedIssues: ["[warning] mock_text。"],
    });

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: note,
    }))).toBe("audit-failed");

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: "{bad json",
      auditIssues: ["[critical] still broken"],
    }))).toBe("audit-failed");

    expect(resolveStateDegradedBaseStatus(createChapterMeta({
      reviewNote: "{bad json",
      auditIssues: ["[warning] needs review"],
    }))).toBe("ready-for-review");
  });
});
