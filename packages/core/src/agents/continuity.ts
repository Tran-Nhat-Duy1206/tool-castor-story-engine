import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { FanficMode } from "../models/book.js";
import type { ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./fanfic-dimensions.js";
import { readFile, readdir } from "node:fs/promises";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";
import { join } from "node:path";

export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  /** True when the auditor response itself was not parseable; callers must not auto-revise content from this result. */
  readonly parseFailed?: boolean;
  /** 0-100 overall quality score. Present when the auditor supports scoring. */
  readonly overallScore?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
  readonly repairScope?: "local" | "structural" | "unknown";
}

type PromptLanguage = "vi" | "en";

function normalizeRepairScope(value: unknown): AuditIssue["repairScope"] {
  if (value === "local" || value === "structural" || value === "unknown") return value;
  return undefined;
}

const DIMENSION_LABELS: Record<number, { readonly vi: string; readonly en: string }> = {
  1: { vi: "Kiểm tra OOC", en: "OOC Check" },
  2: { vi: "Kiểm tra Dòng thời gian", en: "Timeline Check" },
  3: { vi: "Kiểm tra Xung đột Thiết lập", en: "Lore Conflict Check" },
  4: { vi: "Kiểm tra Thang Sức mạnh", en: "Power Scaling Check" },
  5: { vi: "Kiểm tra Nhất quán Số liệu", en: "Numerical Consistency Check" },
  6: { vi: "Kiểm tra Móc truyện", en: "Hook Check" },
  7: { vi: "Kiểm tra Nhịp độ", en: "Pacing Check" },
  8: { vi: "Kiểm tra Văn phong", en: "Style Check" },
  9: { vi: "Kiểm tra Ranh giới Thông tin", en: "Information Boundary Check" },
  10: { vi: "Kiểm tra Lạm dụng Từ ngữ", en: "Lexical Fatigue Check" },
  11: { vi: "Kiểm tra Chuỗi Động cơ", en: "Incentive Chain Check" },
  12: { vi: "Kiểm tra Chính xác Niên đại", en: "Era Accuracy Check" },
  13: { vi: "Kiểm tra Năng lực Nhân vật Phụ", en: "Side Character Competence Check" },
  14: { vi: "Kiểm tra Công cụ hoá Nhân vật Phụ", en: "Side Character Instrumentalization Check" },
  15: { vi: "Kiểm tra Pha loãng Cao trào", en: "Payoff Dilution Check" },
  16: { vi: "Kiểm tra Độ chân thực Thoại", en: "Dialogue Authenticity Check" },
  17: { vi: "Kiểm tra Trôi dạt Biên niên", en: "Chronicle Drift Check" },
  18: { vi: "Kiểm tra Ô nhiễm Cơ sở Kiến thức", en: "Knowledge Base Pollution Check" },
  19: { vi: "Kiểm tra Nhất quán Góc nhìn", en: "POV Consistency Check" },
  20: { vi: "Kiểm tra Đồng đều Đoạn văn", en: "Paragraph Uniformity Check" },
  21: { vi: "Kiểm tra Mật độ Sáo ngữ", en: "Cliche Density Check" },
  22: { vi: "Kiểm tra Cú bẻ lái Công thức", en: "Formulaic Twist Check" },
  23: { vi: "Kiểm tra Cấu trúc Liệt kê", en: "List-like Structure Check" },
  24: { vi: "Kiểm tra Đình trệ Tuyến phụ", en: "Subplot Stagnation Check" },
  25: { vi: "Kiểm tra Đường cong Phẳng", en: "Arc Flatline Check" },
  26: { vi: "Kiểm tra Nhịp điệu Đơn điệu", en: "Pacing Monotony Check" },
  27: { vi: "Kiểm tra Nội dung Nhạy cảm", en: "Sensitive Content Check" },
  28: { vi: "Kiểm tra Xung đột Sự kiện Chính tuyến", en: "Mainline Canon Event Conflict" },
  29: { vi: "Kiểm tra Rò rỉ Tri thức Tương lai", en: "Future Knowledge Leak Check" },
  30: { vi: "Kiểm tra Nhất quán Quy tắc Thế giới Liên tác phẩm", en: "Cross-Book World Rule Check" },
  31: { vi: "Kiểm tra Cô lập Móc truyện Ngoại truyện", en: "Spinoff Hook Isolation Check" },
  32: { vi: "Kiểm tra Kỳ vọng Độc giả", en: "Reader Expectation Check" },
  33: { vi: "Kiểm tra Lệch Ghi nhớ Chương", en: "Chapter Memo Drift Check" },
  34: { vi: "Kiểm tra Độ trung thành Nhân vật", en: "Character Fidelity Check" },
  35: { vi: "Kiểm tra Tuân thủ Quy tắc Thế giới", en: "World Rule Compliance Check" },
  36: { vi: "Kiểm tra Động lực Quan hệ", en: "Relationship Dynamics Check" },
  37: { vi: "Kiểm tra Nhất quán Sự kiện Chính điển", en: "Canon Event Consistency Check" },
};

