import { BaseAgent } from "./base.js";
import { completeLongForm } from "../llm/long-form-completion.js";

export type ScriptTargetFormat =
  | "vertical_short_drama"
  | "screenplay"
  | "audio_drama"
  | "interactive_script"
  | "general_script";

export interface ScriptCreationInput {
  readonly title: string;
  readonly sourceKind?: string;
  readonly targetFormat?: ScriptTargetFormat;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly language?: "vi" | "en";
}

export interface StoryboardCreationInput {
  readonly title: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly visualStyle?: string;
  readonly aspectRatio?: string;
  readonly granularity?: string;
  readonly maxShots?: number;
  readonly language?: "vi" | "en";
  readonly segment?: {
    readonly label: string;
    readonly index: number;
    readonly count: number;
    readonly estimatedShots: number;
  };
}

export interface InteractiveFilmCreationInput {
  readonly title: string;
  readonly sourceKind?: string;
  readonly sourceText?: string;
  readonly requirements?: string;
  readonly targetAudience?: string;
  readonly episodeCount?: number;
  readonly episodeDuration?: string;
  readonly budget?: string;
  readonly referenceMode?: string;
  readonly language?: "vi" | "en";
}

abstract class LongFormProductionAgent extends BaseAgent {
  protected async recoverProductionMarkdown(
    fragments: string,
    language: "vi" | "en",
    requiredHeadings: readonly string[],
  ): Promise<string> {
    const response = await this.chat([
      {
        role: "system",
        content: [
          "You recover one canonical production document after a transport-confirmed output-limit continuation.",
          "The fragments may contain scratch analysis, overlapping suffixes, and complete-document restarts.",
          "Return exactly one complete Markdown deliverable. Preserve the user's requirements and the most developed usable content; remove process notes, scratch analysis, wrappers, duplicate document roots, and repeated sections.",
          "Do not summarize or shorten the actual deliverable.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          language === "en" ? "## Required Headings" : "## Tiêu đề bắt buộc",
          ...requiredHeadings.map((heading) => `- ${heading}`),
          "",
          language === "en" ? "## Output Fragments" : "## Đoạn trích đầu ra",
          fragments,
        ].join("\n"),
      },
    ], {
      temperature: 0.1,
      maxTokens: 32_000,
    });
    return response.content.trim();
  }
}

