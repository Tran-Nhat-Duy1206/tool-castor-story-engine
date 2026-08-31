import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContinuationImportTool,
  createFanficBookTool,
  createImitationBookTool,
  createSpinoffBookTool,
} from "../agent/agent-tools.js";
import { StateManager } from "../state/manager.js";

function mockPipeline() {
  return {
    runWithAgentContext: vi.fn(async (
      context: { readonly signal?: AbortSignal },
      task: () => Promise<unknown>,
    ) => {
      context.signal?.throwIfAborted();
      return task();
    }),
    initFanficBook: vi.fn(async () => undefined),
    initSpinoffBook: vi.fn(async () => undefined),
    initImitationBook: vi.fn(async () => undefined),
    importChapters: vi.fn(async (input: {
      bookId: string;
      chapters: ReadonlyArray<{ title: string; content: string }>;
    }) => ({
      bookId: input.bookId,
      importedCount: input.chapters.length,
      totalWords: 1200,
      nextChapter: input.chapters.length + 1,
    })),
  };
}

describe("derivative-work agent tools", () => {
  let root: string;
  let state: StateManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "castor-derivative-tools-"));
    state = new StateManager(root);
    await state.saveBookConfig("harbor", {
      id: "harbor",
      title: "Trang Sổ Cảng Sương",
      platform: "tomato",
      genre: "suspense",
      status: "active",
      language: "vi",
      targetChapters: 80,
      chapterWordCount: 2400,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates fanfiction from confirmed source text inside the agent context", async () => {
    const pipeline = mockPipeline();
    const controller = new AbortController();
    const tool = createFanficBookTool(pipeline as never, root);

    const result = await tool.execute("fanfic-1", {
      title: "Thư Gửi Cảng Sương",
      sourceText: "Trong nguyên tác, Lâm Lộc canh giữ một ngọn hải đăng bỏ hoang.",
      sourceName: "Chính Điển Cảng Sương",
      mode: "canon",
      targetChapters: 24,
      language: "vi",
    }, controller.signal);

    expect(pipeline.initFanficBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "th-g-i-c-ng-s-ng",
        title: "Thư Gửi Cảng Sương",
        fanficMode: "canon",
        targetChapters: 24,
      }),
      "Trong nguyên tác, Lâm Lộc canh giữ một ngọn hải đăng bỏ hoang.",
      "Chính Điển Cảng Sương",
      "canon",
    );
    expect(pipeline.runWithAgentContext).toHaveBeenCalledWith(
      { signal: controller.signal, activatedSkills: [] },
      expect.any(Function),
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "fanfic",
      bookId: "th-g-i-c-ng-s-ng",
    });
  });

  it("inherits parent-book defaults when creating a side story", async () => {
    const pipeline = mockPipeline();
    const tool = createSpinoffBookTool(pipeline as never, root);

    const result = await tool.execute("spinoff-1", {
      title: "Sổ Cũ Đêm Mưa",
      parentBookId: "harbor",
      direction: "Đêm cuối cùng trước khi lão thuyền công mất tích",
    });

    expect(pipeline.initSpinoffBook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "s-c-m-m-a",
        parentBookId: "harbor",
        platform: "tomato",
        genre: "suspense",
        targetChapters: 80,
        chapterWordCount: 2400,
      }),
      "harbor",
      "Đêm cuối cùng trước khi lão thuyền công mất tích",
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "spinoff",
      parentBookId: "harbor",
    });
  });

  it("creates an original imitation project without copying the reference plot", async () => {
    const pipeline = mockPipeline();
    const tool = createImitationBookTool(pipeline as never, root);

    const result = await tool.execute("imitation-1", {
      title: "Vụ Án Đèn Giấy Mới",
      referenceText: "Mưa rơi từng giọt từ mái hiên, như một chiếc chuông ngập ngừng.",
      sourceName: "Tản Văn Tham Khảo",
      storyIdea: "Nhân viên lưu trữ huyện điều tra loạt giấy chứng tử bị đánh tráo",
      genre: "suspense",
    });

    expect(pipeline.initImitationBook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "v-n-n-gi-y-m-i", title: "Vụ Án Đèn Giấy Mới" }),
      "Mưa rơi từng giọt từ mái hiên, như một chiếc chuông ngập ngừng.",
      "Nhân viên lưu trữ huyện điều tra loạt giấy chứng tử bị đánh tráo",
      "Tản Văn Tham Khảo",
    );
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "imitation",
      bookId: "v-n-n-gi-y-m-i",
    });
  });

  it("imports an uploaded manuscript into a newly created continuation book", async () => {
    await mkdir(join(root, ".castor", "uploads", "continuation"), { recursive: true });
    await writeFile(
      join(root, ".castor", "uploads", "continuation", "novel.txt"),
      "Chapter 1 Cảng Mưa\n\nLâm Lộc tìm thấy một cuốn sổ ở bến cảng cũ.\n\nChapter 2 Số Trống\n\nĐầu dây bên kia chỉ có tiếng sóng.\n",
      "utf-8",
    );
    const pipeline = mockPipeline();
    const tool = createContinuationImportTool(pipeline as never, null, root);

    const result = await tool.execute("continuation-1", {
      title: "Cảng Sương Phần Tiếp",
      sourcePath: ".castor/uploads/continuation/novel.txt",
      language: "vi",
    });

    expect(pipeline.importChapters).toHaveBeenCalledWith({
      bookId: "c-ng-s-ng-ph-n-ti-p",
      chapters: [
        { title: "Cảng Mưa", content: "Lâm Lộc tìm thấy một cuốn sổ ở bến cảng cũ." },
        { title: "Số Trống", content: "Đầu dây bên kia chỉ có tiếng sóng." },
      ],
      resumeFrom: undefined,
      importMode: "continuation",
    });
    await expect(state.loadBookConfig("c-ng-s-ng-ph-n-ti-p")).resolves.toMatchObject({
      id: "c-ng-s-ng-ph-n-ti-p",
      title: "Cảng Sương Phần Tiếp",
    });
    expect(result.details).toMatchObject({
      kind: "book_created",
      creationKind: "continuation",
      bookId: "c-ng-s-ng-ph-n-ti-p",
      importedCount: 2,
    });
  });

  it("rejects non-uploaded absolute continuation paths", async () => {
    const pipeline = mockPipeline();
    const tool = createContinuationImportTool(pipeline as never, null, root);

    await expect(tool.execute("continuation-absolute", {
      title: "Đường Dẫn Không An Toàn",
      sourcePath: join(root, "novel.txt"),
    })).rejects.toThrow("must be project-relative");
    expect(pipeline.importChapters).not.toHaveBeenCalled();
  });
});