function containsVietnamese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function resolveGenreLabel(genreId: string, profileName: string, _language: PromptLanguage): string {
  if (!containsVietnamese(profileName)) {
    return profileName;
  }

  if (genreId === "other") {
    return "general";
  }

  return genreId.replace(/[_-]+/g, " ");
}

function dimensionName(id: number, language: PromptLanguage): string | undefined {
  return DIMENSION_LABELS[id]?.[language];
}

function joinLocalized(items: ReadonlyArray<string>, _language: PromptLanguage): string {
  return items.join(", ");
}

function formatFanficSeverityNote(
  severity: "critical" | "warning" | "info",
  _language: PromptLanguage,
): string {
  return severity === "critical"
    ? "Strict check."
    : severity === "info"
      ? "Log only; do not fail the chapter."
      : "Warning level.";
}

function buildDimensionNote(
  id: number,
  _language: PromptLanguage,
  gp: GenreProfile,
  bookRules: BookRules | null,
  fanficMode: FanficMode | undefined,
  fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined,
): string {
  const words = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : gp.fatigueWords;

  if (id === 1 && fanficMode === "ooc") {
    return "In OOC mode, personality drift can be intentional; record only, do not fail. Evaluate against the character dossiers in fanfic_canon.md.";
  }

  if (id === 1 && fanficMode === "canon") {
    return "Canon-faithful fanfic: characters must stay close to their original personality core. Evaluate against fanfic_canon.md character dossiers.";
  }

  if (id === 10 && words.length > 0) {
    return `Fatigue words: ${words.join(", ")}. Also check AI tell markers; warn when any appears more than once per 3,000 words.`;
  }

  if (id === 15 && gp.satisfactionTypes.length > 0) {
    return `Payoff types: ${gp.satisfactionTypes.join(", ")}`;
  }

  if (id === 12 && bookRules?.eraConstraints) {
    const era = bookRules.eraConstraints;
    const parts = [era.period, era.region].filter(Boolean);
    if (parts.length > 0) {
      return `Era: ${parts.join(", ")}`;
    }
  }

  // v10: Enhanced dimension notes with writing methodology awareness
  if (id === 7) {
    return "Check pacing rhythm: Do the recent 3-5 chapters form a complete mini-goal cycle (build-up → escalation → climax → aftermath)? If 5+ consecutive chapters pass without a climax (payoff/reward/reversal), flag as pacing stagnation. If the previous chapter was a climax/big reversal, does this chapter show change (relationships shifted, status changed, costs paid)? If it jumps straight to new build-up without showing impact, flag as 'post-climax impact missing'. Daily/transition scenes must carry at least one task: plant a hook, advance a relationship, set up contrast, or prepare the next cycle.";
  }

  if (id === 15) {
    const base = gp.satisfactionTypes.length > 0
      ? `Payoff types: ${gp.satisfactionTypes.join(", ")}. `
      : "";
    return `${base}Check desire engine: Has the chapter created an emotional gap (reader wants release) OR delivered a payoff that exceeds expectations? A payoff that only satisfies 70% of built-up anticipation counts as diluted. If this chapter is in the aftermath phase of a mini-goal cycle, verify that consequences are shown — not just emotional reactions, but concrete changes to status, relationships, or resources.`;
  }

  if (id === 25) {
    return "Cross-check character behavior against the 3-question test: (1) Why does the character do this? (2) Does it match their established profile? (3) Would a reader who only read prior chapters find it jarring? Also check if character's emotional state progresses or stagnates.";
  }

  switch (id) {
    case 6:
      // Phase 7 — hook-debt escalation. Reviewer now reads pending_hooks.md
      // not just for "is this hook undelivered" but for causal/temporal
      // debt escalation.
      return `Hook-debt escalation (Phase 7 + hotfixes 2/3). Read the pending_hooks.md ledger and escalate based on the stale / blocked / core_hook / depends_on / promoted columns, NOT only on "undelivered hook present":

• Critical severity only applies to hooks with promoted=true in the ledger. A stale/blocked non-promoted hook stays at info — the promotion flag is the gate that keeps reviewer noise down, because architect-seed emits many non-load-bearing seeds.
• A promoted core_hook=true hook that has been stale for over 10 chapters → escalate from warning to critical. The book has only 3-7 core hooks; letting one drift that long is the lead symptom of narrative rot.
• A promoted hook whose status cell contains "blocked on X (blocked Y chapters)" with Y >= 6 → warning. The literal "blocked Y chapters" token comes straight from the ledger — read it, don't guess. Call out the upstream hook id so the planner can route the resolution.
• At volume end (final chapter of any volume per volume_map) a promoted core_hook that is still open or stale without explicit "carried over to volume N+1" planning → critical.
• Any non-promoted stale hook → info-level log; do not fail the chapter on it, but note it so the planner can schedule cleanup.

Quote the exact hook_id in description and include the stale / blocked marker text verbatim. Structure check only — do not judge hook prose quality.`;
    case 19:
      return "Check whether POV shifts are signaled clearly and stay consistent with the configured viewpoint.";
    case 24:
      return "Cross-check subplot_board and chapter_summaries: flag any subplot that stays dormant long enough to feel abandoned, or a recent run where every subplot is only restated instead of genuinely moving.";
    case 25:
      return "Cross-check emotional_arcs and chapter_summaries: flag any major character whose emotional line holds one pressure shape across a run instead of taking new pressure, release, reversal, or reinterpretation. Distinguish unchanged circumstances from unchanged inner movement.";
    case 26:
      return "Cross-check chapter_summaries for chapter-type distribution: warn when the recent sequence stays in the same mode long enough to flatten rhythm, or when payoff / release beats disappear for too long. Explicitly list the recent type sequence.";
    case 28:
      return "Check whether spinoff events contradict the mainline canon constraints.";
    case 29:
      return "Check whether characters reference information that should only be revealed after the divergence point (see the information-boundary table).";
    case 30:
      return "Check whether the spinoff violates mainline world rules (power system, geography, factions).";
    case 31:
      return "Check whether the spinoff resolves mainline hooks without authorization (warning level).";
    case 32:
      return "Check whether the ending renews curiosity, whether promised payoffs are landing on the cadence their hooks imply, whether pressure gets any release, and whether reader expectation gaps are accumulating faster than they are being satisfied. If a climax just occurred, check whether the aftermath chapters show concrete change before starting a new cycle.";
    case 33:
      return "Cross-check the chapter_memo provided with the chapter. Does the final prose deliver the memo's goal and leave a visible trace for every one of the 7 sections it contains (tasks, pay-offs / held-back cards, daily/transition function map, three-question check, end-of-chapter concrete changes, hard-don'ts)? Missing or contradicted sections -> critical. Note: a sparse memo (breather chapter, goal + skeleton body only) is legitimate — only flag drift against sections that the memo actually populates. Never flag the memo itself for being sparse.";
    case 34:
    case 35:
    case 36:
    case 37: {
      if (!fanficConfig) return "";
      const severity = fanficConfig.severityOverrides.get(id) ?? "warning";
      const baseNote = {
            34: "Check whether dialogue tics, speaking style, and behavior remain consistent with the character dossiers in fanfic_canon.md. Deviations need clear situational motivation.",
            35: "Check whether the chapter violates world rules documented in fanfic_canon.md (geography, power system, faction relations).",
            36: "Check whether relationship beats remain plausible and aligned with, or meaningfully develop from, the key relationships documented in fanfic_canon.md.",
            37: "Check whether the chapter contradicts the key event timeline in fanfic_canon.md.",
          }[id];

      return baseNote
        ? `${baseNote} ${formatFanficSeverityNote(severity, _language)}`
        : "";
    }
    default:
      return "";
  }
}