export class ScriptCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "script-creation-writer";
  }

  async writeScript(input: ScriptCreationInput): Promise<string> {
    const language = input.language ?? "vi";
    const messages = [
      { role: "system", content: buildScriptCreationSystemPrompt(language) },
      { role: "user", content: buildScriptCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {
        temperature: 0.55,
        maxTokens: estimateScriptMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[script] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en" ? ["## Characters", "## Script"] : ["## Nhân vật", "## Kịch bản"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
}

export class StoryboardCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "storyboard-creation-writer";
  }

  async writeStoryboard(input: StoryboardCreationInput): Promise<string> {
    const language = input.language ?? "vi";
    const messages = [
      { role: "system", content: buildStoryboardCreationSystemPrompt(language) },
      { role: "user", content: buildStoryboardCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {
        temperature: 0.45,
        maxTokens: estimateStoryboardMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[storyboard] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en" ? ["## Storyboard", "## Image Prompts"] : ["## Bảng phân cảnh", "## Gợi ý hình ảnh"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
}

export class InteractiveFilmCreationAgent extends LongFormProductionAgent {
  get name(): string {
    return "interactive-film-creation-writer";
  }

  async writeInteractiveFilm(input: InteractiveFilmCreationInput): Promise<string> {
    const language = input.language ?? "vi";
    const messages = [
      { role: "system", content: buildInteractiveFilmCreationSystemPrompt(language) },
      { role: "user", content: buildInteractiveFilmCreationUserPrompt(input, language) },
    ] as const;
    const response = await completeLongForm({
      messages,
      language,
      generate: (continuationMessages) => this.chat(continuationMessages, {
        temperature: 0.5,
        maxTokens: estimateInteractiveFilmMaxTokens(input),
      }),
      onContinuation: (pass) => this.log?.warn(`[interactive-film] Output limit reached; continuing pass ${pass}.`),
      recoverAfterContinuation: (fragments) => this.recoverProductionMarkdown(
        fragments,
        language,
        language === "en"
          ? ["## Story Tree", "## Variables and Flags", "## Ending Paths", "## Interactive Script", "## Storyboard and Image Prompts"]
          : ["## Cây cốt truyện", "## Bảng biến số và cờ", "## Các nhánh kết thúc", "## Kịch bản tương tác", "## Phân cảnh và gợi ý hình ảnh"],
      ),
    });
    return extractProductionDocument(response.content, input.title);
  }
}

export function renderScriptSpec(input: ScriptCreationInput): string {
  if ((input.language ?? "vi") === "en") {
    return [
      `# ${input.title} Script Creation Spec`,
      "",
      "## Goal",
      `- Deliverable: ${formatScriptTarget(input.targetFormat, "en")}`,
      input.episodeCount
        ? `- Episode/segment count: ${input.episodeCount}`
        : "- Episode/segment count: unspecified; judge from the source material and user requirements",
      input.episodeDuration
        ? `- Per-episode/segment duration: ${input.episodeDuration}`
        : "- Per-episode/segment duration: unspecified",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Adaptation Boundaries",
      "- Preserve the characters, relationships, conflicts, key events, and taboos the user explicitly specified.",
      "- Never decide adaptation intensity (\"faithful adaptation / commercial punch-up / low-budget shoot\") on the user's behalf; execute only the spec the user has confirmed.",
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} Quy cách sáng tác kịch bản`,
    "",
    "## Mục tiêu",
    `- Loại hình bàn giao: ${formatScriptTarget(input.targetFormat, "vi")}`,
    input.episodeCount ? `- Số tập/phân đoạn: ${input.episodeCount}` : "- Số tập/phân đoạn: Chưa chỉ định, căn cứ theo tư liệu và yêu cầu người dùng",
    input.episodeDuration ? `- Thời lượng mỗi tập/phân đoạn: ${input.episodeDuration}` : "- Thời lượng mỗi tập/phân đoạn: Chưa chỉ định",
    input.sourceKind ? `- Tư liệu gốc: ${input.sourceKind}` : "- Tư liệu gốc: Đầu vào người dùng / yêu cầu hội thoại",
    "",
    "## Yêu cầu người dùng",
    input.requirements?.trim() || "Chưa chỉ định riêng; lấy instruction người dùng đã xác nhận làm chuẩn.",
    "",
    "## Ranh giới chuyển thể",
    "- Ưu tiên bảo lưu nhân vật, quan hệ, xung đột, sự kiện then chốt và điều cấm kỵ mà người dùng đã nêu rõ.",
    "- Không tự ý quyết định mức độ chuyển thể thay người dùng; chỉ thực thi đúng quy cách đã xác nhận.",
    "",
    "## Tóm tắt tư liệu nguồn",
    summarizeSourceForSpec(input.sourceText, "vi"),
  ].join("\n");
}

export function renderStoryboardSpec(input: StoryboardCreationInput): string {
  if ((input.language ?? "vi") === "en") {
    return [
      `# ${input.title} Storyboard Creation Spec`,
      "",
      "## Goal",
      `- Shot granularity: ${input.granularity?.trim() || "split by scene and key shots"}`,
      `- Aspect ratio: ${input.aspectRatio?.trim() || "unspecified; default to what the user's material and target imply"}`,
      `- Visual style: ${input.visualStyle?.trim() || "unspecified; judge from the user's material and target platform"}`,
      input.maxShots ? `- Shot cap: ${input.maxShots}` : "- Shot cap: unspecified",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Storyboard Boundaries",
      "- A storyboard is a creative tool, not a locked-in shooting plan; the output must stay easy to discuss, extend, trim, and re-shoot.",
      "- Follow only the art style, format, composition, and visual constraints the user has confirmed; never turn unstated preferences into default hard constraints.",
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} Quy cách sáng tác phân cảnh`,
    "",
    "## Mục tiêu",
    `- Độ chi tiết phân cảnh: ${input.granularity?.trim() || "Tách theo cảnh và shot then chốt"}`,
    `- Tỉ lệ khung hình: ${input.aspectRatio?.trim() || "Chưa chỉ định, mặc định căn cứ theo tư liệu và nền tảng đích"}`,
    `- Phong cách thị giác: ${input.visualStyle?.trim() || "Chưa chỉ định, căn cứ theo tư liệu và nền tảng đích"}`,
    input.maxShots ? `- Giới hạn shot: ${input.maxShots}` : "- Giới hạn shot: Chưa chỉ định",
    input.sourceKind ? `- Tư liệu gốc: ${input.sourceKind}` : "- Tư liệu gốc: Đầu vào người dùng / yêu cầu hội thoại",
    "",
    "## Yêu cầu người dùng",
    input.requirements?.trim() || "Chưa chỉ định riêng; lấy instruction người dùng đã xác nhận làm chuẩn.",
    "",
    "## Ranh giới phân cảnh",
    "- Bảng phân cảnh là công cụ sáng tác, không cố định cách quay cuối cùng; đầu ra cần thuận tiện để thảo luận, thêm bớt và chỉnh sửa.",
    "- Chỉ tuân theo phong cách vẽ, định dạng, bố cục và ràng buộc thị giác người dùng đã xác nhận.",
    "",
    "## Tóm tắt tư liệu nguồn",
    summarizeSourceForSpec(input.sourceText, "vi"),
  ].join("\n");
}

export function renderInteractiveFilmSpec(input: InteractiveFilmCreationInput): string {
  if ((input.language ?? "vi") === "en") {
    return [
      `# ${input.title} Interactive Film Creation Spec`,
      "",
      "## Goal",
      "- Deliverable: interactive film / interactive narrative game / film-game script",
      "- Scope: story tree, variables/flags, playable node scripts, multiple endings, storyboards, and image assets",
      input.episodeCount
        ? `- Story segments/episodes: ${input.episodeCount}`
        : "- Story segments/episodes: unspecified; judge from the source material and user requirements",
      input.episodeDuration
        ? `- Per-segment/episode duration: ${input.episodeDuration}`
        : "- Per-segment/episode duration: unspecified",
      input.budget ? `- Budget constraint: ${input.budget}` : "- Budget constraint: unspecified",
      input.targetAudience ? `- Target audience: ${input.targetAudience}` : "- Target audience: unspecified",
      input.referenceMode
        ? `- Reference mode: ${input.referenceMode}`
        : "- Reference mode: unspecified by the user; do not impose a fixed game template",
      input.sourceKind
        ? `- Source material: ${input.sourceKind}`
        : "- Source material: user input / conversation brief",
      "",
      "## User Requirements",
      input.requirements?.trim() || "Not separately specified; follow the instruction the user confirmed.",
      "",
      "## Interactive Film Boundaries",
      "- Do not impose RPG stats, combat formulas, equipment tiers, or any other mechanics the user did not request.",
      "- Never decide subject matter, budget, art style, or commercial punch-up intensity on the user's behalf; mark anything unspecified as adjustable.",
      "",
      "## Source Material Summary",
      summarizeSourceForSpec(input.sourceText, "en"),
    ].join("\n");
  }
  return [
    `# ${input.title} Quy cách sáng tác phim tương tác`,
    "",
    "## Mục tiêu",
    "- Loại hình bàn giao: Phim tương tác / Trò chơi tự sự tương tác / Kịch bản phim game",
    "- Phạm vi bàn giao: Cây cốt truyện, biến số/cờ, kịch bản nút có thể chơi, đa kết thúc, phân cảnh và hình ảnh",
    input.episodeCount ? `- Phân đoạn/Số tập: ${input.episodeCount}` : "- Phân đoạn/Số tập: Chưa chỉ định, căn cứ theo tư liệu và yêu cầu",
    input.episodeDuration ? `- Thời lượng mỗi phân đoạn: ${input.episodeDuration}` : "- Thời lượng mỗi phân đoạn: Chưa chỉ định",
    input.budget ? `- Ngân sách: ${input.budget}` : "- Ngân sách: Chưa chỉ định",
    input.targetAudience ? `- Khán giả mục tiêu: ${input.targetAudience}` : "- Khán giả mục tiêu: Chưa chỉ định",
    input.referenceMode ? `- Chế độ tham chiếu: ${input.referenceMode}` : "- Chế độ tham chiếu: Chưa chỉ định",
    input.sourceKind ? `- Tư liệu gốc: ${input.sourceKind}` : "- Tư liệu gốc: Đầu vào người dùng / yêu cầu hội thoại",
    "",
    "## Yêu cầu người dùng",
    input.requirements?.trim() || "Chưa chỉ định riêng; lấy instruction người dùng đã xác nhận làm chuẩn.",
    "",
    "## Ranh giới phim tương tác",
    "- Không tự ý đưa vào chỉ số RPG, công thức chiến đấu hay cơ chế phức tạp mà người dùng không yêu cầu.",
    "- Không tự ý quyết định đề tài, ngân sách, phong cách vẽ thay người dùng.",
    "",
    "## Tóm tắt tư liệu nguồn",
    summarizeSourceForSpec(input.sourceText, "vi"),
  ].join("\n");
}

export function extractStoryboardImagePrompts(raw: string): string {
  const section = extractMarkdownSection(raw, [
    "Gợi ý hình ảnh",
    "Phân cảnh gợi ý hình ảnh",
    "Image Prompts",
    "Shot Image Prompts",
  ]);
  const source = section?.trim() || raw.trim();
  const prompts = extractPromptLines(source);
  return prompts.length > 0 ? prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n") : "";
}

export function extractMarkdownSection(raw: string, headings: readonly string[]): string | undefined {
  const lines = raw.split(/\r?\n/);
  let start = -1;
  let level = 0;
  const normalizedHeadings = headings.map(normalizeHeadingText);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s*(.+?)\s*$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const text = normalizeHeadingText(match[2]!);
    if (normalizedHeadings.some((heading) => headingMatches(text, heading))) {
      start = index + 1;
      level = match[1]!.length;
      break;
    }
  }
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/u.exec(lines[index] ?? "");
    if (match && match[1]!.length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function countMarkdownSections(raw: string, headings: readonly string[]): number {
  const normalizedHeadings = headings.map(normalizeHeadingText);
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(#{1,6})\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const text = normalizeHeadingText(match[2]!);
    if (normalizedHeadings.some((heading) => headingMatches(text, heading))) count += 1;
  }
  return count;
}

export function extractProductionDocument(raw: string, title: string): string {
  const lines = raw.split(/\r?\n/);
  const normalizedTitle = normalizeHeadingText(title);
  const start = lines.findIndex((line) => {
    const match = /^#\s+(.+?)\s*$/u.exec(line);
    if (!match) return false;
    return normalizeHeadingText(match[1]!).startsWith(normalizedTitle);
  });
  return (start >= 0 ? lines.slice(start).join("\n") : raw).trim();
}

function normalizeHeadingText(text: string): string {
  return text
    .trim()
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .replace(/[`*_]+/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function headingMatches(text: string, heading: string): boolean {
  if (text === heading) return true;
  if (!text.startsWith(heading)) return false;
  const rest = text.slice(heading.length).trim();
  return rest === "" || /^[（(【\[\s:：\-—]/u.test(rest);
}

export function normalizeScriptEpisodeEndLabels(script: string): string {
  const lines = script.split(/\r?\n/);
  let currentEpisode: string | null = null;
  return lines.map((line) => {
    const heading = /^#{1,6}\s*(?:Tập|Episode)\s*([\d]+)(?:\s|$)/iu.exec(line.trim());
    if (heading) currentEpisode = heading[1]!;
    if (!currentEpisode) return line;
    return line.replace(
      /(Phụ đề\s*[：:]\s*)Hết tập\s*[\d]+/gu,
      `$1Hết tập ${currentEpisode}`,
    );
  }).join("\n");
}

function buildScriptCreationSystemPrompt(language: "vi" | "en" = "vi"): string {
  return [
    "You are a script-creation tool, not a novel-continuation engine.",
    "This is a non-interactive production call after user confirmation. Execute the confirmed creation spec and source material now.",
    "Never ask a question, offer options for the user to choose, or defer writing. Resolve unspecified creative details with a coherent working choice; they remain editable later.",
    language === "en"
      ? "The deliverable must include the exact Markdown headings `## Characters` and `## Script`, followed by a complete performable script rather than a proposal or outline."
      : "The deliverable must include the exact Markdown headings `## Nhân vật` and `## Kịch bản`, followed by a complete performable script rather than a proposal or outline.",
    "Output Markdown. No process notes, no model self-narration, no \"Here is\" preamble.",
  ].join("\n");
}

function buildScriptCreationUserPrompt(input: ScriptCreationInput, language: "vi" | "en" = "vi"): string {
  if (language === "en") {
    return [
      "## Creation Spec",
      renderScriptSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible script draft strictly from the creation spec and user requirements.",
      "",
      "## Output Format",
      `# ${input.title}`,
      "",
      "## Characters",
      "",
      "## Script",
      "",
      "Follow the target format. Vertical short drama: \"Episode N / scene slug / characters / action / dialogue / end-of-episode hook\". Standard screenplay: \"scene heading / action / character / dialogue\".",
    ].join("\n");
  }
  return [
    "## Quy cách sáng tác",
    renderScriptSpec(input),
    "",
    "## Toàn văn tư liệu nguồn",
    input.sourceText?.trim() || "Người dùng không cung cấp tư liệu nguồn; hãy sáng tác bản thảo kịch bản mở rộng được dựa trên quy cách và yêu cầu.",
    "",
    "## Định dạng đầu ra",
    `# ${input.title}`,
    "",
    "## Nhân vật",
    "",
    "## Kịch bản",
    "",
    "Xuất theo định dạng đích. Phim ngắn màn hình dọc dùng \"Tập N / Cảnh / Nhân vật / Hành động / Đối thoại / Điểm nhấn cuối tập\"; kịch bản chuẩn dùng \"Tiêu đề cảnh / Hành động / Nhân vật / Đối thoại\".",
  ].join("\n");
}

function buildStoryboardCreationSystemPrompt(language: "vi" | "en" = "vi"): string {
  return [
    "You are a storyboard-creation tool. Execute the confirmed visual spec and source material; unconfirmed choices remain adjustable.",
    "Output Markdown. No model self-narration or process explanation.",
  ].join("\n");
}

function buildStoryboardCreationUserPrompt(input: StoryboardCreationInput, language: "vi" | "en" = "vi"): string {
  const maxShots = input.maxShots ?? 24;
  if (language === "en") {
    return [
      "## Storyboard Spec",
      renderStoryboardSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible storyboard draft strictly from the storyboard spec and user requirements.",
      ...(input.segment ? [
        "",
        "## Current Production Segment",
        `Write only ${input.segment.label} (${input.segment.index + 1}/${input.segment.count}) in this call. The global shot cap is NOT the shot count for this call. Preserve all global requirements and follow the exact scene/segment shot count when the user confirmed one. Do not summarize or write any other segment.`,
      ] : []),
      "",
      "## Output Format",
      `# ${input.title} Storyboard`,
      "",
      "## Storyboard",
      "",
      `Output at most ${maxShots} shots. Each shot includes: shot number, visual, characters/objects, action, shot size/camera, dialogue/captions, suggested duration, notes.`,
      "",
      "## Image Prompts",
      "",
      "Write one generation-ready image prompt per shot. Each prompt MUST be its own `Prompt: ...` line; never merge it into the storyboard body, table headers, or explanations. Include only the visual constraints the user has confirmed.",
    ].join("\n");
  }
  return [
    "## Quy cách phân cảnh",
    renderStoryboardSpec(input),
    "",
    "## Toàn văn tư liệu nguồn",
    input.sourceText?.trim() || "Người dùng không cung cấp tư liệu nguồn; hãy viết phân cảnh mở rộng được dựa trên quy cách và yêu cầu.",
    ...(input.segment ? [
      "",
      "## Phân đoạn sản xuất hiện tại",
      `Lần này chỉ viết ${input.segment.label} (${input.segment.index + 1}/${input.segment.count}). Không tóm tắt hay tạo bất kỳ phân đoạn nào khác.`,
    ] : []),
    "",
    "## Định dạng đầu ra",
    `# ${input.title} Phân cảnh`,
    "",
    "## Bảng phân cảnh",
    "",
    `Xuất không quá ${maxShots} shot. Mỗi shot gồm: Số shot, Hình ảnh, Nhân vật/Đạo cụ, Hành động, Cỡ cảnh/Góc máy, Đối thoại/Phụ đề, Thời lượng dự kiến, Ghi chú.`,
    "",
    "## Gợi ý hình ảnh",
    "",
    "Viết một gợi ý tạo ảnh cho mỗi shot. Mỗi gợi ý PHẢI nằm trên một dòng `Prompt: ...` riêng biệt.",
  ].join("\n");
}

function buildInteractiveFilmCreationSystemPrompt(language: "vi" | "en" = "vi"): string {
  return [
    "You are an interactive-film creation tool. Execute the confirmed spec and source material; unconfirmed choices remain adjustable.",
    "Output must be Markdown with the specified sections. No model self-narration, process notes, or \"Here is\" preamble.",
    "Every storyboard image prompt must be its own standalone `Prompt: ...` line so downstream asset management can pick it up; include only the visual constraints the user has confirmed.",
  ].join("\n");
}

function buildInteractiveFilmCreationUserPrompt(input: InteractiveFilmCreationInput, language: "vi" | "en" = "vi"): string {
  if (language === "en") {
    return [
      "## Interactive Film Spec",
      renderInteractiveFilmSpec(input),
      "",
      "## Full Source Material",
      input.sourceText?.trim()
        || "The user did not provide full source material; write an extensible interactive-film deliverable strictly from the creation spec and user requirements.",
      "",
      "## Output Format",
      `# ${input.title} Interactive Film Package`,
      "",
      "## Story Tree",
      "Lay out main-line nodes, branch nodes, key choices, and merge/no-return relationships as Markdown. The multi-ending structure must be visible at a glance.",
      "",
      "## Variables and Flags",
      "List each variable/flag: name, meaning, trigger, scope of impact, and related nodes. Variables may be relationships, states, evidence, items, identities, secret/public status, ending gates, and so on.",
      "",
      "## Ending Paths",
      "For every ending: its unlock conditions, the key choice chain, the required variables/flags, plus any failure or hidden-ending conditions.",
      "",
      "## Interactive Script",
      "Write a playable script per node: scene, characters, action, dialogue, player choices, variable changes, and branch destinations. Never write summaries only.",
      "",
      "## Storyboard and Image Prompts",
      "List the key shots. Each shot includes visual, characters/objects, action, shot size, and suggested duration. After each shot, add exactly one standalone `Prompt: ...` line.",
    ].join("\n");
  }
  return [
    "## Quy cách phim tương tác",
    renderInteractiveFilmSpec(input),
    "",
    "## Toàn văn tư liệu nguồn",
    input.sourceText?.trim() || "Người dùng không cung cấp tư liệu nguồn; hãy viết bản thảo phương án phim tương tác có thể mở rộng.",
    "",
    "## Định dạng đầu ra",
    `# ${input.title} Phương án phim tương tác`,
    "",
    "## Cây cốt truyện",
    "Liệt kê các nút mạch chính, nút phân nhánh, lựa chọn then chốt bằng Markdown.",
    "",
    "## Bảng biến số và cờ",
    "Liệt kê tên biến/cờ, ý nghĩa, điều kiện kích hoạt, phạm vi ảnh hưởng.",
    "",
    "## Các nhánh kết thúc",
    "Liệt kê điều kiện đạt được của từng kết thúc, chuỗi lựa chọn then chốt, biến số yêu cầu.",
    "",
    "## Kịch bản tương tác",
    "Viết kịch bản diễn được cho từng nút: Bối cảnh, nhân vật, hành động, đối thoại, lựa chọn của người chơi, thay đổi biến số.",
    "",
    "## Phân cảnh và gợi ý hình ảnh",
    "Liệt kê các shot then chốt. Sau mỗi shot phải có đúng một dòng `Prompt: ...` riêng biệt.",
  ].join("\n");
}

function formatScriptTarget(value: ScriptTargetFormat | undefined, language: "vi" | "en" = "vi"): string {
  if (language === "en") {
    switch (value) {
      case "vertical_short_drama":
        return "vertical short drama";
      case "screenplay":
        return "standard screenplay";
      case "audio_drama":
        return "audio drama";
      case "interactive_script":
        return "interactive script";
      case "general_script":
      default:
        return "general script";
    }
  }
  switch (value) {
    case "vertical_short_drama":
      return "phim ngắn màn hình dọc";
    case "screenplay":
      return "kịch bản điện ảnh chuẩn";
    case "audio_drama":
      return "kịch truyền thanh / kịch âm thanh";
    case "interactive_script":
      return "kịch bản tương tác";
    case "general_script":
    default:
      return "kịch bản chung";
  }
}

function summarizeSourceForSpec(sourceText: string | undefined, language: "vi" | "en" = "vi"): string {
  const text = sourceText?.replace(/\s+/g, " ").trim();
  if (language === "en") {
    if (!text) return "No full source material provided.";
    return `Full source material provided, about ${text.length} characters; the full content will be read during generation.`;
  }
  if (!text) return "Chưa cung cấp tài liệu nguồn đầy đủ.";
  return `Đã cung cấp tài liệu nguồn đầy đủ, khoảng ${text.length} ký tự; toàn bộ nội dung sẽ được đọc trong quá trình tạo.`;
}

function estimateScriptMaxTokens(input: ScriptCreationInput): number {
  const episodes = input.episodeCount ?? 6;
  return Math.min(32000, Math.max(12000, episodes * 2200));
}

function estimateStoryboardMaxTokens(input: StoryboardCreationInput): number {
  const shots = input.segment?.estimatedShots ?? input.maxShots ?? 24;
  return Math.min(48000, Math.max(12000, shots * 1800));
}

function estimateInteractiveFilmMaxTokens(input: InteractiveFilmCreationInput): number {
  const episodes = input.episodeCount ?? 6;
  return Math.min(36000, Math.max(16000, episodes * 3000));
}

function extractPromptLines(markdown: string): string[] {
  const prompts: string[] = [];
  let promptColumnIndex = -1;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^`{1,3}\s*/u, "")
      .replace(/\s*`{1,3}$/u, "")
      .trim();
    if (!line) {
      promptColumnIndex = -1;
      continue;
    }
    const tableCells = parseMarkdownTableRow(line);
    if (tableCells) {
      if (isMarkdownTableSeparator(tableCells)) continue;
      const headerIndex = tableCells.findIndex(isPromptColumnHeader);
      if (headerIndex >= 0) {
        promptColumnIndex = headerIndex;
        continue;
      }
      if (promptColumnIndex >= 0) {
        const prompt = cleanPromptText(tableCells[promptColumnIndex] ?? "");
        if (prompt) prompts.push(prompt);
      }
      continue;
    }
    promptColumnIndex = -1;
    const promptMatch = /(?:^|[|>\-\d.)\s])(?:\*\*)?\s*(?:Prompt(?:\s+for\s+[^:*]+)?|Gợi ý hình ảnh|Gợi ý phân cảnh|Image Prompt)(?:\s*[^:*]+)?(?:\*\*)?\s*[:：]\s*(.+?)\s*$/iu.exec(line);
    if (!promptMatch) continue;
    const prompt = cleanPromptText(promptMatch[1]!);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

function parseMarkdownTableRow(line: string): string[] | undefined {
  if (!line.startsWith("|") || !line.endsWith("|")) return undefined;
  const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : undefined;
}

function isMarkdownTableSeparator(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function isPromptColumnHeader(cell: string): boolean {
  return /^(?:prompt|image\s*prompt|shot\s*prompt|gợi ý hình ảnh|gợi ý)$/iu.test(
    cell.replace(/[`*_]+/gu, "").trim(),
  );
}

function cleanPromptText(text: string): string {
  return text
    .replace(/^`{1,3}\s*/u, "")
    .replace(/\s*`{1,3}$/u, "")
    .replace(/\s*\|\s*$/u, "")
    .replace(/\*\*$/u, "")
    .replace(/^(?:Prompt(?:\s+for\s+[^:*]+)?|Gợi ý hình ảnh|Image Prompt)\s*[:：]\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}
