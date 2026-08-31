import type { ForecastBranch, NarrativeForecast } from "./schema.js";

export function renderForecastComparisonMarkdown(forecast: NarrativeForecast): string {
  const vi = forecast.language === "vi";
  const header = vi
    ? [
        `# So sánh suy diễn diễn biến: ${forecast.divergence}`,
        "",
        `- Mã suy diễn: ${forecast.forecastId}`,
        `- Sách: ${forecast.bookId}`,
        `- Chương cơ sở: Chương ${forecast.baseChapter}`,
        `- Phạm vi suy diễn: khoảng ${forecast.horizon} chương`,
        `- Thời gian tạo: ${forecast.createdAt}`,
        "",
        "> Tài liệu này là bản thảo định hướng kế hoạch, không làm thay đổi trực tiếp văn bản chính thống.",
      ]
    : [
        `# Narrative forecast comparison: ${forecast.divergence}`,
        "",
        `- Forecast id: ${forecast.forecastId}`,
        `- Book: ${forecast.bookId}`,
        `- Base chapter: ${forecast.baseChapter}`,
        `- Horizon: ~${forecast.horizon} chapters`,
        `- Created at: ${forecast.createdAt}`,
        "",
        "> Non-canonical planning material. Nothing here modifies prose or authoritative state.",
      ];

  const tableHeader = vi
    ? ["| Nhánh | Tiêu đề | Khớp ý đồ | Số rủi ro | Tiền đề |", "| --- | --- | --- | --- | --- |"]
    : ["| Branch | Title | Intent fit | Risks | Premise |", "| --- | --- | --- | --- | --- |"];
  const tableRows = forecast.branches.map((branch) =>
    `| ${branch.branchId} | ${escapeCell(branch.title)} | ${branch.intentAlignment.score} | ${branch.risks.length} | ${escapeCell(branch.premise)} |`);

  const sections = forecast.branches.map((branch) => renderBranchSection(branch, vi));

  return [...header, "", ...tableHeader, ...tableRows, "", sections.join("\n\n")].join("\n");
}

export function renderSelectedBranchPlanMarkdown(input: {
  readonly forecast: NarrativeForecast;
  readonly branch: ForecastBranch;
  readonly selectedAt: string;
  readonly stale: boolean;
}): string {
  const { forecast, branch } = input;
  const vi = forecast.language === "vi";

  const staleWarning = input.stale
    ? (vi
        ? "> ⚠️ Bản suy diễn này đã cũ: các chương hoặc trạng thái chính thống đã thay đổi sau khi tạo bản suy diễn. Kế hoạch dưới đây dựa trên bối cảnh cũ — vui lòng kiểm tra lại trước khi áp dụng, hoặc tạo lại bản suy diễn mới nếu cần."
        : "> ⚠️ This forecast is stale: canonical chapters or state changed after it was generated. The plan below is based on outdated context — re-check before applying, and regenerate if needed.")
    : "";

  const header = vi
    ? [
        `# Kế hoạch nhánh đã chọn: ${branch.title}`,
        "",
        `- Mã suy diễn: ${forecast.forecastId}`,
        `- Nhánh: ${branch.branchId}`,
        `- Điểm phân kỳ: ${forecast.divergence}`,
        `- Chương cơ sở: Chương ${forecast.baseChapter}`,
        `- Thời gian chọn: ${input.selectedAt}`,
      ]
    : [
        `# Selected branch plan: ${branch.title}`,
        "",
        `- Forecast id: ${forecast.forecastId}`,
        `- Branch: ${branch.branchId}`,
        `- Divergence: ${forecast.divergence}`,
        `- Base chapter: ${forecast.baseChapter}`,
        `- Selected at: ${input.selectedAt}`,
      ];

  const footer = vi
    ? "> Kế hoạch này không thay đổi văn bản chính thống. Để áp dụng vào đề cương, ý đồ chương hoặc trạng thái chính thức, cần thực hiện thao tác xác nhận riêng."
    : "> This plan does not modify canon. Applying it to the outline, chapter intents, or authoritative state is a separate, explicitly confirmed operation (not automated in v1).";

  return [
    ...header,
    ...(staleWarning ? ["", staleWarning] : []),
    "",
    renderBranchSection(branch, vi, { headingLevel: 2, includeBranchId: false }),
    "",
    footer,
  ].join("\n");
}

function renderBranchSection(
  branch: ForecastBranch,
  vi: boolean,
  options: { readonly headingLevel?: number; readonly includeBranchId?: boolean } = {},
): string {
  const level = "#".repeat(options.headingLevel ?? 2);
  const sub = `${level}#`;
  const heading = options.includeBranchId === false
    ? `${level} ${branch.title}`
    : `${level} ${branch.branchId}: ${branch.title}`;

  const labels = vi
    ? {
        premise: "Tiền đề và giả định",
        beats: "Nhịp chương tương lai",
        decisions: "Quyết định nhân vật",
        changes: "Thay đổi dự kiến",
        characters: "Nhân vật",
        relationships: "Mối quan hệ",
        world: "Thế giới",
        hooks: "Hook",
        risks: "Rủi ro nhất quán",
        uncertainties: "Điều chưa chắc chắn",
        alignment: "Mức độ phù hợp ý định tác giả",
        chapterPrefix: (n: number) => `Chương ${n}`,
        none: "(không có)",
      }
    : {
        premise: "Premise and assumptions",
        beats: "Future chapter beats",
        decisions: "Character decisions",
        changes: "Projected changes",
        characters: "Characters",
        relationships: "Relationships",
        world: "World",
        hooks: "Hooks",
        risks: "Consistency risks",
        uncertainties: "Uncertainties",
        alignment: "Author intent alignment",
        chapterPrefix: (n: number) => `Chapter ${n}`,
        none: "(none)",
      };

  const list = (items: ReadonlyArray<string>): string =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : labels.none;

  return [
    heading,
    "",
    `${sub} ${labels.premise}`,
    "",
    branch.premise,
    "",
    `${sub} ${labels.beats}`,
    "",
    list(branch.beats.map((beat) => `${labels.chapterPrefix(beat.chapter)}: ${beat.summary}`)),
    "",
    `${sub} ${labels.decisions}`,
    "",
    list(branch.characterDecisions.map((decision) => `${decision.character}: ${decision.decision}`)),
    "",
    `${sub} ${labels.changes}`,
    "",
    `- ${labels.characters}: ${joinOrNone(branch.projectedChanges.characters, labels.none)}`,
    `- ${labels.relationships}: ${joinOrNone(branch.projectedChanges.relationships, labels.none)}`,
    `- ${labels.world}: ${joinOrNone(branch.projectedChanges.world, labels.none)}`,
    `- ${labels.hooks}: ${joinOrNone(branch.projectedChanges.hooks, labels.none)}`,
    "",
    `${sub} ${labels.risks}`,
    "",
    list(branch.risks.map((risk) => `[${risk.kind}] ${risk.description}`)),
    "",
    `${sub} ${labels.uncertainties}`,
    "",
    list([...branch.uncertainties]),
    "",
    `${sub} ${labels.alignment}`,
    "",
    `${branch.intentAlignment.score}/100 — ${branch.intentAlignment.rationale}`,
  ].join("\n");
}

function joinOrNone(items: ReadonlyArray<string>, none: string): string {
  return items.length > 0 ? items.join("; ") : none;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
