import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { LengthSpec } from "../models/length-governance.js";
import { buildLengthSpec } from "../utils/length-metrics.js";
import { readBookRules as readAuthoritativeBookRules } from "./rules-reader.js";
import {
  ChapterIntentSchema,
  type ChapterIntent,
  type ChapterMemo,
} from "../models/input-governance.js";
import {
  renderHookSnapshot,
  renderSummarySnapshot,
} from "../utils/memory-retrieval.js";
import {
  gatherPlanningMaterials,
  loadPlanningSeedMaterials,
} from "../utils/planning-materials.js";
import { parseMemo, PlannerParseError } from "../utils/chapter-memo-parser.js";
import {
  buildPlannerUserMessage,
  getPlannerMemoSystemPrompt,
} from "./planner-prompts.js";
import {
  composeCurrentArcProse,
  extractCollaboratorRows,
  extractOpponentRows,
  extractProtagonistRow,
  formatRelevantThreads,
  formatRecentSummaries,
  formatRecyclableHooks,
  readBookRules,
  readCharacterMatrix,
  readEmotionalArcs,
  readSubplotBoard,
} from "./planner-context.js";
import type { StoredHook } from "../state/memory-db.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly memo: ChapterMemo;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

const MEMO_RETRY_LIMIT = 3;

/**
 * Phase 3 planner.
 *
 * Produces:
 *   - a simplified ChapterIntent (goal + outline + keep/avoid/style) —
 *     still deterministic, used for retrieval hints and the intent markdown.
 *   - a full ChapterMemo (plain markdown sections) via LLM call + strict
 *     parser.
 *
 * Retry policy: up to 3 attempts. Each failed parse appends an error
 * feedback block to the user message and re-invokes the LLM. If all attempts
 * fail, the planner emits a degraded but valid memo with an explicit warning
 * instead of crashing the whole chapter pipeline.
 */