function buildDimensionList(
  gp: GenreProfile,
  bookRules: BookRules | null,
  language: PromptLanguage,
  hasParentCanon = false,
  fanficMode?: FanficMode,
): ReadonlyArray<{ readonly id: number; readonly name: string; readonly note: string }> {
  const activeIds = new Set(gp.auditDimensions);

  // Add book-level additional dimensions (supports both numeric IDs and name strings)
  if (bookRules?.additionalAuditDimensions) {
    // Build reverse lookup: name → id
    const nameToId = new Map<string, number>();
    for (const [id, labels] of Object.entries(DIMENSION_LABELS)) {
      nameToId.set(labels.vi, Number(id));
      nameToId.set(labels.en, Number(id));
    }

    for (const d of bookRules.additionalAuditDimensions) {
      if (typeof d === "number") {
        activeIds.add(d);
      } else if (typeof d === "string") {
        // Try exact match first, then substring match
        const exactId = nameToId.get(d);
        if (exactId !== undefined) {
          activeIds.add(exactId);
        } else {
          // Fuzzy: find dimension whose name contains the string
          for (const [name, id] of nameToId) {
            if (name.includes(d) || d.includes(name)) {
              activeIds.add(id);
              break;
            }
          }
        }
      }
    }
  }

  // Always-active dimensions
  activeIds.add(32); // Reader Expectation Management — universal
  activeIds.add(33); // Chapter Memo Drift — universal (replaces legacy volume-outline drift)

  // Conditional overrides
  if (gp.eraResearch || bookRules?.eraConstraints?.enabled) {
    activeIds.add(12);
  }

  // Spinoff dimensions — activated when parent_canon.md exists (but NOT in fanfic mode)
  if (hasParentCanon && !fanficMode) {
    activeIds.add(28); // Mainline Canon Event Conflict
    activeIds.add(29); // Future Knowledge Leak
    activeIds.add(30); // Cross-Book World Rule Consistency
    activeIds.add(31); // Spinoff Hook Isolation
  }

  // Fanfic dimensions — replace spinoff dims with fanfic-specific checks
  let fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined;
  if (fanficMode) {
    fanficConfig = getFanficDimensionConfig(fanficMode, bookRules?.allowedDeviations);
    for (const id of fanficConfig.activeIds) {
      activeIds.add(id);
    }
    for (const id of fanficConfig.deactivatedIds) {
      activeIds.delete(id);
    }
  }

  const dims: Array<{ id: number; name: string; note: string }> = [];

  for (const id of [...activeIds].sort((a, b) => a - b)) {
    const name = dimensionName(id, language);
    if (!name) continue;

    const note = buildDimensionNote(id, language, gp, bookRules, fanficMode, fanficConfig);

    dims.push({ id, name, note });
  }

  return dims;
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: {
      temperature?: number;
      chapterIntent?: string;
      chapterMemo?: ChapterMemo;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    },
  ): Promise<AuditResult> {
    const [diskCurrentState, diskLedger, diskHooks, styleGuideRaw, subplotBoard, emotionalArcs, characterMatrix, chapterSummaries, parentCanon, fanficCanon, volumeOutline] =
      await Promise.all([
        // Phase 5 consolidation: derive initial state from roles + seed hooks
        // when current_state.md is still the architect seed placeholder.
        readCurrentStateWithFallback(bookDir, "(file not found)"),
        this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
        this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
        this.readFileSafe(join(bookDir, "story/style_guide.md")),
        this.readFileSafe(join(bookDir, "story/subplot_board.md")),
        this.readFileSafe(join(bookDir, "story/emotional_arcs.md")),
        readCharacterContext(bookDir, "(file not found)"),
        this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
        this.readFileSafe(join(bookDir, "story/parent_canon.md")),
        this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
        readVolumeMap(bookDir, "(file not found)"),
      ]);
    const currentState = options?.truthFileOverrides?.currentState ?? diskCurrentState;
    const ledger = options?.truthFileOverrides?.ledger ?? diskLedger;
    const hooks = options?.truthFileOverrides?.hooks ?? diskHooks;

    const hasParentCanon = parentCanon !== "(file not found)";
    const hasFanficCanon = fanficCanon !== "(file not found)";

    // Load last chapter full text for fine-grained continuity checking
    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist.
    // Phase 5 hotfix 2: parsedRules.body is only populated for legacy
    // book_rules.md sources — story_frame.md frontmatter yields an empty
    // body, and an empty string is NOT a usable style guide. Treat
    // missing/empty body as "no fallback available".
    const legacyRulesBody = parsedRules?.body?.trim();
    const styleGuide = styleGuideRaw !== "(file not found)"
      ? styleGuideRaw
      : (legacyRulesBody || "(no style guide)");

    const rawLanguage = bookLanguage ?? gp.language;
    const resolvedLanguage: PromptLanguage = rawLanguage === "en" ? "en" : "vi";
    const fanficMode = hasFanficCanon ? (bookRules?.fanficMode as FanficMode | undefined) : undefined;
    const dimensions = buildDimensionList(gp, bookRules, resolvedLanguage, hasParentCanon, fanficMode);
    const dimList = dimensions
      .map((d) => `${d.id}. ${d.name}${d.note ? ` (${d.note})` : ""}`)
      .join("\n");
    const genreLabel = resolveGenreLabel(genreId, gp.name, resolvedLanguage);

    const protagonistBlock = bookRules?.protagonist
      ? `\n\nProtagonist lock: ${bookRules.protagonist.name}; personality locks: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; behavioral constraints: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
      : "";

    const searchNote = gp.eraResearch
      ? "\n\nYou have web-search capability (search_web / fetch_url). For real-world eras, people, events, geography, or policies, you must verify with search_web instead of relying on memory. Cross-check at least 2 sources."
      : "";

    const systemPromptBase = `You are a strict ${genreLabel} web-fiction structural editor. Audit the chapter for completion and structure, not for prose craft. ALL OUTPUT MUST BE IN ENGLISH.${protagonistBlock}${searchNote}

## Reviewer Scope (hard constraints)

You audit completion and structure only. Your job is to decide whether the chapter delivers the plan, keeps characters and timelines intact, and moves the book forward. Wording, sentence rhythm, paragraph shape, punctuation, imagery, and other prose-surface choices are NOT yours — those belong to the Polisher pass that runs after you. If you notice prose-surface issues, you may flag them with severity "info" so the Polisher can see them, but they do not count toward passed / overall_score and they must never be critical.

You audit twelve structural reader-pain patterns: dragging / flat openings, blurry worldbuilding disconnected from reality, contradictory character setup, tangled POV, mainline drift or stagnation, weak conflict with missing payoff, pacing loss of control and abrupt transitions, character inconsistency across the arc, thin/one-note characters without contrast, stiff emotion expression and abrupt relationship jumps, imbalanced cheats/power gifts, and settings that never land in concrete action. Alongside these, keep the engineering dimensions listed below (OOC, timeline coherence, information boundary, hook debt, cross-chapter repetition, lexical fatigue, length band, title fatigue, paragraph shape).

Sparse chapter_memo is legitimate. Breather / aftermath / transition chapters may ship a memo that only contains goal + a skeleton body — do NOT flag such memos as incomplete, and do NOT penalise the chapter for lacking content against sections the memo itself does not populate. Judge drift only against what the memo actually says.

If the chapter memo, rule stack, or supplied context specifies content proportions between lines (politics/romance, career/relationship, case/character, etc.), audit whether those lines appear as actual scenes, dialogue, action, or relationship movement. A line that is only summarized in one sentence counts as missing. Mark it critical only when the memo explicitly required it for this chapter.

For every issue, set repair_scope as a typed routing hint: "local" for wording, paragraph shape, small repetition, or narrow sentence-level fixes; "structural" for plot drift, timeline break, missing scene/payoff, character logic collapse, POV/knowledge boundary failure, or anything requiring a rewritten scene/chapter; "unknown" only when you genuinely cannot decide.

Audit dimensions:
${dimList}

Output format MUST be JSON:
{
  "passed": true/false,
  "overall_score": 0-100,
  "issues": [
	    {
	      "severity": "critical|warning|info",
	      "repair_scope": "local|structural|unknown",
	      "category": "dimension name",
	      "description": "specific issue description",
	      "suggestion": "fix suggestion"
	    }
  ],
  "summary": "one-sentence audit conclusion"
}

passed is false ONLY when critical-severity issues exist.

overall_score calibration:
- 95-100: Publishable as-is, no noticeable issues
- 85-94: Minor blemishes but smooth reading, the reader won't break immersion
- 75-84: Noticeable problems but the story backbone holds, needs revision but not urgent
- 65-74: Multiple issues hurt the reading experience, pacing or continuity has gaps
- < 65: Structural breakdown, needs major rewrite
Score holistically — do not let a single minor issue tank the score.`;
    const systemPrompt = await this.withPromptPackGuidance(systemPromptBase, "longform.auditor");

    const ledgerBlock = gp.numericalSystem
      ? `\n## Resource Ledger\n${ledger}`
      : "";

    // Smart context filtering for auditor — same logic as writer
    const bookRulesForFilter = parsedRules?.rules ?? null;
    const filteredSubplots = filterSubplots(subplotBoard);
    const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRulesForFilter?.protagonist?.name);
    const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
    const filteredHooks = filterHooks(hooks);

    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, (resolvedLanguage === "en" ? "en" : "vi") as any)
      : undefined;

    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? (filteredHooks !== "(file not found)"
        ? `\n## Pending Hooks\n${filteredHooks}\n`
        : "");
    const subplotBlock = filteredSubplots !== "(file not found)"
      ? `\n## Subplot Board\n${filteredSubplots}\n`
      : "";
    const emotionalBlock = filteredArcs !== "(file not found)"
      ? `\n## Emotional Arcs\n${filteredArcs}\n`
      : "";
    const matrixBlock = filteredMatrix !== "(file not found)"
      ? `\n## Character Interaction Matrix\n${filteredMatrix}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (filteredSummaries !== "(file not found)"
        ? `\n## Chapter Summaries (for pacing checks)\n${filteredSummaries}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const canonBlock = hasParentCanon
      ? `\n## Mainline Canon Reference (for spinoff audit)\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? `\n## Fanfic Canon Reference (for fanfic audit)\n${fanficCanon}\n`
      : "";

    const memoBlock = options?.chapterMemo
      ? `\n## Chapter Memo (for memo drift checks)\nGoal: ${options.chapterMemo.goal}\n\n${options.chapterMemo.body}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? `\n## Style Guide\n${styleGuide}`
      : "";

    const prevChapterBlock = previousChapter
      ? `\n## Previous Chapter Full Text (for transition checks)\n${previousChapter}\n`
      : "";

    const userPrompt = `Review chapter ${chapterNumber}.

## Current State Card
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock}${memoBlock}${prevChapterBlock}${styleGuideBlock}

## Chapter Content Under Review
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3 };

    // Use web search for fact verification when eraResearch is enabled
    const response = gp.eraResearch
      ? await this.chatWithSearch(chatMessages, chatOptions)
      : await this.chat(chatMessages, chatOptions);

    const result = this.parseAuditResult(response.content, resolvedLanguage);
    return { ...result, tokenUsage: response.usage };
  }

  private parseAuditResult(content: string, language: PromptLanguage): AuditResult {
    // Try multiple JSON extraction strategies (handles small/local models)

    // Strategy 1: Find balanced JSON object (not greedy)
    const balanced = this.extractBalancedJson(content);
    if (balanced) {
      const result = this.tryParseAuditJson(balanced, language);
      if (result) return result;
    }

    // Strategy 2: Try the whole content as JSON (some models output pure JSON)
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const result = this.tryParseAuditJson(trimmed, language);
      if (result) return result;
    }

    // Strategy 3: Look for ```json code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const result = this.tryParseAuditJson(codeBlockMatch[1]!.trim(), language);
      if (result) return result;
    }

    // Strategy 4: Try to extract individual fields via regex (last resort fallback)
    const passedMatch = content.match(/"passed"\s*:\s*(true|false)/);
    const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
    const summaryMatch = content.match(/"summary"\s*:\s*"([^"]*)"/);
    if (passedMatch) {
      const issues: AuditIssue[] = [];
      if (issuesMatch) {
        // Try to parse individual issue objects
        const issuePattern = /\{[^{}]*"severity"\s*:\s*"[^"]*"[^{}]*\}/g;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(issuesMatch[1]!)) !== null) {
          try {
            const issue = JSON.parse(match[0]);
	            issues.push({
	              severity: issue.severity ?? "warning",
	              category: issue.category ?? "Uncategorized",
	              description: issue.description ?? "",
	              suggestion: issue.suggestion ?? "",
	              repairScope: normalizeRepairScope(issue.repair_scope ?? issue.repairScope),
	            });
          } catch {
            // skip malformed individual issue
          }
        }
      }
      return {
        passed: passedMatch[1] === "true",
        issues,
        summary: summaryMatch?.[1] ?? "",
      };
    }

    return {
      passed: false,
      parseFailed: true,
      issues: [{
        severity: "critical",
        category: "System Error",
        description: "Audit output format was invalid and could not be parsed as JSON.",
        suggestion: "The model may not support reliable structured output. Try a stronger model or inspect the API response format.",
      }],
      summary: "Audit output parsing failed",
    };
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: PromptLanguage,
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    return `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
  }

  private extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  private tryParseAuditJson(json: string, language: PromptLanguage = "en"): AuditResult | null {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.passed !== "boolean" && parsed.passed !== undefined) return null;
      const rawScore = parsed.overall_score ?? parsed.overallScore;
      const overallScore = typeof rawScore === "number" && Number.isFinite(rawScore)
        ? Math.round(Math.max(0, Math.min(100, rawScore)))
        : undefined;
      return {
        passed: Boolean(parsed.passed ?? false),
        issues: Array.isArray(parsed.issues)
	          ? parsed.issues.map((i: Record<string, unknown>) => ({
	              severity: (i.severity as string) ?? "warning",
	              category: (i.category as string) ?? "Uncategorized",
	              description: (i.description as string) ?? "",
	              suggestion: (i.suggestion as string) ?? "",
	              repairScope: normalizeRepairScope(i.repair_scope ?? i.repairScope),
	            }))
          : [],
        summary: String(parsed.summary ?? ""),
        overallScore,
      };
    } catch {
      return null;
    }
  }

  private async loadPreviousChapter(bookDir: string, currentChapter: number): Promise<string> {
    if (currentChapter <= 1) return "";
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const paddedPrev = String(currentChapter - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (!prevFile) return "";
      return await readFile(join(chaptersDir, prevFile), "utf-8");
    } catch {
      return "";
    }
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(file not found)";
    }
  }
}