export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const seedMaterials = await loadPlanningSeedMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
    });
    const outlineNode = this.findOutlineNode(seedMaterials.volumeOutline, input.chapterNumber);
    const goal = this.deriveGoal(
      input.externalContext,
      seedMaterials.currentFocus,
      seedMaterials.authorIntent,
      outlineNode,
      input.chapterNumber,
    );
    // Phase hotfix 5: read structured rules through the Phase 5 authoritative
    // loader. It prefers outline/story_frame.md frontmatter, falls back to
    // legacy book_rules.md, and refuses to silently zero out rules when the
    // legacy file is just a compat shim. Reading raw bookRulesRaw via
    // parseBookRules() bypassed all of that.
    const parsedRules = await readAuthoritativeBookRules(input.bookDir);
    const prohibitions = parsedRules?.rules.prohibitions ?? [];
    const mustKeep = this.collectMustKeep(seedMaterials.currentState, seedMaterials.storyBible);
    const mustAvoid = this.collectMustAvoid(seedMaterials.currentFocus, prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(seedMaterials.authorIntent, seedMaterials.currentFocus);
    const materials = await gatherPlanningMaterials({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode,
      mustKeep,
      seed: seedMaterials,
    });
    const memorySelection = materials.memorySelection;
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;

    const arcContext = this.buildArcContext(
      input.book.language,
      seedMaterials.volumeOutline,
      outlineNode,
    );

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      arcContext,
      mustKeep,
      mustAvoid,
      styleEmphasis,
    });

    const isGoldenOpening = this.isGoldenOpeningChapter(input.book.language, input.chapterNumber);
    // Vietnamese books use word-based counting like English; map vi -> en_words.
    const normalizedLengthLanguage = "en" as const;
    const lengthSpec = buildLengthSpec(
      input.book.chapterWordCount,
      normalizedLengthLanguage as unknown as Parameters<typeof buildLengthSpec>[1],
    );
    const memo = await this.planChapterMemo({
      storyDir,
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      isGoldenOpening,
      fallbackGoal: goal,
      chapterSummariesRaw: seedMaterials.chapterSummariesRaw,
      previousEndingExcerpt: seedMaterials.previousEndingExcerpt,
      brief: seedMaterials.brief,
      chapterContext: input.externalContext,
      relevantHooks: memorySelection.hooks,
      recyclableHooks: memorySelection.recyclableHooks,
      // Phase hotfix 4: thread book language through so the planner uses
      // English prompts (system + user template + golden opening guidance)
      // for English books instead of always-Vietnamese.
      language: (input.book.language ?? "vi") as "vi" | "en",
      lengthSpec,
    });

    // memo.goal is LLM-produced and specific (<=50 chars, validated).
    // Overwrite intent.goal so downstream composer/retrieval gets the
    // concrete task statement instead of the outline-derived fallback.
    intent.goal = memo.goal;

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      memo,
      (input.book.language ?? "vi") as "vi" | "en",
      renderHookSnapshot(memorySelection.hooks, ((input.book.language ?? "vi") === "en" ? "en" : "zh") as unknown as Parameters<typeof renderHookSnapshot>[1]),
      renderSummarySnapshot(memorySelection.summaries, ((input.book.language ?? "vi") === "en" ? "en" : "zh") as unknown as Parameters<typeof renderSummarySnapshot>[1]),
      activeHookCount,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      memo,
      intentMarkdown,
      plannerInputs: materials.plannerInputs,
      runtimePath,
    };
  }

  /**
   * Invoke the LLM to produce a 7-section memo and parse it. Retries up to
   * 3 times on parse failure, injecting the error message back into the user
   * prompt so the LLM can correct itself.
   */
  async planChapterMemo(input: {
    readonly storyDir: string;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly isGoldenOpening: boolean;
    readonly fallbackGoal: string;
    readonly chapterSummariesRaw: string;
    readonly previousEndingExcerpt?: string;
    readonly brief?: string;
    readonly chapterContext?: string;
    readonly relevantHooks?: ReadonlyArray<StoredHook>;
    readonly recyclableHooks?: ReadonlyArray<StoredHook>;
    readonly language?: "vi" | "en";
    readonly lengthSpec: LengthSpec;
  }): Promise<ChapterMemo> {
    const [characterMatrix, subplotBoard, emotionalArcs, bookRulesRaw] = await Promise.all([
      readCharacterMatrix(input.storyDir),
      readSubplotBoard(input.storyDir),
      readEmotionalArcs(input.storyDir),
      readBookRules(input.storyDir),
    ]);

    const language = (input.language ?? "vi") as "vi" | "en";
    // Machine prompts are English canonical — do not localize to Vietnamese.
    const noPriorChapter = "(this is the opening chapter — no prior chapter)";
    const noBookRules = "(no book_rules entries)";
    const retryFeedbackHeader = "## Error from previous output";
    const retryFeedbackTrailer = "Fix and re-emit.";

    // English canonical for machine prompts — always "en" internally, keep `language` for user-facing fallback.
    const promptLanguage: "en" = "en";
    const userMessage = buildPlannerUserMessage({
      chapterNumber: input.chapterNumber,
      previousChapterEndingExcerpt: input.previousEndingExcerpt?.trim()
        ? input.previousEndingExcerpt.trim()
        : noPriorChapter,
      recentSummaries: formatRecentSummaries(input.chapterSummariesRaw, input.chapterNumber, 3),
      currentArcProse: composeCurrentArcProse(subplotBoard, emotionalArcs, input.chapterNumber),
      protagonistMatrixRow: extractProtagonistRow(characterMatrix),
      opponentRows: extractOpponentRows(characterMatrix, 3),
      collaboratorRows: extractCollaboratorRows(characterMatrix, 3),
      relevantThreads: formatRelevantThreads(input.relevantHooks ?? [], subplotBoard, promptLanguage as unknown as Parameters<typeof formatRelevantThreads>[2]),
      recyclableHooks: formatRecyclableHooks(
        input.recyclableHooks ?? [],
        input.chapterNumber,
        promptLanguage as unknown as Parameters<typeof formatRecyclableHooks>[2],
      ),
      isGoldenOpening: input.isGoldenOpening,
      bookRulesRelevant: bookRulesRaw.trim().length > 0 ? bookRulesRaw.trim() : noBookRules,
      lengthBudget: {
        target: input.lengthSpec.target,
        softMin: input.lengthSpec.softMin,
        softMax: input.lengthSpec.softMax,
        hardMin: input.lengthSpec.hardMin,
        hardMax: input.lengthSpec.hardMax,
        unit: "words",
      },
      brief: input.brief ?? "",
      chapterContext: input.chapterContext ?? "",
      language: promptLanguage as unknown as Parameters<typeof buildPlannerUserMessage>[0]["language"],
    });

    const systemPrompt = getPlannerMemoSystemPrompt(promptLanguage as unknown as Parameters<typeof getPlannerMemoSystemPrompt>[0]);

    let currentUserMessage = userMessage;
    let lastError: PlannerParseError | undefined;

    for (let attempt = 0; attempt < MEMO_RETRY_LIMIT; attempt += 1) {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: currentUserMessage },
        ],
        { temperature: 0.7 },
      );

      try {
        return parseMemo(response.content, input.chapterNumber, input.isGoldenOpening);
      } catch (error) {
        if (!(error instanceof PlannerParseError)) {
          throw error;
        }
        lastError = error;
        this.log?.warn(`[planner] memo parse failed (attempt ${attempt + 1}/${MEMO_RETRY_LIMIT}): ${error.message}`);
        currentUserMessage = `${userMessage}\n\n${retryFeedbackHeader}\n${error.message}\n${retryFeedbackTrailer}`;
      }
    }

    const fallbackError = lastError ?? new PlannerParseError("memo planner exhausted retries without a specific error");
    this.log?.warn(`[planner] memo planner fell back after ${MEMO_RETRY_LIMIT} attempts: ${fallbackError.message}`);
    return parseMemo(
      this.buildFallbackMemoMarkdown({
        chapterNumber: input.chapterNumber,
        isGoldenOpening: input.isGoldenOpening,
        fallbackGoal: input.fallbackGoal,
        errorMessage: fallbackError.message,
        language,
        lengthSpec: input.lengthSpec,
      }),
      input.chapterNumber,
      input.isGoldenOpening,
    );
  }

  private buildFallbackMemoMarkdown(input: {
    readonly chapterNumber: number;
    readonly isGoldenOpening: boolean;
    readonly fallbackGoal: string;
    readonly errorMessage: string;
    readonly language: "vi" | "en";
    readonly lengthSpec: LengthSpec;
  }): string {
    if (input.language === "en") {
      return [
        `# Chapter ${input.chapterNumber} memo`,
        "",
        "## Chapter goal",
        input.fallbackGoal || `Continue chapter ${input.chapterNumber} according to the current outline`,
        "",
        "## Thread refs",
        "none",
        "",
        "## Scene and length budget",
        `Plan 2-5 concrete scenes whose combined draft length stays within ${input.lengthSpec.hardMin}-${input.lengthSpec.hardMax} words and aims for ${input.lengthSpec.target} words. Give each scene a distinct action, consequence, and approximate word budget.`,
        "",
        "## Current task",
        `Use the current chapter goal and authoritative book context to continue chapter ${input.chapterNumber} without inventing a new direction.`,
        "",
        "## What the reader is waiting for right now",
        "Keep the reader's active expectation from the outline and previous chapter in focus; do not replace it with a generic scene.",
        "",
        "## To pay off / to keep buried",
        "Pay off only the near-term promises already supported by context; keep larger secrets buried unless the outline explicitly asks for them.",
        "",
        "## What the slow / transitional beats carry",
        "If a slower beat is needed, make it carry pressure, evidence, relationship movement, or a concrete setup for the next action.",
        "",
        "## Three-question check on the key choice",
        "The protagonist's main choice must have a reason, match current interest, and stay consistent with the established persona.",
        "",
        "## Required end-of-chapter change",
        "End with a concrete change in information, pressure, relationship, objective, or risk so the chapter is not only summary.",
        "",
        "## Hook ledger for this chapter",
        "advance: keep the active promise moving; resolve: only settle what has evidence; defer: preserve larger threads for later chapters.",
        "",
        "## Do not",
        "Do not contradict established facts, ignore the user's current instruction, or turn the fallback memo into a new outline.",
        "",
        "## Planner warning",
        `The model failed to produce a valid chapter memo after ${MEMO_RETRY_LIMIT} attempts. Last parser error: ${input.errorMessage}`,
      ].join("\n");
    }

    return [
      `# Chương ${input.chapterNumber} memo`,
      "",
      "## Mục tiêu chương",
      input.fallbackGoal || `Tiếp tục triển khai Chương ${input.chapterNumber} theo dàn ý hiện tại`,
      "",
      "## Liên kết mạch truyện",
      "không có",
      "",
      "## Cảnh và ngân sách độ dài",
      `Lập kế hoạch 2-5 cảnh cụ thể có hành động và hệ quả rõ ràng, tổng độ dài kiểm soát trong ${input.lengthSpec.hardMin}-${input.lengthSpec.hardMax} từ, mục tiêu khoảng ${input.lengthSpec.target} từ; phân bổ ngân sách từ động cho mỗi cảnh, không lấp đầy bằng tóm tắt hay độc thoại nội tâm lặp lại.`,
      "",
      "## Nhiệm vụ hiện tại",
      `Tiếp tục Chương ${input.chapterNumber} theo mục tiêu chương hiện tại và bối cảnh chuẩn, không đổi hướng tạm thời, cũng không viết chương thành đoạn chuyển tiếp chung chung.`,
      "",
      "## Độc giả đang chờ đợi điều gì",
      "Tiếp nối kỳ vọng của độc giả được hình thành từ dàn ý và chương trước, ưu tiên đáp ứng sự thay đổi về áp lực, chứng cứ, mối quan hệ hoặc mục tiêu đã được thiết lập.",
      "",
      "## Cần thực hiện / tạm giữ lại",
      "Chỉ thực hiện những cam kết gần đã được bối cảnh hiện tại hỗ trợ; những bí mật lớn hơn, thân phận, kẻ giật dây hay thông tin kết cục, trừ khi dàn ý yêu cầu rõ ràng, vẫn tiếp tục giữ lại.",
      "",
      "## Nhịp chậm / chuyển cảnh đảm nhận điều gì",
      "Nếu cần nhịp chậm hoặc chuyển cảnh, nó phải gánh vác áp lực, chứng cứ, mối quan hệ nhân vật, thay đổi mục tiêu hoặc lót đường cho hành động tiếp theo, không chỉ là tán gẫu và bầu không khí.",
      "",
      "## Kiểm tra ba câu hỏi cho lựa chọn then chốt",
      "Lựa chọn then chốt của nhân vật chính trong chương này phải có lý do, phù hợp với lợi ích hiện tại và không đi chệch khỏi thiết lập nhân vật đã xây dựng.",
      "",
      "## Thay đổi bắt buộc cuối chương",
      "Cuối chương ít nhất phải có một thay đổi rõ rệt về thông tin, áp lực, mối quan hệ, mục tiêu hoặc rủi ro, tránh chỉ có tóm tắt cốt truyện mà không có tiến triển.",
      "",
      "## Sổ Hook chương này",
      "advance: thúc đẩy cam kết đang hoạt động; resolve: chỉ kết thúc những mạch đã có chứng cứ hỗ trợ; defer: giữ lại mạch lớn cho vị trí phù hợp hơn.",
      "",
      "## Không làm",
      "Không vi phạm sự thật đã thành, không bỏ qua chỉ thị hiện tại của người dùng, không biến fallback memo thành dàn ý mới viết lại toàn bộ sách.",
      "",
      "## Cảnh báo Planner",
      `Mô hình đã không tạo được memo chương hợp lệ sau ${MEMO_RETRY_LIMIT} lần thử. Lỗi phân tích cuối cùng: ${input.errorMessage}`,
    ].join("\n");
  }

  private isGoldenOpeningChapter(language: string | undefined, chapterNumber: number): boolean {
    const isVi = (language ?? "vi").toLowerCase().startsWith("vi");
    return isVi ? chapterNumber <= 3 : chapterNumber <= 5;
  }

  private buildArcContext(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
  ): string | undefined {
    if (!outlineNode) return undefined;
    if (volumeOutline === "(Tệp chưa được tạo)") return undefined;
    // Keep legacy Chinese check for reading old outlines but produce Vietnamese for new output.
    if (volumeOutline === "(\u6587\u4EF6\u5C1A\u672A\u521B\u5EFA)") return undefined;
    return this.isVietnameseLanguage(language)
      ? `Nút dàn ý tập: ${outlineNode}`
      : `Outline node: ${outlineNode}`;
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    outlineNode: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "không làm",
      "tránh",
      "cấm",
      "không nên",
      // Legacy Chinese outlines (escaped) — keep for reading old files
      "\u7981\u6b62",
      "\u907f\u514d",
      "\u907f\u96f7",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /avoid|don't|do not|không làm|đừng|cấm|tránh|\u4e0d\u8981|\u522b|\u7981\u6b62/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "tiêu điểm hiện tại",
      "trọng tâm hiện tại",
      "tiêu điểm gần đây",
      // Legacy Chinese (escaped)
      "\u5f53\u524d\u805a\u7126",
      "\u5f53\u524d\u7126\u70b9",
      "\u8fd1\u671f\u805a\u7126",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsVietnamese(focusSection) ? "; " : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "ghi đè cục bộ",
      "ghi đè chương này",
      "ghi đè tạm thời",
      "ghi đè hiện tại",
      // Legacy Chinese (escaped)
      "\u5c40\u90e8\u8986\u76d6",
      "\u672c\u7ae0\u8986\u76d6",
      "\u4e34\u65f6\u8986\u76d6",
      "\u5f53\u524d\u8986\u76d6",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsVietnamese(overrideSection) ? "; " : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "tiêu điểm hiện tại",
      "trọng tâm hiện tại",
      "tiêu điểm gần đây",
      // Legacy Chinese (escaped)
      "\u5f53\u524d\u805a\u7126",
      "\u5f53\u524d\u7126\u70b9",
      "\u8fd1\u671f\u805a\u7126",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private renderHookBudget(activeCount: number, language: "vi" | "en"): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : `### Ngân sách Hook\n- Hiện tại ${activeCount} hook đang hoạt động (sức chứa: ${cap})`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : `### Ngân sách Hook\n- Hiện tại ${activeCount} hook đang hoạt động — gần đạt sức chứa (${cap}). Chỉ còn ${remaining} hook mới được phép. Ưu tiên giải quyết nợ tồn đọng thay vì mở thêm mạch mới.`;
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write|mô tả|miêu tả|điền|viết)\b[\s\S]*\)$/i.test(normalized)
      || /^[\(\uFF08](?:describe|briefly describe|write|m\u00F4 t\u1EA3|mi\u00EAu t\u1EA3|\u0111i\u1EC1n|vi\u1EBFt)[\s\S]*[\)\uFF09]$/iu.test(normalized)
      // Legacy Chinese placeholder (escaped) — keep for reading old files: \uFF08\u5728\u8FD9\u91CC\u63CF\u8FF0 etc.
      || /^\uFF08(?:\u5728\u8FD9\u91CC\u63CF\u8FF0|\u63CF\u8FF0|\u586B\u5199|\u5199\u4E0B)[\s\S]*\uFF09$/u.test(normalized)
    );
  }

  private containsVietnamese(content: string): boolean {
    return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ]/i.test(content);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return inlineContent;
      }

      const rangeStart = Number(match[1]);
      const sectionContent = this.extractSectionAroundRange(lines, index);
      if (sectionContent) {
        const beatIndex = chapterNumber - rangeStart;
        const specificBeat = this.extractNumberedBeat(sectionContent, beatIndex);
        return specificBeat ?? sectionContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }

      break;
    }

    return this.extractFirstDirective(volumeOutline);
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  private extractSectionAroundRange(lines: ReadonlyArray<string>, rangeLineIndex: number): string | undefined {
    let headingIndex = -1;
    for (let i = rangeLineIndex - 1; i >= 0; i--) {
      if (lines[i]!.startsWith("#")) {
        headingIndex = i;
        break;
      }
      if (this.matchAnyRangeOutlineLine(lines[i]!) || this.matchAnyExactOutlineLine(lines[i]!)) {
        break;
      }
    }

    if (headingIndex < 0) {
      return undefined;
    }

    const headingLine = lines[headingIndex]!;
    const headingLevel = headingLine.match(/^(#+)/)?.[1]?.length ?? 3;

    const sectionLines: string[] = [];
    for (let i = headingIndex; i < lines.length; i++) {
      if (i > headingIndex) {
        const nextHeadingMatch = lines[i]!.match(/^(#+)/);
        if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingLevel) {
          break;
        }
      }
      sectionLines.push(lines[i]!);
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : undefined;
  }

  private extractNumberedBeat(section: string, beatIndex: number): string | undefined {
    if (beatIndex < 0) return undefined;

    const beats: string[] = [];
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (/^\d+[.)]\s/.test(trimmed)) {
        beats.push(trimmed.replace(/^\d+[.)]\s*/, ""));
      }
    }

    if (beats.length === 0 || beatIndex >= beats.length) return undefined;
    return beats[beatIndex];
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chương\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      // Legacy Chinese (escaped) — reading old outlines only
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?\\u7b2c\\s*${chapterNumber}\\s*\\u7ae0(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chương\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      // Legacy Chinese (escaped)
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?\u7b2c\s*\d+\s*\u7ae0(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chương\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      // Legacy Chinese (escaped)
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?\u7b2c\s*(\d+)\s*[-~–—]\s*(\d+)\s*\u7ae0(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:[-*]\s+)?(?:\*\*)?Phạm vi chương(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*Chương\s*(.*)$/i,
      // Legacy Chinese escaped for \u7ae0\u8282\u8303\u56f4
      /^(?:[-*]\s+)?(?:\*\*)?\u7ae0\u8282\u8303\u56f4(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*\u7ae0\s*(.*)$/,
      /^(?:[-*]\s+)?(?:\*\*)?Chapter\s*[Rr]ange(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\b\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    memo: ChapterMemo,
    language: "vi" | "en",
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
  ): string {
    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";

    const memoBody = memo.body.trim();
    const threadRefsLine = memo.threadRefs.length > 0
      ? memo.threadRefs.map((id) => `- ${id}`).join("\n")
      : "- (none)";

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      "## Arc Context",
      intent.arcContext ?? "(none)",
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Chapter Memo",
      `- isGoldenOpening: ${memo.isGoldenOpening ? "true" : "false"}`,
      "",
      "### Thread Refs",
      threadRefsLine,
      "",
      "### Body",
      memoBody,
      "",
      this.renderHookBudget(activeHookCount, language),
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isVietnameseLanguage(language: string | undefined): boolean {
    return (language ?? "vi").toLowerCase().startsWith("vi");
  }

  // Kept for potential subclasses reading seed files directly.
  protected async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(Tệp chưa được tạo)";
    }
  }
}
