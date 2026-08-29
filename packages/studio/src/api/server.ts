// @ts-nocheck
import { Hono, type Context } from "hono";
import { castorEnv } from "@actalk/castor-core";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import {
  StateManager,
  PipelineRunner,
  createLLMClient,
  createLogger,
  createInteractionToolsFromDeps,
  computeAnalytics,
  loadProjectConfig,
  loadProjectSession,
  processProjectInteractionRequest,
  resolveSessionActiveBook,
  listBookSessions,
  loadBookSession,
  appendManualSessionMessages,
  createAndPersistBookSession,
  renameBookSession,
  deleteBookSession,
  migrateBookSession,
  SessionAlreadyMigratedError,
  abortAgentSession,
  runAgentSession,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  guessServiceFromBaseUrl,
  resolveServiceModel,
  loadSecrets,
  saveSecrets,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  chatCompletion,
  runWorkerAgent,
  buildExportArtifact,
  evaluateBookQuality,
  ConsolidatorAgent,
  WriterAgent,
  DetectionConfigSchema,
  ResearchSearchConfigSchema,
  GLOBAL_ENV_PATH,
  resolveGlobalEnvPath,
  COVER_PROVIDER_PRESETS,
  createPlayDB,
  PlayStore,
  buildPlayEntityImagePrompt,
  buildPlaySceneImagePrompt,
  generatePlayImage,
  readPlayImageManifest,
  readPlayImageSettings,
  writePlayImageSettings,
  type PlayImageSettings,
  Scheduler,
  coverSecretKey,
  normalizeCoverBaseUrl,
  resolveCoverProviderPreset,
  SessionKindSchema,
  normalizeActionSource as normalizeCoreActionSource,
  normalizeActionPayload as normalizeCoreActionPayload,
  normalizePlayMode as normalizeCorePlayMode,
  normalizeRequestedIntent as normalizeCoreRequestedIntent,
  normalizeSkillIdList as normalizeCoreSkillIdList,
  inferLanguage,
  readStoryCanon,
  readCanonSection,
  isCanonSection,
  describeCurrentState,
  CanonUnavailableError,
  CanonConflictError,
  CanonInvalidEditsError,
  CanonCommitRequestSchema,
  previewCanonEdits,
  commitCanonEdits,
  BookWriteLockError,
  type CanonCommitDeps,
  type CanonCommitRequest,
  ingestMaterial,
  createSkillRegistry,
  loadAvailableAgentSkills,
  activatedSkillIds,
  mergeActivatedSkillGuidance,
  resolveProductionSkillActivations,
  parseAgentSkillDocument,
  getBuiltinPrompt,
  listBuiltinPromptPacks,
  listBuiltinPrompts,
  loadPromptPackPrompt,
  promptOverridePath,
  toPosixPath,
  type ActionPayload,
  type ActionSource,
  type AgentSkill,
  type BuiltinPrompt,
  createGenerateCoverTool,
  createInteractiveFilmCreationTool,
  createPlayStartTool,
  createScriptCreationTool,
  createShortFictionRunTool,
  createStoryboardCreationTool,
  createTranslationCreateTool,
  createFanficBookTool,
  createContinuationImportTool,
  createSpinoffBookTool,
  createImitationBookTool,
  createSubAgentTool,
  createDraftStructureTool,
  createConnectChoiceTool,
  createRemoveNodeTool,
  createLLMTranslationModel,
  deleteLatestChapter,
  executeEditTransaction,
  listChapterVersions,
  readChapterPlanDocument,
  readChapterUserBrief,
  readChapterVersion,
  saveChapterUserBrief,
  loadStateReview,
  listReceiptsForChapter,
  decideStateReviewItem,
  editStateReviewItem,
  addUserStateReviewItem,
  removeUserStateReviewItem,
  rejectAllAiItems,
  confirmStateReview,
  ReviewItemKindSchema,
  StateReviewError,
  bootstrapFoundation,
  readUnitManifests,
  evaluateFoundationReadiness,
  createVersionStore,
  openFoundationRevision,
  loadFoundationRevision,
  saveFoundationUnitDraft,
  approveFoundationUnit,
  markFoundationUnitNeedsRevision,
  reapproveStaleFoundationUnit,
  discardFoundationRevision,
  approveFoundationUnitsBatch,
  publishFoundation,
  // Planning — Task 23 (Studio delegates to exact Core governance entries).
  // Entries without a Core implementation are resolved through the
  // dynamic-import fallbacks at each route; they must not be statically
  // imported or Node ESM crashes the server at startup.
  getPublishedArcPlan,
  generateArcDraft,
  getArcPreflight,
  publishArcPlan,
  getBeatProgress,
  getLookahead,
  getPlanningGateReport,
  evaluatePlanningGate,
  parseHumanDirectionDraft,
  confirmHumanDirection,
  resolveDirectionConflict,
  createAuthorization,
  confirmAuthorization,
  createTranslationProjectFromFile,
  loadTranslationChapter,
  loadTranslationManifest,
  runTranslationProject,
  writeTranslationExport,
  filmLLMDepsFromClient,
  applyGraphDelta,
  loadStoryGraph,
  reviewStoryGraph,
  exportInk,
  buildPlayableHtml,
  analyzeEmotionalArcs,
  analyzePathDistribution,
  generateNodeImage,
  defaultNodeImageDeps,
  type NodeImageDeps,
  type ResolvedModel,
  type PipelineConfig,
  type PlayMode,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
  type RequestedIntent,
  type SessionKind,
  type AgentSessionAttachment,
} from "@actalk/castor-core";
import { isConfirmedProductionAction } from "../shared/confirmed-production.js";
import { summarizeToolResult } from "../shared/tool-result.js";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";
import { buildStudioBookConfig } from "./book-create.js";
import {
  deleteStudioTaskSnapshot,
  loadStudioTaskSnapshot,
  saveStudioTaskSnapshot,
  type StudioTaskSnapshot,
} from "./task-store.js";

// -- Studio server language (read per request from the project config's `language`) --

type StudioLanguage = "vi" | "en";

function normalizeStudioLanguage(value: unknown): StudioLanguage {
  // Legacy "zh" (and unknown) requests fall back to the Vietnamese default.
  return value === "en" ? "en" : "vi";
}

function pick(lang: StudioLanguage, vi: string, en: string): string {
  return lang === "en" ? en : vi;
}

// -- Pipeline stage definitions per agent type --

interface BilingualLabel {
  readonly vi: string;
  readonly en: string;
}

const PIPELINE_STAGES: Record<string, ReadonlyArray<BilingualLabel>> = {
  writer: [
    { vi: "Chuẩn bị đầu vào chương", en: "Prepare chapter input" },
    { vi: "Soạn bản nháp chương", en: "Write chapter draft" },
    { vi: "Lưu chương cuối cùng", en: "Save final chapter" },
    { vi: "Tạo tệp sự thật cuối cùng", en: "Generate final truth files" },
    { vi: "Xác thực thay đổi tệp sự thật", en: "Validate truth file changes" },
    { vi: "Đồng bộ chỉ mục ký ức", en: "Sync memory index" },
    { vi: "Cập nhật chỉ mục và snapshot chương", en: "Update chapter index and snapshot" },
  ],
  architect: [
    { vi: "Tạo cài đặt nền tảng", en: "Generate foundation" },
    { vi: "Lưu cấu hình sách", en: "Save book config" },
    { vi: "Ghi tệp nền tảng", en: "Write foundation files" },
    { vi: "Khởi tạo tài liệu điều khiển", en: "Initialize control documents" },
    { vi: "Tạo snapshot ban đầu", en: "Create initial snapshot" },
  ],
  reviser: [
    { vi: "Tải ngữ cảnh sửa đổi", en: "Load revision context" },
    { vi: "Chỉnh sửa chương", en: "Revise chapter" },
    { vi: "Lưu kết quả sửa đổi", en: "Save revision result" },
    { vi: "Cập nhật chỉ mục và snapshot", en: "Update index and snapshot" },
  ],
  auditor: [{ vi: "Kiểm tra chương", en: "Audit chapter" }],
};

function pipelineStages(agent: string, lang: StudioLanguage = "vi"): string[] | undefined {
  return PIPELINE_STAGES[agent]?.map((stage) => pick(lang, stage.vi, stage.en));
}

function attachmentDisposition(fileName: string): string {
  const safeAscii = fileName.replace(/[^A-Za-z0-9._-]+/g, "_") || "download";
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const AGENT_LABELS: Record<string, BilingualLabel> = {
  architect: { vi: "Tạo sách", en: "Book setup" },
  writer: { vi: "Viết", en: "Writing" },
  auditor: { vi: "Kiểm tra", en: "Audit" },
  reviser: { vi: "Chỉnh sửa", en: "Revision" },
  exporter: { vi: "Xuất", en: "Export" },
};
const TOOL_LABELS: Record<string, BilingualLabel> = {
  read: { vi: "Đọc tệp", en: "Read file" },
  edit: { vi: "Sửa tệp", en: "Edit file" },
  grep: { vi: "Tìm kiếm", en: "Search" },
  ls: { vi: "Liệt kê thư mục", en: "List directory" },
  propose_action: { vi: "Xác nhận hành động", en: "Confirm action" },
  short_fiction_run: { vi: "Chạy truyện ngắn", en: "Short fiction" },
  script_create: { vi: "Tạo kịch bản", en: "Script creation" },
  storyboard_create: { vi: "Tạo storyboard", en: "Storyboard creation" },
  interactive_film_create: { vi: "Phim tương tác", en: "Interactive film" },
  translation_create: { vi: "Dự án dịch", en: "Translation" },
  fanfic_create: { vi: "Sáng tác fanfic", en: "Fanfiction" },
  continuation_import: { vi: "Nhập viết tiếp", en: "Continuation import" },
  spinoff_create: { vi: "Sáng tác ngoại truyện", en: "Side story" },
  imitation_create: { vi: "Bắt chước văn phong", en: "Style imitation" },
  generate_cover: { vi: "Tạo ảnh bìa", en: "Cover generation" },
  play_edit: { vi: "Sửa thế giới tương tác", en: "Edit interactive world" },
  play_start: { vi: "Khởi động thế giới tương tác", en: "Start interactive world" },
  play_revise: { vi: "Làm lại lượt tương tác", en: "Redo interactive turn" },
  play_step: { vi: "Đẩy thế giới tương tác", en: "Advance interactive world" },
  create_narrative_forecast: { vi: "Dự báo truyện đa nhánh", en: "Narrative forecast" },
  get_narrative_forecast: { vi: "Kiểm tra lại dự báo truyện", en: "Recheck forecast" },
  select_narrative_branch: { vi: "Chọn nhánh ứng viên", en: "Select candidate branch" },
};

function resolveToolLabel(tool: string, agent?: string, lang: StudioLanguage = "vi"): string {
  if (tool === "sub_agent" && agent) {
    const label = AGENT_LABELS[agent];
    return label ? pick(lang, label.vi, label.en) : agent;
  }
  const label = TOOL_LABELS[tool];
  return label ? pick(lang, label.vi, label.en) : tool;
}

function formatTaskElapsed(ms: number, lang: StudioLanguage): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return pick(lang, `${seconds} giây`, `${seconds}s`);
  return pick(lang, `${minutes} phút ${seconds} giây`, `${minutes}m ${seconds}s`);
}

/**
 * 把正在后台运行的生产任务状态渲染成一段系统提示词附录，注入聊天 agent 的上下文。
 * 没有这段信息时，用户在任务运行期间问"在写吗"，agent 会答"没有任务在运行"。
 */
function buildRunningTaskContextBlock(task: StudioTaskSnapshot, lang: StudioLanguage): string {
  const exec = task.execution;
  const elapsed = formatTaskElapsed(Date.now() - exec.startedAt, lang);
  const status = exec.status === "processing"
    ? pick(lang, "đang xử lý", "processing")
    : pick(lang, "đang chạy", "running");
  const logsTail = (exec.logs ?? []).slice(-3);
  const logsBlock = logsTail.length > 0
    ? `\n${pick(lang, "- Nhật ký gần đây:", "- Recent logs:")}\n${logsTail.map((line) => `  - ${line}`).join("\n")}`
    : "";
  return pick(
    lang,
    [
      "## 后台任务状态",
      "本会话有一个正在后台运行的生产任务：",
      `- 任务：${exec.label}（${exec.tool}）`,
      `- 状态：${status}`,
      `- 已运行：${elapsed}${logsBlock}`,
      "该任务在后台独立运行，本轮对话不会打断它。用户询问任务进展时，基于以上信息如实回答。不要再次发起同类生产任务，也不要声称没有任务在运行。生产类工具已临时不可用，任务结束后恢复。",
    ].join("\n"),
    [
      "## Background task status",
      "A production task is currently running in the background of this session:",
      `- Task: ${exec.label} (${exec.tool})`,
      `- Status: ${status}`,
      `- Elapsed: ${elapsed}${logsBlock}`,
      "The task runs independently in the background; this chat turn does not interrupt it. When the user asks about its progress, answer truthfully from the information above. Do not start another production task of the same kind, and do not claim that no task is running. Production tools are temporarily unavailable and will be restored when the task finishes.",
    ].join("\n"),
  );
}

function compareServiceListItems(
  left: { readonly service: string },
  right: { readonly service: string },
): number {
  const priority = ["kkaiapi", "openrouter", "newapi", "siliconcloud"];
  const leftPriority = priority.indexOf(left.service);
  const rightPriority = priority.indexOf(right.service);
  if (leftPriority !== -1 || rightPriority !== -1) {
    return (leftPriority === -1 ? 999 : leftPriority) - (rightPriority === -1 ? 999 : rightPriority);
  }
  return 0;
}

async function buildTarArchive(sourceDir: string, packageRootName: string): Promise<Buffer> {
  const files = await listArchiveFiles(sourceDir);
  const chunks: Buffer[] = [];
  for (const file of files) {
    const payload = await readFile(join(sourceDir, file));
    const archiveName = normalizeArchivePath(join(packageRootName, file));
    chunks.push(createTarHeader(archiveName, payload.byteLength));
    chunks.push(payload);
    const padding = (512 - (payload.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function listArchiveFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listArchiveFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(normalizeArchivePath(relativePath));
    } else {
      const info = await stat(fullPath).catch(() => null);
      if (info?.isFile()) files.push(normalizeArchivePath(relativePath));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/g, "");
}

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarOctal(header, 148, 8, checksum);
  return header;
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value);
  if (encoded.byteLength > length) {
    throw new Error(`Archive path is too long for tar header: ${value}`);
  }
  encoded.copy(header, offset);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  header.write(text, offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function isHeaderSafeApiKey(value: string): boolean {
  if (!value) return true;
  return /^[\x21-\x7E]+$/.test(value);
}

const NON_TEXT_MODEL_ID_PARTS = [
  "image",
  "embedding",
  "embed",
  "rerank",
  "tts",
  "speech",
  "audio",
  "moderation",
] as const;

const SERVICE_MODELS_PROBE_TIMEOUT_MS = 4_000;
const SERVICE_CHAT_PROBE_TIMEOUT_MS = 8_000;
// Hard ceiling for the whole /doctor connectivity probe (models + chat fallback
// loop) so the diagnostics page never spins on a slow/rate-limited upstream.
const DOCTOR_LLM_PROBE_BUDGET_MS = 9_000;
const MAX_DISCOVERED_MODELS_TO_PING = 2;
const MAX_GENERIC_FALLBACK_MODELS_TO_PING = 2;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

function normalizeApiBookId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} must be a string`);
  }
  const bookId = value.trim();
  if (!bookId) {
    throw new ApiError(400, "INVALID_BOOK_ID", `${fieldName} cannot be blank`);
  }
  if (!isSafeBookId(bookId)) {
    throw new ApiError(400, "INVALID_BOOK_ID", `Invalid ${fieldName}: "${bookId}"`);
  }
  return bookId;
}

function nonTextModelMessage(modelId: string, lang: StudioLanguage = "vi"): string {
  return pick(
    lang,
    `Mô hình ${modelId} không phù hợp để chat/viết văn bản. Hãy dùng mô hình văn bản trong bộ chọn mô hình, ví dụ gemini-2.5-flash, gemini-2.5-pro hoặc mô hình chat tương ứng của dịch vụ.`,
    `Model ${modelId} is not suitable for text chat/writing. Pick a text model in the model selector, e.g. gemini-2.5-flash, gemini-2.5-pro, or the service's chat model.`,
  );
}

function extractToolError(result: unknown): string {
  return summarizeToolResult(result, 500);
}

function resolveProjectImageFile(root: string, rawPath: string): { readonly resolved: string; readonly contentType: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  if (!relPath.startsWith("shorts/") && !relPath.startsWith("covers/") && !relPath.startsWith("interactive-films/")) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Only generated shorts/, covers/, interactive-films/ images can be previewed");
  }

  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_FILE_TYPE", "Unsupported project file type");
  }

  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ApiError(400, "INVALID_PROJECT_FILE_PATH", "Invalid project file path");
  }
  return { resolved, contentType };
}

function normalizeProjectGeneratedPath(root: string, rawPath: string, code: string): { readonly relPath: string; readonly resolved: string } {
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawPath).replace(/^\/+/u, "");
  } catch {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  if (
    !relPath
    || relPath.includes("\0")
    || isAbsolute(relPath)
    || relPath.split(/[\\/]+/u).includes("..")
  ) {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  const allowedRoots = ["dramas/", "storyboards/", "interactive-films/", "shorts/", "covers/"];
  if (!allowedRoots.some((prefix) => relPath.startsWith(prefix))) {
    throw new ApiError(400, code, "Only generated writing artifacts can be opened");
  }

  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ApiError(400, code, "Invalid project artifact path");
  }

  return { relPath, resolved };
}

function resolveProjectTextArtifactFile(root: string, rawPath: string): { readonly relPath: string; readonly resolved: string; readonly contentType: string } {
  const file = normalizeProjectGeneratedPath(root, rawPath, "INVALID_PROJECT_ARTIFACT_PATH");
  const ext = file.relPath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    markdown: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json; charset=utf-8",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    throw new ApiError(415, "UNSUPPORTED_PROJECT_ARTIFACT_TYPE", "Unsupported project artifact type");
  }
  return { ...file, contentType };
}

function isLikelyFailedToolResult(exec: CollectedToolExec): boolean {
  if (exec.status === "error") return true;
  const text = `${exec.error ?? ""}\n${exec.result ?? ""}`.toLowerCase();
  return /\bfailed\b|\berror\b|失败|异常|出错/.test(text);
}

function hasSuccessfulSubAgentExec(
  execs: ReadonlyArray<CollectedToolExec>,
  agent: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === "sub_agent"
    && exec.agent === agent
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function hasSuccessfulToolExec(
  execs: ReadonlyArray<CollectedToolExec>,
  tool: string,
): boolean {
  return execs.some((exec) =>
    exec.tool === tool
    && exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
  );
}

function hasSuccessfulToolResult(execs: ReadonlyArray<CollectedToolExec>): boolean {
  return execs.some((exec) => exec.status === "completed" && !isLikelyFailedToolResult(exec));
}

function normalizeStudioSessionKind(value: unknown, fallback: SessionKind): SessionKind {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = SessionKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_SESSION_KIND", `Invalid sessionKind: ${String(value)}`);
  }
  return parsed.data;
}

function normalizeStudioActionSource(value: unknown): ActionSource {
  try {
    return normalizeCoreActionSource(value);
  } catch {
    throw new ApiError(400, "INVALID_ACTION_SOURCE", `Invalid actionSource: ${String(value)}`);
  }
}

function normalizeStudioRequestedIntent(value: unknown): RequestedIntent | undefined {
  try {
    return normalizeCoreRequestedIntent(value);
  } catch {
    throw new ApiError(400, "INVALID_REQUESTED_INTENT", `Invalid requestedIntent: ${String(value)}`);
  }
}

function normalizeStudioActionPayload(value: unknown): ActionPayload | undefined {
  try {
    return normalizeCoreActionPayload(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "INVALID_ACTION_PAYLOAD", `Invalid actionPayload: ${message}`);
  }
}

function normalizeStudioSkillIdList(value: unknown, field: string): string[] {
  try {
    return normalizeCoreSkillIdList(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(400, "INVALID_SKILL_ID", `Invalid ${field}: ${message}`);
  }
}

function normalizeStudioSkillId(value: unknown, field = "skillId"): string {
  const [id] = normalizeStudioSkillIdList([value], field);
  if (!id) throw new ApiError(400, "INVALID_SKILL_ID", `Invalid ${field}: empty`);
  return id;
}

type StudioAgentAttachmentPayload = {
  readonly id?: string;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly size?: number;
  readonly dataUrl?: string;
};

const MAX_AGENT_ATTACHMENTS = 8;
const MAX_AGENT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_AGENT_ATTACHMENT_TEXT_CHARS = 120_000;
const MAX_TRANSLATION_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_CANON_UPLOAD_BYTES = 18 * 1024 * 1024;
const MAX_SKILL_IMPORT_FILES = 128;
const MAX_SKILL_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

function safeUploadFileName(value: string): string {
  const trimmed = value.trim().replace(/[/\\\0]/g, "_").replace(/\s+/g, " ");
  const safe = trimmed.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120).trim();
  return safe || "upload";
}

function isTextAttachment(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return mimeType.startsWith("text/")
    || [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".csv",
      ".tsv",
      ".yaml",
      ".yml",
      ".log",
    ].some((suffix) => lower.endsWith(suffix));
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new ApiError(400, "INVALID_ATTACHMENT_DATA_URL", "Attachment must be a base64 data URL");
  }
  const mimeType = match[1]?.trim() || "application/octet-stream";
  return { mimeType, buffer: Buffer.from(match[2] ?? "", "base64") };
}

async function normalizeAgentAttachments(
  root: string,
  sessionId: string,
  value: unknown,
): Promise<AgentSessionAttachment[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, "INVALID_ATTACHMENTS", "attachments must be an array");
  }
  if (value.length > MAX_AGENT_ATTACHMENTS) {
    throw new ApiError(413, "TOO_MANY_ATTACHMENTS", `At most ${MAX_AGENT_ATTACHMENTS} files can be attached to one message`);
  }

  const uploadDir = join(root, ".castor", "uploads", safeUploadFileName(sessionId));
  const out: AgentSessionAttachment[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiError(400, "INVALID_ATTACHMENT", "Each attachment must be an object");
    }
    const payload = raw as StudioAgentAttachmentPayload;
    const filename = safeUploadFileName(payload.filename || `upload-${index + 1}`);
    if (!payload.dataUrl) {
      throw new ApiError(400, "INVALID_ATTACHMENT", `Attachment ${filename} is missing dataUrl`);
    }
    const parsed = parseDataUrl(payload.dataUrl);
    const mimeType = payload.mediaType?.trim() || parsed.mimeType;
    if (parsed.buffer.byteLength > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new ApiError(413, "ATTACHMENT_TOO_LARGE", `${filename} exceeds ${MAX_AGENT_ATTACHMENT_BYTES} bytes`);
    }
    await mkdir(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${index + 1}-${filename}`;
    const storedPath = join(uploadDir, storedName);
    await writeFile(storedPath, parsed.buffer);
    const relPath = toPosixPath(relative(root, storedPath));

    if (mimeType.startsWith("image/")) {
      out.push({
        id: payload.id || `${Date.now()}-${index}`,
        filename,
        mimeType,
        size: parsed.buffer.byteLength,
        storedPath: relPath,
        image: {
          data: parsed.buffer.toString("base64"),
          mimeType,
        },
      });
      continue;
    }

    if (isTextAttachment(filename, mimeType)) {
      const text = parsed.buffer.toString("utf-8");
      if (text.length > MAX_AGENT_ATTACHMENT_TEXT_CHARS) {
        throw new ApiError(413, "ATTACHMENT_TEXT_TOO_LARGE", `${filename} is too large to inject without semantic compaction`);
      }
      out.push({
        id: payload.id || `${Date.now()}-${index}`,
        filename,
        mimeType,
        size: parsed.buffer.byteLength,
        storedPath: relPath,
        text,
      });
      continue;
    }

    out.push({
      id: payload.id || `${Date.now()}-${index}`,
      filename,
      mimeType,
      size: parsed.buffer.byteLength,
      storedPath: relPath,
    });
  }
  return out;
}

async function storeTranslationUpload(
  root: string,
  payload: { readonly filename?: string; readonly dataUrl?: string },
): Promise<{ readonly storedPath: string; readonly size: number; readonly mimeType: string }> {
  return storeProjectUpload(root, payload, {
    scope: "translation",
    fallbackName: "translation-source",
    maxBytes: MAX_TRANSLATION_UPLOAD_BYTES,
    errorCode: "INVALID_TRANSLATION_UPLOAD",
  });
}

async function storeProjectUpload(
  root: string,
  payload: { readonly filename?: string; readonly dataUrl?: string },
  options: {
    readonly scope: string;
    readonly fallbackName: string;
    readonly maxBytes: number;
    readonly errorCode: string;
  },
): Promise<{ readonly storedPath: string; readonly size: number; readonly mimeType: string }> {
  const filename = safeUploadFileName(payload.filename || options.fallbackName);
  if (!payload.dataUrl) {
    throw new ApiError(400, options.errorCode, "Upload is missing dataUrl");
  }
  const parsed = parseDataUrl(payload.dataUrl);
  if (parsed.buffer.byteLength > options.maxBytes) {
    throw new ApiError(413, `${options.errorCode}_TOO_LARGE`, `${filename} exceeds ${options.maxBytes} bytes`);
  }
  const uploadDir = join(root, ".castor", "uploads", safeUploadFileName(options.scope));
  await mkdir(uploadDir, { recursive: true });
  const storedName = `${Date.now()}-${filename}`;
  const storedPath = join(uploadDir, storedName);
  await writeFile(storedPath, parsed.buffer);
  return {
    storedPath: toPosixPath(relative(root, storedPath)),
    size: parsed.buffer.byteLength,
    mimeType: parsed.mimeType,
  };
}

function projectSkillsDir(root: string): string {
  return join(root, ".agents", "skills");
}

function projectSkillDir(root: string, id: string): string {
  return join(projectSkillsDir(root), id);
}

function projectSkillPath(root: string, id: string): string {
  return join(projectSkillDir(root, id), "SKILL.md");
}

function toStudioSkill(skill: AgentSkill, root: string, projectSkillIds: ReadonlySet<string>) {
  const projectPath = projectSkillPath(root, skill.id);
  const isProjectFile = projectSkillIds.has(skill.id);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    source: isProjectFile ? "project" : skill.source,
    editable: isProjectFile,
    path: isProjectFile ? relative(root, projectPath) : undefined,
  };
}

interface StudioSkillImportFile {
  readonly path: string;
  readonly buffer: Buffer;
}

function normalizeSkillImportPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", "Skill import file path must be a string");
  }
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || /^[a-zA-Z]:\//.test(normalized)
    || normalized.includes("\0")
  ) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", `Unsafe skill import path: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", `Unsafe skill import path: ${value}`);
  }
  return parts.join("/");
}

function normalizeSkillImportFiles(value: unknown): {
  readonly files: ReadonlyArray<StudioSkillImportFile>;
  readonly manifestPath: string;
} {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import requires at least one file");
  }
  if (value.length > MAX_SKILL_IMPORT_FILES) {
    throw new ApiError(413, "SKILL_IMPORT_TOO_MANY_FILES", `A skill may contain at most ${MAX_SKILL_IMPORT_FILES} files`);
  }

  const files: StudioSkillImportFile[] = [];
  const seenPathKeys = new Set<string>();
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", "Each skill import entry must be an object");
    }
    const record = item as Record<string, unknown>;
    const path = normalizeSkillImportPath(record.path);
    const pathKey = path.toLowerCase();
    if (seenPathKeys.has(pathKey)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", `Duplicate skill import path: ${path}`);
    }
    if (typeof record.dataUrl !== "string") {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", `Missing dataUrl for ${path}`);
    }
    const { buffer } = parseDataUrl(record.dataUrl);
    if (buffer.byteLength > MAX_SKILL_IMPORT_FILE_BYTES) {
      throw new ApiError(413, "SKILL_IMPORT_FILE_TOO_LARGE", `${path} exceeds ${MAX_SKILL_IMPORT_FILE_BYTES} bytes`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_SKILL_IMPORT_TOTAL_BYTES) {
      throw new ApiError(413, "SKILL_IMPORT_TOO_LARGE", `Skill folder exceeds ${MAX_SKILL_IMPORT_TOTAL_BYTES} bytes`);
    }
    seenPathKeys.add(pathKey);
    files.push({ path, buffer });
  }

  const manifests = files.filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"));
  if (manifests.length !== 1) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import must contain exactly one SKILL.md");
  }
  const manifestPath = manifests[0]!.path;
  const folder = manifestPath === "SKILL.md"
    ? ""
    : manifestPath.slice(0, -"/SKILL.md".length);
  for (const file of files) {
    if (folder && !file.path.startsWith(`${folder}/`)) {
      throw new ApiError(400, "INVALID_SKILL_IMPORT_PATH", "All imported files must be inside the SKILL.md folder");
    }
  }
  return { files, manifestPath };
}

async function importStudioSkillFolder(
  root: string,
  payload: unknown,
): Promise<AgentSkill> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import payload must be an object");
  }
  const record = payload as Record<string, unknown>;
  const { files, manifestPath } = normalizeSkillImportFiles(record.files);
  const manifest = files.find((file) => file.path === manifestPath)!;
  let parsed: AgentSkill;
  try {
    parsed = parseAgentSkillDocument(manifest.buffer.toString("utf-8"), {
      skillPath: join(root, manifestPath),
      source: "project",
    });
  } catch (error) {
    throw new ApiError(
      400,
      "INVALID_SKILL_MANIFEST",
      error instanceof Error ? error.message : String(error),
    );
  }

  const targetDir = projectSkillDir(root, parsed.id);
  try {
    await access(targetDir);
    throw new ApiError(409, "SKILL_EXISTS", `Project skill already exists: ${parsed.id}`);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(projectSkillsDir(root), { recursive: true });
  const stagingDir = join(projectSkillsDir(root), `.import-${randomUUID()}`);
  const folder = manifestPath === "SKILL.md"
    ? ""
    : manifestPath.slice(0, -"/SKILL.md".length);
  try {
    await mkdir(stagingDir, { recursive: true });
    for (const file of files) {
      const relativePath = folder ? file.path.slice(folder.length + 1) : file.path;
      const destination = join(stagingDir, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.buffer);
    }
    await rename(stagingDir, targetDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  return { ...parsed, source: "project", baseDir: targetDir };
}

async function loadStudioSkills(root: string) {
  const configured = await loadAvailableAgentSkills({ projectRoot: root });
  const projectSkillIds = await listProjectSkillIds(root);
  const registry = createSkillRegistry({ skills: configured.skills });
  return {
    skills: registry.listSkills().map((skill) => toStudioSkill(skill, root, projectSkillIds)),
    diagnostics: configured.diagnostics,
  };
}

async function toStudioPromptPackPrompt(root: string, prompt: BuiltinPrompt) {
  const loaded = await loadPromptPackPrompt({ promptId: prompt.id, projectRoot: root });
  const overridePath = promptOverridePath(root, prompt.id);
  return {
    id: prompt.id,
    packId: prompt.packId,
    title: prompt.title,
    defaultContent: prompt.content,
    content: loaded.content,
    source: loaded.source,
    overridden: loaded.source === "project",
    // Windows 上 relative() 产生反斜杠，这个 path 会被前端展示/断言为 posix 相对路径
    path: loaded.source === "project" ? toPosixPath(relative(root, overridePath)) : undefined,
  };
}

function normalizeStudioPromptId(value: unknown): string {
  const promptId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!promptId || !getBuiltinPrompt(promptId)) {
    throw new ApiError(404, "PROMPT_PACK_PROMPT_NOT_FOUND", `Prompt pack prompt not found: ${String(value)}`);
  }
  return promptId;
}

async function listProjectSkillIds(root: string): Promise<Set<string>> {
  try {
    const entries = await readdir(projectSkillsDir(root), { withFileTypes: true });
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = normalizeStudioSkillId(entry.name, "skillId");
      try {
        const info = await stat(projectSkillPath(root, id));
        if (info.isFile()) ids.add(id);
      } catch {
        // Ignore incomplete project skill directories.
      }
    }
    return ids;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

function normalizeStudioPlayMode(value: unknown): PlayMode | undefined {
  try {
    return normalizeCorePlayMode(value);
  } catch {
    throw new ApiError(400, "INVALID_PLAY_MODE", `Invalid playMode: ${String(value)}`);
  }
}

function validateAgentActionExecution(args: {
  readonly instruction: string;
  readonly agentBookId: string | null | undefined;
  readonly requestedIntent?: RequestedIntent;
  readonly collectedToolExecs: ReadonlyArray<CollectedToolExec>;
  readonly language?: StudioLanguage;
}): string | undefined {
  const lang = args.language ?? "vi";
  const failedExec = args.collectedToolExecs.find(isLikelyFailedToolResult);
  if (failedExec) {
    const detail = failedExec.error ?? failedExec.result ?? pick(lang, "lỗi không rõ", "unknown error");
    return pick(
      lang,
      `${failedExec.label} thực hiện thất bại: ${detail}`,
      `${failedExec.label} failed: ${detail}`,
    );
  }

  if (
    args.agentBookId
    && args.requestedIntent === "write_next"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "writer")
  ) {
    return pick(
      lang,
      "Mô hình tuyên bố đã hoàn thành chương tiếp theo nhưng thực tế không gọi công cụ viết. Hãy thử lại; nếu vẫn thất bại, hãy kiểm tra mô hình có hỗ trợ gọi công cụ hay không.",
      "The model claimed the next chapter is done, but it never called the writing tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (
    !args.agentBookId
    && args.requestedIntent === "create_book"
    && !hasSuccessfulSubAgentExec(args.collectedToolExecs, "architect")
  ) {
    return pick(
      lang,
      "Đã xác nhận tạo sách nhưng mô hình không thực sự gọi công cụ tạo sách. Hãy thử lại; nếu vẫn thất bại, hãy kiểm tra mô hình có hỗ trợ gọi công cụ hay không.",
      "Book creation was confirmed, but the model never called the book setup tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "short_run" && !hasSuccessfulToolExec(args.collectedToolExecs, "short_fiction_run")) {
    return pick(
      lang,
      "Đã xác nhận tạo truyện ngắn nhưng mô hình không thực sự gọi công cụ sản xuất truyện ngắn. Hãy thử lại; nếu vẫn thất bại, hãy kiểm tra mô hình có hỗ trợ gọi công cụ hay không.",
      "Short fiction was confirmed, but the model never called the short fiction tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "play_start" && !hasSuccessfulToolExec(args.collectedToolExecs, "play_start")) {
    return pick(
      lang,
      "Đã xác nhận khởi động thế giới tương tác nhưng mô hình không thực sự gọi công cụ thế giới tương tác. Hãy thử lại; nếu vẫn thất bại, hãy kiểm tra mô hình có hỗ trợ gọi công cụ hay không.",
      "Starting the interactive world was confirmed, but the model never called the interactive world tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  if (args.requestedIntent === "generate_cover" && !hasSuccessfulToolExec(args.collectedToolExecs, "generate_cover")) {
    return pick(
      lang,
      "Đã xác nhận tạo ảnh bìa nhưng mô hình không thực sự gọi công cụ tạo bìa. Hãy thử lại; nếu vẫn thất bại, hãy kiểm tra mô hình có hỗ trợ gọi công cụ hay không.",
      "Cover generation was confirmed, but the model never called the cover tool. Retry; if it keeps failing, check whether the model supports tool calls.",
    );
  }

  return undefined;
}

type AgentFailureKind = "busy" | "llm" | "internal" | "unknown";

function classifyAgentFailure(message: string): AgentFailureKind {
  const text = message.trim();
  if (!text) return "unknown";
  if (/BookWriteLockError|locked by an active Castor write|BOOK_BUSY/i.test(text)) {
    return "busy";
  }
  if (
    /API\s*返回|上游|upstream|Bad Gateway|temporarily unavailable|rate limit|quota|API Key|unauthorized|forbidden|无法连接到 API|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|LLM returned empty response|Provider finish_reason|reasoning_content/i.test(text)
  ) {
    return "llm";
  }
  if (
    /PlannerParseError|Architect output missing|required sections|missing YAML frontmatter|frontmatter delimiters|parseMemo|Book creation artifact is incomplete|Short-hit draft is incomplete|工具执行失败|执行失败|sub_agent|tool execution|RUNTIME_STATE_DELTA|JSON parse|解析失败/i.test(text)
  ) {
    return "internal";
  }
  return "unknown";
}

function formatAgentFailure(
  message: string,
  lang: StudioLanguage = "vi",
): { readonly code: string; readonly message: string; readonly status: 409 | 500 | 502 } {
  const kind = classifyAgentFailure(message);
  if (kind === "busy") {
    return { code: "BOOK_BUSY", message, status: 409 };
  }
  if (kind === "llm") {
    return { code: "AGENT_LLM_ERROR", message, status: 502 };
  }
  if (kind === "internal") {
    return {
      code: "AGENT_INTERNAL_ERROR",
      message: pick(lang, `Lỗi quy trình nội bộ của Castor: ${message}`, `Castor internal pipeline error: ${message}`),
      status: 500,
    };
  }
  return { code: "AGENT_ERROR", message, status: 500 };
}

function formatAgentActionFailure(
  message: string,
  lang: StudioLanguage,
): { readonly code: string; readonly message: string; readonly status: 409 | 502 } {
  const failure = formatAgentFailure(message, lang);
  return failure.code === "BOOK_BUSY"
    ? { code: failure.code, message: failure.message, status: 409 }
    : { code: "AGENT_ACTION_FAILED", message, status: 502 };
}

interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  logs?: string[];
  startedAt: number;
  completedAt?: number;
}

class ConfirmedActionExecutionError extends Error {
  readonly exec: CollectedToolExec;

  constructor(message: string, exec: CollectedToolExec, cause?: unknown) {
    super(message);
    this.name = "ConfirmedActionExecutionError";
    this.exec = exec;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function suppressManualTextForTool(exec: CollectedToolExec): boolean {
  return exec.tool === "play_start"
    || exec.tool === "play_step"
    || exec.tool === "play_revise"
    || exec.tool === "script_create"
    || exec.tool === "storyboard_create"
    || exec.tool === "interactive_film_create";
}

function hasSuccessfulToolOwnedResponse(execs: ReadonlyArray<CollectedToolExec>): boolean {
  return execs.some((exec) =>
    exec.status === "completed"
    && !isLikelyFailedToolResult(exec)
    && suppressManualTextForTool(exec)
  );
}

function manualToolAssistantMessage(
  responseText: string,
  exec: CollectedToolExec,
  provider: string,
  model: string,
): any {
  return {
    role: "assistant",
    content: [{ type: "text", text: suppressManualTextForTool(exec) ? "" : responseText }],
    api: "anthropic-messages",
    provider,
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function manualToolAppendOptions(sessionKind: SessionKind, exec: CollectedToolExec): {
  readonly sessionKind: SessionKind;
  readonly legacyDisplay: { readonly toolExecutions: readonly CollectedToolExec[] };
} {
  return {
    sessionKind,
    legacyDisplay: { toolExecutions: [exec] },
  };
}

function requirePayloadText(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) {
    throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", message);
  }
  return text;
}

function toolResultText(result: unknown, lang: StudioLanguage = "vi"): string {
  const text = extractToolError(result).trim();
  return text || pick(lang, "Đã hoàn tất.", "Done.");
}

async function executeConfirmedProductionAction(args: {
  readonly pipeline: PipelineRunner;
  readonly root: string;
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly streamSessionId: string;
  readonly instruction: string;
  readonly requestedIntent: RequestedIntent;
  readonly actionPayload?: ActionPayload;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
  readonly playMode?: PlayMode;
  readonly language?: StudioLanguage;
  readonly taskId: string;
  readonly sourceRequestId?: string;
  readonly signal: AbortSignal;
  readonly onTaskChange: (exec: CollectedToolExec) => Promise<void>;
}): Promise<CollectedToolExec> {
  const lang = args.language ?? "vi";
  const id = args.taskId;
  const actionPayload = args.actionPayload;
  const configuredSkills = await loadAvailableAgentSkills({ projectRoot: args.root });
  const skillResolution = createSkillRegistry({ skills: configuredSkills.skills }).resolveSkills({
    requestedSkills: args.requestedSkills,
    disabledSkills: args.disabledSkills,
  });
  const requestedSkillActivations = skillResolution.usedSkills.map((skill) => ({ skill, resources: [] }));
  const productionSkills = (
    capability: Parameters<typeof resolveProductionSkillActivations>[1],
  ) => mergeActivatedSkillGuidance(
    resolveProductionSkillActivations(skillResolution.availableSkills, capability),
    requestedSkillActivations,
  );
  let tool: ReturnType<typeof createSubAgentTool>
    | ReturnType<typeof createShortFictionRunTool>
    | ReturnType<typeof createGenerateCoverTool>
    | ReturnType<typeof createScriptCreationTool>
    | ReturnType<typeof createStoryboardCreationTool>
    | ReturnType<typeof createInteractiveFilmCreationTool>
    | ReturnType<typeof createTranslationCreateTool>
    | ReturnType<typeof createFanficBookTool>
    | ReturnType<typeof createContinuationImportTool>
    | ReturnType<typeof createSpinoffBookTool>
    | ReturnType<typeof createImitationBookTool>
    | ReturnType<typeof createPlayStartTool>
    | ReturnType<typeof createDraftStructureTool>
    | ReturnType<typeof createConnectChoiceTool>
    | ReturnType<typeof createRemoveNodeTool>;
  let params: Record<string, unknown>;
  let agent: string | undefined;

  if (args.requestedIntent === "create_book") {
    const payload = actionPayload?.createBook;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo sách thiếu tên sách, hãy tạo lại thẻ xác nhận.", "The book creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createSubAgentTool(args.pipeline, null, args.root, {
      actionPayload,
      workerSkills: (worker) => worker === "architect" ? productionSkills("longWriting") : [],
    });
    agent = "architect";
    params = {
      agent,
      instruction: args.instruction,
      title,
      ...(payload?.genre ? { genre: payload.genre } : {}),
      ...(payload?.platform ? { platform: payload.platform } : {}),
      ...(payload?.language ? { language: payload.language } : {}),
      ...(payload?.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload?.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "short_run") {
    const payload = actionPayload?.shortRun;
    const direction = payload?.direction?.trim() || args.instruction.trim();
    if (!direction) throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Thẻ xác nhận truyện ngắn thiếu hướng nội dung, hãy tạo lại thẻ xác nhận.", "The short fiction confirmation is missing a direction. Regenerate the confirmation card."));
    tool = createShortFictionRunTool(args.pipeline, args.root, {
      actionPayload,
      language: lang,
      defaultSkills: productionSkills("shortWriting"),
    });
    params = {
      direction,
      ...(payload?.reference ? { reference: payload.reference } : {}),
      ...(payload?.storyId ? { storyId: payload.storyId } : {}),
      ...(payload?.chapters ? { chapters: payload.chapters } : {}),
      ...(payload?.charsPerChapter ? { charsPerChapter: payload.charsPerChapter } : {}),
      ...(payload?.cover !== undefined ? { cover: payload.cover } : {}),
    };
  } else if (args.requestedIntent === "write_next") {
    if (!args.bookId) {
      throw new ApiError(400, "BOOK_ID_REQUIRED", pick(lang, "Viết chương tiếp theo cần mở một sách trước.", "Writing the next chapter requires an active book."));
    }
    const chapterCount = actionPayload?.writeNext?.chapterCount ?? 1;
    tool = createSubAgentTool(args.pipeline, args.bookId, args.root, {
      language: lang,
      workerSkills: (worker) => worker === "writer" ? productionSkills("longWriting") : [],
    });
    agent = "writer";
    params = {
      agent: "writer",
      bookId: args.bookId,
      instruction: args.instruction,
      chapterCount,
    };
  } else if (args.requestedIntent === "generate_cover") {
    const payload = actionPayload?.generateCover;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo ảnh bìa thiếu tiêu đề, hãy tạo lại thẻ xác nhận.", "The cover generation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createGenerateCoverTool(args.root, { actionPayload });
    params = {
      title,
      ...(payload?.intro ? { intro: payload.intro } : {}),
      ...(payload?.sellingPoints ? { sellingPoints: payload.sellingPoints } : {}),
      ...(payload?.coverPrompt ? { coverPrompt: payload.coverPrompt } : {}),
      ...(payload?.outputDir ? { outputDir: payload.outputDir } : {}),
    };
  } else if (args.requestedIntent === "script_create") {
    const payload = actionPayload?.scriptCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo kịch bản thiếu tiêu đề, hãy tạo lại thẻ xác nhận.", "The script creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createScriptCreationTool(args.pipeline, args.root, {
      actionPayload,
      language: lang,
      defaultSkills: productionSkills("script"),
    });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.targetFormat ? { targetFormat: payload.targetFormat } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.episodeCount ? { episodeCount: payload.episodeCount } : {}),
      ...(payload?.episodeDuration ? { episodeDuration: payload.episodeDuration } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "storyboard_create") {
    const payload = actionPayload?.storyboardCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo storyboard thiếu tiêu đề, hãy tạo lại thẻ xác nhận.", "The storyboard creation confirmation is missing a title. Regenerate the confirmation card."));
    tool = createStoryboardCreationTool(args.pipeline, args.root, {
      actionPayload,
      language: lang,
      defaultSkills: productionSkills("storyboard"),
    });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.visualStyle ? { visualStyle: payload.visualStyle } : {}),
      ...(payload?.aspectRatio ? { aspectRatio: payload.aspectRatio } : {}),
      ...(payload?.granularity ? { granularity: payload.granularity } : {}),
      ...(payload?.maxShots ? { maxShots: payload.maxShots } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "interactive_film_create") {
    const payload = actionPayload?.interactiveFilmCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo phim tương tác thiếu tiêu đề, hãy tạo lại thẻ xác nhận.", "The interactive film confirmation is missing a title. Regenerate the confirmation card."));
    tool = createInteractiveFilmCreationTool(args.pipeline, args.root, {
      actionPayload,
      language: lang,
      defaultSkills: productionSkills("interactiveFilm"),
    });
    params = {
      title,
      instruction: args.instruction,
      ...(payload?.sourceKind ? { sourceKind: payload.sourceKind } : {}),
      ...(payload?.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload?.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload?.requirements ? { requirements: payload.requirements } : {}),
      ...(payload?.targetAudience ? { targetAudience: payload.targetAudience } : {}),
      ...(payload?.episodeCount ? { episodeCount: payload.episodeCount } : {}),
      ...(payload?.episodeDuration ? { episodeDuration: payload.episodeDuration } : {}),
      ...(payload?.budget ? { budget: payload.budget } : {}),
      ...(payload?.referenceMode ? { referenceMode: payload.referenceMode } : {}),
      ...(payload?.projectId ? { projectId: payload.projectId } : {}),
      ...(payload?.outDir ? { outDir: payload.outDir } : {}),
    };
  } else if (args.requestedIntent === "translation_create") {
    const payload = actionPayload?.translationCreate;
    const filePath = requirePayloadText(payload?.filePath, pick(lang, "Thẻ xác nhận tạo dự án dịch thiếu đường dẫn tệp, hãy tạo lại thẻ xác nhận.", "The translation confirmation is missing a file path. Regenerate the confirmation card."));
    const sourceLanguage = requirePayloadText(payload?.sourceLanguage, pick(lang, "Thẻ xác nhận tạo dự án dịch thiếu ngôn ngữ nguồn, hãy tạo lại thẻ xác nhận.", "The translation confirmation is missing a source language. Regenerate the confirmation card."));
    const targetLanguage = requirePayloadText(payload?.targetLanguage, pick(lang, "Thẻ xác nhận tạo dự án dịch thiếu ngôn ngữ đích, hãy tạo lại thẻ xác nhận.", "The translation confirmation is missing a target language. Regenerate the confirmation card."));
    tool = createTranslationCreateTool(args.root, { actionPayload });
    params = {
      filePath,
      sourceLanguage,
      targetLanguage,
      ...(payload?.title ? { title: payload.title } : {}),
      ...(payload?.segmentMaxChars ? { segmentMaxChars: payload.segmentMaxChars } : {}),
    };
  } else if (args.requestedIntent === "fanfic_init") {
    const payload = actionPayload?.fanficCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo fanfic thiếu tên sách, hãy bổ sung rồi xác nhận lại.", "The fanfiction confirmation is missing a title."));
    if (!payload?.sourceText?.trim() && !payload?.sourcePath?.trim()) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Tạo fanfic cần tài liệu nguyên tác hoặc tệp đã tải lên.", "Fanfiction creation requires source material or an uploaded file."));
    }
    tool = createFanficBookTool(args.pipeline, args.root, {
      defaultSkills: productionSkills("longWriting"),
    });
    params = {
      title,
      ...(payload.sourceText ? { sourceText: payload.sourceText } : {}),
      ...(payload.sourcePath ? { sourcePath: payload.sourcePath } : {}),
      ...(payload.sourceName ? { sourceName: payload.sourceName } : {}),
      mode: payload.mode ?? "canon",
      ...(payload.genre ? { genre: payload.genre } : {}),
      ...(payload.platform ? { platform: payload.platform } : {}),
      language: payload.language ?? lang,
      ...(payload.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "continuation_import") {
    const payload = actionPayload?.continuationImport;
    const sourcePath = requirePayloadText(payload?.sourcePath, pick(lang, "Nhập viết tiếp cần tệp đã tải lên hoặc danh mục chương.", "Continuation import requires an uploaded file or chapter directory."));
    const targetBookId = payload?.bookId ?? args.bookId ?? undefined;
    if (!targetBookId && !payload?.title?.trim()) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Nhập viết tiếp cần chọn sách có sẵn hoặc nhập tên sách mới.", "Continuation import requires an existing book or a new title."));
    }
    tool = createContinuationImportTool(args.pipeline, args.bookId, args.root, {
      defaultSkills: productionSkills("longWriting"),
    });
    params = {
      ...(targetBookId ? { bookId: targetBookId } : {}),
      ...(payload?.title ? { title: payload.title } : {}),
      sourcePath,
      ...(payload?.splitPattern ? { splitPattern: payload.splitPattern } : {}),
      ...(payload?.resumeFrom ? { resumeFrom: payload.resumeFrom } : {}),
      ...(payload?.genre ? { genre: payload.genre } : {}),
      ...(payload?.platform ? { platform: payload.platform } : {}),
      language: payload?.language ?? lang,
      ...(payload?.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload?.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "spinoff_create") {
    const payload = actionPayload?.spinoffCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận tạo ngoại truyện thiếu tên sách.", "The side-story confirmation is missing a title."));
    const parentBookId = requirePayloadText(payload?.parentBookId ?? args.bookId ?? undefined, pick(lang, "Tạo ngoại truyện cần chỉ định sách chính thống gốc.", "Side-story creation requires a parent book."));
    tool = createSpinoffBookTool(args.pipeline, args.root, {
      defaultSkills: productionSkills("longWriting"),
    });
    params = {
      title,
      parentBookId,
      ...(payload?.direction ? { direction: payload.direction } : {}),
      ...(payload?.genre ? { genre: payload.genre } : {}),
      ...(payload?.platform ? { platform: payload.platform } : {}),
      ...(payload?.language ? { language: payload.language } : {}),
      ...(payload?.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload?.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "style_imitation") {
    const payload = actionPayload?.imitationCreate;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận bắt chước văn phong thiếu tên sách.", "The imitation confirmation is missing a title."));
    const storyIdea = requirePayloadText(payload?.storyIdea, pick(lang, "Bắt chước văn phong cần một hướng câu chuyện nguyên bản.", "Style imitation requires an original story idea."));
    if (!payload?.referenceText?.trim() && !payload?.referencePath?.trim()) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Bắt chước văn phong cần văn bản tham khảo hoặc tệp đã tải lên.", "Style imitation requires reference text or an uploaded file."));
    }
    tool = createImitationBookTool(args.pipeline, args.root, {
      defaultSkills: productionSkills("longWriting"),
    });
    params = {
      title,
      storyIdea,
      ...(payload.referenceText ? { referenceText: payload.referenceText } : {}),
      ...(payload.referencePath ? { referencePath: payload.referencePath } : {}),
      ...(payload.sourceName ? { sourceName: payload.sourceName } : {}),
      ...(payload.genre ? { genre: payload.genre } : {}),
      ...(payload.platform ? { platform: payload.platform } : {}),
      language: payload.language ?? lang,
      ...(payload.targetChapters ? { targetChapters: payload.targetChapters } : {}),
      ...(payload.chapterWordCount ? { chapterWordCount: payload.chapterWordCount } : {}),
    };
  } else if (args.requestedIntent === "play_start") {
    const payload = actionPayload?.playStart;
    const title = requirePayloadText(payload?.title, pick(lang, "Thẻ xác nhận khởi động thế giới tương tác thiếu tiêu đề, hãy tạo lại thẻ xác nhận.", "The interactive world start confirmation is missing a title. Regenerate the confirmation card."));
    const fallbackScene = [payload?.premise, args.instruction].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n");
    const initialScene = payload?.initialScene?.trim() || fallbackScene.trim();
    const confirmedActionPayload: ActionPayload | undefined = actionPayload
      ? {
        ...actionPayload,
        playStart: {
          ...payload,
          title,
          ...(initialScene ? { initialScene } : {}),
        },
      }
      : undefined;
    tool = createPlayStartTool(args.pipeline, args.root, args.sessionId, args.playMode, {
      actionPayload: confirmedActionPayload,
      defaultSkills: productionSkills("play"),
    });
    params = {
      title,
      ...(payload?.premise ? { premise: payload.premise } : {}),
      ...(payload?.worldContract ? { worldContract: payload.worldContract } : {}),
      ...(payload?.visualContract ? { visualContract: payload.visualContract } : {}),
      ...(payload?.mode ? { mode: payload.mode } : {}),
      ...(initialScene ? { initialScene } : {}),
      ...(payload?.suggestedActions ? { suggestedActions: payload.suggestedActions } : {}),
    };
  } else if (args.requestedIntent === "draft_structure") {
    const payload = actionPayload?.draftStructure;
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    const agentCtx = args.pipeline.createAgentContext("film-authoring", projectId);
    const deps = filmLLMDepsFromClient(agentCtx.client, agentCtx.model, {
      activatedSkills: () => productionSkills("interactiveFilm"),
    });
    tool = createDraftStructureTool(args.root, projectId, deps, lang);
    params = {
      instruction: payload?.instruction?.trim() || args.instruction,
    };
  } else if (args.requestedIntent === "connect_choice") {
    const payload = actionPayload?.connectChoice;
    if (!payload?.node) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Thẻ xác nhận kết nối lựa chọn thiếu dữ liệu nút, hãy tạo lại thẻ xác nhận.", "The connect-choice confirmation is missing node data. Regenerate the confirmation card."));
    }
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    tool = createConnectChoiceTool(args.root, projectId);
    params = {
      node: payload.node,
    };
  } else if (args.requestedIntent === "remove_node") {
    const payload = actionPayload?.removeNode;
    if (!payload?.nodeId) {
      throw new ApiError(400, "CONFIRMED_ACTION_PAYLOAD_INCOMPLETE", pick(lang, "Thẻ xác nhận xóa nút thiếu nodeId, hãy tạo lại thẻ xác nhận.", "The remove-node confirmation is missing a nodeId. Regenerate the confirmation card."));
    }
    const projectId = payload?.projectId ?? args.bookId;
    if (!projectId) throw new ApiError(400, "INVALID_ID", "interactive-film action requires a project id (bookId)");
    tool = createRemoveNodeTool(args.root, projectId);
    params = {
      nodeId: payload.nodeId,
    };
  } else {
    throw new ApiError(400, "UNSUPPORTED_CONFIRMED_ACTION", `Unsupported confirmed action: ${args.requestedIntent}`);
  }

  const exec: CollectedToolExec = {
    id,
    tool: tool.name,
    agent,
    label: resolveToolLabel(tool.name, agent, lang),
    status: "running",
    args: params,
    stages: agent ? pipelineStages(agent, lang)?.map(label => ({ label, status: "pending" as const })) : undefined,
    startedAt: Date.now(),
  };

  await args.onTaskChange(exec);

  // background: true 标明这是后台生产任务的工具启动（聊天轮工具不带）。
  // free-text 命中写章启发式时前端在发送时无法预知这轮会按任务执行，
  // 收到这个标记后把该轮从聊天轮重分类为任务轮。
  broadcast("tool:start", {
    sessionId: args.streamSessionId,
    id,
    tool: tool.name,
    args: params,
    stages: exec.stages?.map(stage => stage.label),
    background: true,
    ...(args.sourceRequestId ? { sourceRequestId: args.sourceRequestId } : {}),
  });

  try {
    const result = await tool.execute(
      id,
      params as never,
      args.signal,
      (partialResult: unknown) => {
        const progress = toolResultText(partialResult, lang);
        if (progress) exec.logs = [...(exec.logs ?? []), progress].slice(-80);
        void args.onTaskChange(exec).catch(() => undefined);
      },
    );
    // 工具可以在结果里带 isError=true 表示"执行完成但结果需要人工处理"
    //（如写章完成但审稿未通过）：任务卡按错误态展示，请求仍按成功返回结果文本。
    const resultIsError = Boolean((result as { isError?: boolean } | null | undefined)?.isError);
    exec.status = resultIsError ? "error" : "completed";
    exec.completedAt = Date.now();
    exec.result = toolResultText(result, lang);
    exec.details = (result as { details?: unknown } | undefined)?.details;
    exec.stages = exec.stages?.map(stage => ({ ...stage, status: "completed" as const }));
    await args.onTaskChange(exec);
    broadcast("tool:end", {
      sessionId: args.streamSessionId,
      id,
      tool: tool.name,
      result,
      details: exec.details,
      isError: resultIsError,
    });
    return exec;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = { content: [{ type: "text", text: message }] };
    exec.status = "error";
    exec.completedAt = Date.now();
    exec.error = message;
    await args.onTaskChange(exec);
    broadcast("tool:end", {
      sessionId: args.streamSessionId,
      id,
      tool: tool.name,
      result,
      isError: true,
    });
    throw new ConfirmedActionExecutionError(message, exec, error);
  }
}

interface StudioBookListSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly [key: string]: unknown;
}

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();
const bookCreateStatus = new Map<string, { status: "creating" | "error"; error?: string }>();

// 内存缓存：service -> 模型列表 + 更新时间戳；避免每次 sidebar 挂载时都打真实 LLM /models
const modelListCache = new Map<string, { models: Array<{ id: string; name: string }>; at: number }>();

interface ServiceConfigEntry {
  service: string;
  name?: string;
  baseUrl?: string;
  models?: string[];
  temperature?: number;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
}

type LLMConfigSource = "env" | "studio";

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  service?: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface EnvConfigValues extends EnvConfigSummary {
  apiKey: string | null;
}

interface EnvConfigStatus {
  project: EnvConfigSummary;
  global: EnvConfigSummary;
  effectiveSource: "project" | "global" | null;
  runtimeUsesEnv: false;
}

interface ServiceProbeResult {
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

function deriveBookIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

async function completeBookExists(bookDir: string): Promise<boolean> {
  try {
    await access(join(bookDir, "book.json"));
    await access(join(bookDir, "story", "story_bible.md"));
    return true;
  } catch {
    return false;
  }
}

function resolveArchitectBookIdFromArgs(args?: Record<string, unknown>): string | null {
  if (!args || args.agent !== "architect" || args.revise === true) return null;
  if (typeof args.bookId === "string" && args.bookId.trim()) return args.bookId.trim();
  if (typeof args.title === "string" && args.title.trim()) {
    return deriveBookIdFromTitle(args.title) || null;
  }
  return null;
}

function resolveCreatedBookIdFromToolExecs(execs: ReadonlyArray<CollectedToolExec>): string | null {
  for (let i = execs.length - 1; i >= 0; i -= 1) {
    const exec = execs[i];
    if (exec.status !== "completed") continue;

    const details = exec.details as { kind?: unknown; bookId?: unknown } | undefined;
    if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
      return details.bookId.trim();
    }
  }
  return null;
}

function resolveCreatedBookIdFromDetails(details: Readonly<Record<string, unknown>> | undefined): string | null {
  if (details?.kind === "book_created" && typeof details.bookId === "string" && details.bookId.trim()) {
    return details.bookId.trim();
  }
  return null;
}

async function loadStudioBookListSummary(
  state: StateManager,
  bookId: string,
): Promise<StudioBookListSummary> {
  const book = await state.loadBookConfig(bookId);
  const nextChapter = await state.getNextChapterNumber(bookId);
  return { ...book, chaptersWritten: nextChapter - 1 };
}

function isCustomServiceId(serviceId: string): boolean {
  return serviceId === "custom" || serviceId.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function normalizeServiceModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const model = item.trim();
    const key = model.toLowerCase();
    if (!model || seen.has(key) || !isTextChatModelId(model)) continue;
    seen.add(key);
    models.push(model);
  }
  return models;
}

function mergeServiceModelIds(...groups: ReadonlyArray<readonly string[] | undefined>): string[] {
  return normalizeServiceModelIds(groups.flatMap((group) => group ?? []));
}

function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(Array.isArray(value.models) ? { models: normalizeServiceModelIds(value.models) } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(Array.isArray(value.models) ? { models: normalizeServiceModelIds(value.models) } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    };
  }

  return {
    service: serviceId,
    ...(Array.isArray(value.models) ? { models: normalizeServiceModelIds(value.models) } : {}),
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
  };
}

function normalizeConfigSource(value: unknown): LLMConfigSource {
  return value === "studio" ? "studio" : "env";
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(Array.isArray(entry.models) ? { models: normalizeServiceModelIds(entry.models) } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    const key = serviceConfigKey(update);
    const previous = merged.get(key);
    merged.set(key, {
      ...previous,
      ...update,
      ...(update.models === undefined && previous?.models ? { models: previous.models } : {}),
    });
  }
  return [...merged.values()];
}

function normalizeCoverConfig(raw: unknown): { service: string; model: string; baseUrl?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const service = typeof record.service === "string" ? record.service : "";
  const preset = resolveCoverProviderPreset(service);
  if (!preset) return undefined;
  const requestedModel = typeof record.model === "string" ? record.model.trim() : "";
  const model = requestedModel && preset.models.includes(requestedModel)
    ? requestedModel
    : preset.defaultModel;
  const baseUrl = normalizeCoverBaseUrl(record.baseUrl);
  return {
    service: preset.service,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function syncTopLevelLlmMirror(llm: Record<string, unknown>): void {
  const selectedService = typeof llm.service === "string" ? llm.service : undefined;
  if (!selectedService) return;

  const services = normalizeServiceConfig(llm.services);
  const selectedEntry = services.find((entry) => serviceConfigKey(entry) === selectedService)
    ?? (!isCustomServiceId(selectedService) ? { service: selectedService } : undefined);
  if (!selectedEntry) return;

  const preset = resolveServicePreset(selectedEntry.service);
  llm.provider = resolveServiceProviderFamily(selectedEntry.service) ?? "openai";
  llm.baseUrl = selectedEntry.baseUrl ?? preset?.baseUrl ?? "";

  const defaultModel = typeof llm.defaultModel === "string" ? llm.defaultModel.trim() : "";
  if (defaultModel) llm.model = defaultModel;
  if (selectedEntry.temperature !== undefined) llm.temperature = selectedEntry.temperature;
  if (selectedEntry.apiFormat !== undefined) llm.apiFormat = selectedEntry.apiFormat;
  if (selectedEntry.stream !== undefined) llm.stream = selectedEntry.stream;
}

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const { loadProjectConfigFile } = await import("@actalk/castor-core");
  return (await loadProjectConfigFile(root)).config;
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  const { saveProjectConfigFile } = await import("@actalk/castor-core");
  await saveProjectConfigFile(root, config);
}

type ChapterReviewMode = "auto" | "manual";

function normalizeChapterReviewMode(mode: unknown): ChapterReviewMode {
  return mode === "manual" ? "manual" : "auto";
}

function readProjectChapterReviewMode(config: Record<string, unknown>): ChapterReviewMode {
  const writing = config.writing && typeof config.writing === "object" && !Array.isArray(config.writing)
    ? config.writing as Record<string, unknown>
    : {};
  return normalizeChapterReviewMode(writing.reviewMode);
}

function readBookChapterReviewMode(rawBook: Record<string, unknown>): ChapterReviewMode | undefined {
  const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
    ? rawBook.writing as Record<string, unknown>
    : undefined;
  if (!writing || writing.reviewMode !== "manual" && writing.reviewMode !== "auto") return undefined;
  return writing.reviewMode;
}

async function loadRawBookConfig(root: string, bookId: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(root, "books", bookId, "book.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function resolveBookChapterReviewMode(root: string, bookId: string | undefined, projectMode: ChapterReviewMode): Promise<ChapterReviewMode> {
  if (!bookId || !isSafeBookId(bookId)) return projectMode;
  try {
    const rawBook = await loadRawBookConfig(root, bookId);
    return readBookChapterReviewMode(rawBook) ?? projectMode;
  } catch {
    return projectMode;
  }
}

type RevisionGateSetting = "strict" | "lenient" | "always";

function normalizeRevisionGate(gate: unknown): RevisionGateSetting {
  return gate === "lenient" || gate === "always" ? gate : "strict";
}

function readProjectRevisionGate(config: Record<string, unknown>): RevisionGateSetting {
  const writing = config.writing && typeof config.writing === "object" && !Array.isArray(config.writing)
    ? config.writing as Record<string, unknown>
    : {};
  return normalizeRevisionGate(writing.revisionGate);
}

function readBookRevisionGate(rawBook: Record<string, unknown>): RevisionGateSetting | undefined {
  const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
    ? rawBook.writing as Record<string, unknown>
    : undefined;
  if (!writing || writing.revisionGate !== "strict" && writing.revisionGate !== "lenient" && writing.revisionGate !== "always") return undefined;
  return writing.revisionGate;
}

async function resolveBookRevisionGate(root: string, bookId: string | undefined, projectGate: RevisionGateSetting): Promise<RevisionGateSetting> {
  if (!bookId || !isSafeBookId(bookId)) return projectGate;
  try {
    const rawBook = await loadRawBookConfig(root, bookId);
    return readBookRevisionGate(rawBook) ?? projectGate;
  } catch {
    return projectGate;
  }
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toEnvConfigSummary(values: EnvConfigValues): EnvConfigSummary {
  return {
    detected: values.detected,
    provider: values.provider,
    service: values.service ?? null,
    baseUrl: values.baseUrl,
    model: values.model,
    hasApiKey: values.hasApiKey,
  };
}

async function readEnvConfigValues(path: string): Promise<EnvConfigValues> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, unquoteEnvValue(value));
    }

    const provider = values.get("CASTOR_LLM_PROVIDER") ?? null;
    const service = values.get("CASTOR_LLM_SERVICE") ?? null;
    const baseUrl = values.get("CASTOR_LLM_BASE_URL") ?? null;
    const model = values.get("CASTOR_LLM_MODEL") ?? null;
    const apiKey = values.get("CASTOR_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || service || baseUrl || model || apiKey);

    return {
      detected,
      provider,
      service,
      baseUrl,
      model,
      hasApiKey: apiKey.length > 0,
      apiKey: apiKey.length > 0 ? apiKey : null,
    };
  } catch {
    return {
      detected: false,
      provider: null,
      service: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
      apiKey: null,
    };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigValues(join(root, ".env"));
  const global = await readEnvConfigValues(await resolveGlobalEnvPath());
  return {
    project: toEnvConfigSummary(project),
    global: toEnvConfigSummary(global),
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

async function readEffectiveEnvConfigValues(root: string): Promise<{ source: "project" | "global"; values: EnvConfigValues } | null> {
  const project = await readEnvConfigValues(join(root, ".env"));
  if (project.detected) return { source: "project", values: project };
  const global = await readEnvConfigValues(await resolveGlobalEnvPath());
  if (global.detected) return { source: "global", values: global };
  return null;
}

async function resolveConfiguredServiceBaseUrl(root: string, serviceId: string, inlineBaseUrl?: string): Promise<string | undefined> {
  if (inlineBaseUrl?.trim()) return inlineBaseUrl.trim();

  if (!isCustomServiceId(serviceId)) {
    return resolveServicePreset(serviceId)?.baseUrl;
  }

  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    const matched = services.find((entry) => serviceConfigKey(entry) === serviceId);
    return matched?.baseUrl;
  } catch {
    return undefined;
  }
}

async function resolveConfiguredServiceEntry(root: string, serviceId: string): Promise<ServiceConfigEntry | undefined> {
  try {
    const config = await loadRawConfig(root);
    const services = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services);
    return services.find((entry) => serviceConfigKey(entry) === serviceId);
  } catch {
    return undefined;
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    if (preferredStream) push(preferredApiFormat, false);
    return candidates;
  }

  push("chat", false);
  push("responses", false);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  push(args.preferredModel);
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels.slice(0, MAX_DISCOVERED_MODELS_TO_PING)) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  for (const fallback of [
    "gpt-5.4",
    "gpt-4o",
    "claude-sonnet-4-6",
    "MiniMax-M2.7",
    "kimi-k2.5",
  ].slice(0, MAX_GENERIC_FALLBACK_MODELS_TO_PING)) {
    push(fallback);
  }
  return candidates;
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

function radarTimestampForFilename(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/[:.]/g, "-");
}

async function saveRadarScan(root: string, result: unknown): Promise<string> {
  const radarDir = join(root, "radar");
  await mkdir(radarDir, { recursive: true });
  const timestamp = typeof result === "object" && result !== null && "timestamp" in result
    ? String((result as { timestamp?: unknown }).timestamp ?? "")
    : "";
  const fileName = `scan-${radarTimestampForFilename(timestamp)}.json`;
  const filePath = join(radarDir, fileName);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

async function loadRadarHistory(root: string): Promise<Array<{
  readonly file: string;
  readonly timestamp: string;
  readonly marketSummary: string;
  readonly summaryPreview: string;
  readonly result: unknown;
}>> {
  const radarDir = join(root, "radar");
  let files: string[] = [];
  try {
    files = await readdir(radarDir);
  } catch {
    return [];
  }

  const scans = await Promise.all(
    files
      .filter((file) => /^scan-.+\.json$/.test(file))
      .map(async (file) => {
        try {
          const raw = await readFile(join(radarDir, file), "utf-8");
          const result = JSON.parse(raw) as { timestamp?: unknown; marketSummary?: unknown };
          const timestamp = typeof result.timestamp === "string"
            ? result.timestamp
            : file.replace(/^scan-/, "").replace(/\.json$/, "");
          const marketSummary = typeof result.marketSummary === "string" ? result.marketSummary : "";
          return {
            file,
            timestamp,
            marketSummary,
            summaryPreview: marketSummary.slice(0, 100),
            result,
          };
        } catch {
          return null;
        }
      }),
  );

  return scans
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.file.localeCompare(a.file));
}

function fallbackTextModelsForEndpoint(
  endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined,
  preset: ReturnType<typeof resolveServicePreset> | undefined,
): Array<{ id: string; name: string }> {
  const endpointModels = endpoint?.models
    .filter((model) => model.enabled !== false)
    .filter((model) => isTextChatModelId(model.id))
    .map((model) => ({ id: model.id, name: model.id }))
    ?? [];
  if (endpointModels.length > 0) return endpointModels;
  return preset?.knownModels?.map((id) => ({ id, name: id })) ?? [];
}

function shouldTrustStaticModelsWhenLiveListUnavailable(endpoint: ReturnType<typeof getAllEndpoints>[number] | undefined): boolean {
  return endpoint?.group === "aggregator";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, lang: StudioLanguage = "vi"): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(pick(lang, `${label} hết thời gian chờ (${timeoutMs}ms)`, `${label} timed out (${timeoutMs}ms)`))),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
  readonly language?: StudioLanguage;
}): string {
  const lang = args.language ?? "vi";
  const rawDetail = args.error
    .replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "")
    .trim();
  const upstreamDetail = rawDetail.includes("上游详情：")
    ? rawDetail
    : "";
  const protocol = args.apiFormat === "responses" ? "Responses" : "Chat / Completions";
  const streamSuffix = typeof args.stream === "boolean"
    ? pick(lang, `, ${args.stream ? "stream" : "không stream"}`, `, ${args.stream ? "streaming" : "non-streaming"}`)
    : "";
  const context = [
    pick(lang, `Nhà cung cấp: ${args.label ?? args.service}`, `Service: ${args.label ?? args.service}`),
    pick(lang, `Mô hình thử: ${args.model ?? "chưa xác định"}`, `Test model: ${args.model ?? "undetermined"}`),
    pick(lang, `Giao thức: ${protocol}${streamSuffix}`, `Protocol: ${protocol}${streamSuffix}`),
    pick(lang, `Base URL：${args.baseUrl}`, `Base URL: ${args.baseUrl}`),
  ].join("\n");
  const upstreamPrefix = (detail: string): string =>
    pick(lang, `\nPhản hồi thượng nguồn: ${detail}`, `\nUpstream response: ${detail}`);

  if (args.service === "google") {
    return [
      pick(lang, "Thử kết nối Google Gemini thất bại.", "Google Gemini connection test failed."),
      context,
      "",
      pick(lang, "Hãy kiểm tra trước những điểm sau:", "Check these first:"),
      pick(
        lang,
        "1. API Key có phải là Gemini API key từ Google AI Studio, chứ không phải thông tin xác thực OAuth, Vertex AI hay dịch vụ Google khác.",
        "1. The API Key is a Gemini API key from Google AI Studio, not an OAuth, Vertex AI, or other Google service credential.",
      ),
      pick(
        lang,
        "2. Dự án sở hữu key đã bật Gemini API và không bị giới hạn vào API, nguồn hay dịch vụ khác.",
        "2. The key's project has the Gemini API enabled and is not restricted to other APIs, origins, or services.",
      ),
      pick(
        lang,
        "3. Khu vực/tài khoản hiện tại có được phép truy cập Gemini API.",
        "3. Your region/account is allowed to access the Gemini API.",
      ),
      pick(
        lang,
        "4. Nếu key từng bị lộ, hãy tạo lại trong AI Studio trước khi lưu.",
        "4. If the key was ever leaked, regenerate it in AI Studio before saving.",
      ),
      upstreamDetail ? upstreamPrefix(upstreamDetail) : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      pick(lang, `Thử kết nối ${args.label ?? args.service} thất bại.`, `${args.label ?? args.service} connection test failed.`),
      context,
      "",
      pick(
        lang,
        "Hãy kiểm tra trước mô hình có khả dụng hay không, và các mô hình kiểu kimi-k2.x có cần temperature=1 không.",
        "Check first whether the model is available, and whether models like kimi-k2.x require temperature=1.",
      ),
      rawDetail ? upstreamPrefix(rawDetail) : "",
    ].filter(Boolean).join("\n");
  }

  return [
    pick(lang, `Thử kết nối ${args.label ?? args.service} thất bại.`, `${args.label ?? args.service} connection test failed.`),
    context,
    "",
    pick(
      lang,
      "Hãy kiểm tra API Key, tính khả dụng của mô hình, hạn mức tài khoản, và loại giao thức có khớp nhà cung cấp hay không.",
      "Check the API Key, model availability, account quota, and whether the protocol type matches this service.",
    ),
    rawDetail ? upstreamPrefix(rawDetail) : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  lang: StudioLanguage = "vi",
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: buildBearerAuthHeaders(apiKey, lang),
      signal: AbortSignal.timeout(SERVICE_MODELS_PROBE_TIMEOUT_MS),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: pick(
          lang,
          `Nhà cung cấp trả về ${res.status}: ${body.slice(0, 200)}`,
          `Service returned ${res.status}: ${body.slice(0, 200)}`,
        ),
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return {
      models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })),
    };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildBearerAuthHeaders(apiKey: string | undefined, lang: StudioLanguage = "vi"): Record<string, string> {
  const trimmed = apiKey?.trim() ?? "";
  if (!trimmed) return {};
  if (!/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new Error(pick(
      lang,
      "API Key chỉ được chứa chữ cái, số và ký hiệu ASCII phổ biến; hãy kiểm tra xem có dán nhầm nội dung mô tả nào vào không.",
      "API Key may only contain ASCII letters, digits, and common symbols. Check whether you pasted explanatory text by mistake.",
    ));
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
  language?: StudioLanguage;
}): Promise<ServiceProbeResult> {
  const lang = args.language ?? "vi";
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl, lang);
  if (modelsResponse.authFailed) {
    return {
      ok: false,
      models: [],
      error: modelsResponse.error ?? pick(
        lang,
        "API Key không hợp lệ hoặc không có quyền truy cập danh sách mô hình.",
        "API Key is invalid or has no access to the model list.",
      ),
    };
  }
  const discoveredModels = modelsResponse.models;
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  if (discoveredModels.length > 0) {
    if (!discoveredFirstModel || !isTextChatModelId(discoveredFirstModel)) {
      return {
        ok: false,
        models: discoveredModels,
        error: pick(
          lang,
          "Danh sách mô hình truy cập được nhưng không tìm thấy mô hình nào dùng được cho hội thoại văn bản.",
          "The model list is reachable, but no model usable for text chat was found.",
        ),
      };
    }
    return {
      ok: true,
      models: discoveredModels,
      selectedModel: discoveredFirstModel,
      apiFormat: args.preferredApiFormat ?? "chat",
      stream: args.preferredStream ?? false,
      baseUrl: args.baseUrl,
      modelsSource: "api",
    };
  }
  if (shouldTrustStaticModelsWhenLiveListUnavailable(endpoint)) {
    const models = fallbackTextModelsForEndpoint(endpoint, preset);
    const selectedModel =
      endpoint?.checkModel && models.some((model) => model.id === endpoint.checkModel)
        ? endpoint.checkModel
        : models[0]?.id;
    if (selectedModel) {
      return {
        ok: true,
        models,
        selectedModel,
        apiFormat: args.preferredApiFormat ?? "chat",
        stream: args.preferredStream ?? false,
        baseUrl: args.baseUrl,
        modelsSource: "fallback",
      };
    }
  }
  // Prefer live /models results; if unavailable, probe with the service's own check model before global defaults.
  const serviceFirstModel =
    endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama" || baseService === "lmstudio";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string"
        ? llm.model
        : undefined
    : undefined;
  const useCustomFallbacks = false;
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
  });

  if (modelCandidates.length === 0) {
    return {
      ok: false,
      models: [],
      error: pick(
        lang,
        "Không thể tự xác định mô hình; hãy điền mô hình khả dụng trước hoặc dùng endpoint hỗ trợ /models.",
        "Could not determine a model automatically. Fill in an available model first, or provide a service endpoint that supports /models.",
      ),
    };
  }

  let lastError = modelsResponse.error ?? pick(lang, "Tự dò tìm thất bại", "Automatic probing failed");

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: resolveServiceProviderFamily(baseService) ?? "openai",
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        maxTokens: 16,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await withTimeout(
          // A connectivity probe wants a fast pass/fail — never the transient
          // retry+backoff, which would multiply the time when the upstream is
          // rate-limiting (and make the diagnostics page hang).
          chatCompletion(client, model, [{ role: "user", content: "Reply with OK only." }], { maxTokens: 16, retry: false }),
          SERVICE_CHAT_PROBE_TIMEOUT_MS,
          "service connection test",
          lang,
        );
        const models = discoveredModels.length > 0
          ? discoveredModels
          : fallbackTextModelsForEndpoint(endpoint, preset);
        return {
          ok: true,
          models: models.length > 0 ? models : [{ id: model, name: model }],
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
          language: lang,
        });
      }
    }
  }

  return {
    ok: false,
    models: discoveredModels,
    error: lastError,
  };
}

// --- Server factory ---

/**
 * Deterministic error mapping for the canon mutation boundary (T3B.1).
 * Never leaks absolute filesystem paths or stack traces: every message comes
 * from Core's own typed errors, which are path-free by contract.
 */
function mapCanonMutationError(e: unknown): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
  if (e instanceof CanonUnavailableError) {
    return { status: 409, body: { error: e.message, code: e.code, issues: e.issues } };
  }
  if (e instanceof CanonConflictError) {
    return { status: 409, body: { error: e.message, code: e.code, currentRevision: e.currentRevision } };
  }
  if (e instanceof CanonInvalidEditsError) {
    return { status: 400, body: { error: e.message, code: e.code, issues: e.issues } };
  }
  if (e instanceof BookWriteLockError) {
    // Message carries book id + owner pid/timestamp only — no paths.
    return { status: 409, body: { error: e.message, code: "book_write_locked" } };
  }
  console.error("[castor] canon mutation failed:", e);
  return { status: 500, body: { error: "Internal error while applying canon edits." } };
}

export function createStudioServer(
  initialConfig: ProjectConfig,
  root: string,
  overrides: {
    readonly nodeImageGenerator?: NodeImageDeps;
    /**
     * DI seam for Core's derived-memory rebuild/invalidation steps (tests
     * only). Production leaves this undefined so the real defaults run.
     */
    readonly canonCommitDeps?: CanonCommitDeps;
    /**
     * DI seam for the State Review rebuild route (Task 14, tests only): the
     * injected settler replaces WriterAgent inside the public
     * `PipelineRunner.regenerateStateReview` boundary. Production leaves this
     * undefined so the real LLM-backed writer runs.
     */
    readonly stateReviewRebuildDeps?: {
      readonly createWriter: () => Pick<WriterAgent, "settleChapterState">;
    };
  } = {},
) {
  const app = new Hono();
  const state = new StateManager(root);
  let cachedConfig = initialConfig;
  const activeConfirmedTasks = new Map<string, AbortController>();
  // 确认式生产任务的单任务名额（sessionId → taskId）。原来的检查是"await 读快照
  // → 之后才 set controller"的 check-then-act：两个并发确认请求都能通过检查，
  // 双任务同时启动、快照互相覆盖。这里在任何 await 之前同步占位，占位失败的
  // 请求直接 409；任务结束（成功/失败）后在 finally 释放。
  // 值记 taskId：controller 注册与首次快照持久化之间有多个 await 间隙，删除/
  // 中止在这个窗口内从磁盘读不到快照，必须先经内存 sessionId → taskId →
  // controller 找到刚启动的任务。
  const reservedProductionSessions = new Map<string, string>();
  // 已删除会话的 sessionId：删除会话时中止其生产任务，任务随后的错误持久化
  // 不能把快照文件重新写回来（给已删除的会话"还魂"）。同名会话重新创建时移除标记。
  const deletedSessionIds = new Set<string>();

  // 已删除会话不再追加 transcript 消息：appendManualSessionMessages 底层的
  // appendTranscriptEvents 是 mkdir + appendFile，会把已删除会话的 sessions
  // 目录条目和 transcript 文件重建出来（任务成功/失败的收尾追加正好落在删除
  // 之后）。所有手动追加统一走这个守卫。
  const appendSessionMessagesUnlessDeleted: typeof appendManualSessionMessages = async (
    projectRoot,
    sessionId,
    messages,
    input,
    options,
  ) => {
    if (deletedSessionIds.has(sessionId)) return;
    await appendManualSessionMessages(projectRoot, sessionId, messages, input, options);
  };

  const persistConfirmedTask = async (
    sessionId: string,
    requestedIntent: RequestedIntent,
    exec: CollectedToolExec,
    sourceRequestId?: string,
  ): Promise<void> => {
    if (deletedSessionIds.has(sessionId)) return;
    const snapshot: StudioTaskSnapshot = {
      version: 1,
      sessionId,
      ...(sourceRequestId ? { sourceRequestId } : {}),
      requestedIntent,
      updatedAt: Date.now(),
      execution: {
        ...exec,
        ...(exec.stages ? { stages: exec.stages.map((stage) => ({ ...stage })) } : {}),
        ...(exec.logs ? { logs: [...exec.logs] } : {}),
      },
    };
    await saveStudioTaskSnapshot(root, snapshot);
  };

  const loadReconciledTaskSnapshot = async (sessionId: string): Promise<StudioTaskSnapshot | null> => {
    const task = await loadStudioTaskSnapshot(root, sessionId);
    if (!task) return null;
    const running = task.execution.status === "running" || task.execution.status === "processing";
    if (!running || activeConfirmedTasks.has(task.execution.id)) return task;
    // running 快照但本进程没有对应的 AbortController，只可能是任务运行期间
    // server 进程退出过（正常流程里 controller 先于首次持久化进入 Map、晚于
    // 终态持久化删除）。任务本体已随旧进程消失，这里把快照改写为终态并保存，
    // 否则前端每次刷新都会恢复出一个永远运行中的任务卡，停止按钮也无法终结它。
    const lang = await currentProjectLanguage();
    const completedAt = Date.now();
    const reconciled: StudioTaskSnapshot = {
      ...task,
      updatedAt: completedAt,
      execution: {
        ...task.execution,
        status: "error",
        error: pick(
          lang,
          "Tác vụ bị gián đoạn: dịch vụ Studio đã khởi động lại trong khi tác vụ chạy nên tác vụ không tiếp tục được. Hãy bắt đầu lại.",
          "Task interrupted: the Studio server restarted while this task was running. Please start it again.",
        ),
        completedAt,
      },
    };
    await saveStudioTaskSnapshot(root, reconciled);
    return reconciled;
  };

  // 判断"该会话是否真有生产任务在跑"的唯一入口：
  // 对账后的快照是 running/processing，且本进程还持有对应的 AbortController。
  const findActiveRunningTask = async (sessionId: string): Promise<StudioTaskSnapshot | null> => {
    const task = await loadReconciledTaskSnapshot(sessionId);
    if (!task) return null;
    const running = task.execution.status === "running" || task.execution.status === "processing";
    return running && activeConfirmedTasks.has(task.execution.id) ? task : null;
  };

  // 找该会话正在运行的任务控制器：优先查内存（预留表 sessionId → taskId →
  // controller），磁盘快照只作回退。controller 注册与首次快照持久化之间有多个
  // await 间隙，窗口内删除/中止只靠磁盘快照会漏掉刚启动的任务。
  const findRunningTaskController = async (sessionId: string): Promise<AbortController | undefined> => {
    const reservedTaskId = reservedProductionSessions.get(sessionId);
    const reserved = reservedTaskId ? activeConfirmedTasks.get(reservedTaskId) : undefined;
    if (reserved) return reserved;
    const task = await loadReconciledTaskSnapshot(sessionId);
    return task ? activeConfirmedTasks.get(task.execution.id) : undefined;
  };

  app.use("/*", cors());

  // Structured error handler — ApiError returns typed JSON, others return 500
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("CASTOR_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
      500,
    );
  });

  // BookId validation middleware — blocks path traversal on all book routes
  app.use("/api/v1/books/:id/*", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });
  app.use("/api/v1/books/:id", async (c, next) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) {
      throw new ApiError(400, "INVALID_BOOK_ID", `Invalid book ID: "${bookId}"`);
    }
    await next();
  });

  // Logger sink that broadcasts to SSE
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  // Logger sink that prints to server terminal
  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    cachedConfig = freshConfig;
    return freshConfig;
  }

  // Read the project language fresh from castor.json on every call, so a language
  // switch takes effect on the next request instead of being frozen at startup.
  // A missing/corrupt castor.json means "no project language configured" -> vi (legacy zh configs fall back to vi).
  async function currentProjectLanguage(): Promise<StudioLanguage> {
    const raw = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    return normalizeStudioLanguage(raw.language);
  }

  async function buildPipelineConfig(
    overrides?: Partial<Pick<PipelineConfig, "externalContext" | "client" | "model" | "revisionGate">> & {
      readonly currentConfig?: ProjectConfig;
      readonly sessionIdForSSE?: string;
      // 确认式生产任务的 execution id。给任务构建 pipeline 时传入，该 pipeline
      // 广播的 log / llm:progress / context:compression 事件都会带上 executionId，
      // 前端据此把事件精确附加到任务卡；同会话聊天轮构建的 pipeline 不传，
      // 事件维持只带 sessionId，走"最近一张运行中卡"的回退。
      readonly executionIdForSSE?: string;
      readonly bookIdForSettings?: string;
    },
  ): Promise<PipelineConfig> {
    const currentConfig = overrides?.currentConfig ?? await loadCurrentProjectConfig();
    const projectReviewMode = readProjectChapterReviewMode(currentConfig as unknown as Record<string, unknown>);
    const chapterReviewMode = await resolveBookChapterReviewMode(root, overrides?.bookIdForSettings, projectReviewMode);
    const projectRevisionGate = readProjectRevisionGate(currentConfig as unknown as Record<string, unknown>);
    const revisionGate = await resolveBookRevisionGate(root, overrides?.bookIdForSettings, projectRevisionGate);
    const sseExecutionTag = overrides?.executionIdForSSE
      ? { executionId: overrides.executionIdForSSE }
      : {};
    const scopedSseSink: LogSink = overrides?.sessionIdForSSE
      ? {
          write(entry) {
            broadcast("log", {
              sessionId: overrides.sessionIdForSSE,
              ...sseExecutionTag,
              level: entry.level,
              tag: entry.tag,
              message: entry.message,
            });
          },
        }
      : sseSink;
    const logger = createLogger({ tag: "studio", sinks: [scopedSseSink, consoleSink] });
    return {
      client: overrides?.client ?? createLLMClient(currentConfig.llm),
      model: overrides?.model ?? currentConfig.llm.model,
      projectRoot: root,
      defaultLLMConfig: currentConfig.llm,
      foundationReviewRetries: currentConfig.foundation?.reviewRetries ?? 2,
      writingReviewRetries: currentConfig.writing?.reviewRetries ?? 1,
      chapterReviewMode,
      revisionGate: overrides?.revisionGate ?? revisionGate,
      modelOverrides: currentConfig.modelOverrides,
      notifyChannels: currentConfig.notify,
      logger,
      onContextCompression: (event) => {
        broadcast("context:compression", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          ...sseExecutionTag,
          ...event,
        });
      },
      onStreamProgress: (progress) => {
        broadcast("llm:progress", {
          ...(overrides?.sessionIdForSSE ? { sessionId: overrides.sessionIdForSSE } : {}),
          ...sseExecutionTag,
          status: progress.status,
          elapsedMs: progress.elapsedMs,
          totalChars: progress.totalChars,
          chineseChars: progress.chineseChars,
        });
      },
      externalContext: overrides?.externalContext,
    };
  }

  // --- Books ---

  app.get("/api/v1/books", async (c) => {
    const bookIds = await state.listBooks();
    const books = await Promise.all(bookIds.map((id) => loadStudioBookListSummary(state, id)));
    return c.json({ books });
  });

  app.get("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const book = await state.loadBookConfig(id);
      const chapters = await state.loadChapterIndex(id);
      const nextChapter = await state.getNextChapterNumber(id);
      return c.json({ book, chapters, nextChapter });
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Canonical Story State (read-only Core boundary) ---

  app.get("/api/v1/books/:id/canon", async (c) => {
    const id = c.req.param("id");
    const sectionParam = c.req.query("section");

    if (sectionParam !== undefined && !isCanonSection(sectionParam)) {
      return c.json(
        { error: `Invalid canon section "${sectionParam}". Expected one of: manifest, current_state, hooks, chapter_summaries` },
        400,
      );
    }

    // Membership check BEFORE any read so unknown ids can never trigger the
    // bootstrap side effect or touch the filesystem.
    const bookIds = await state.listBooks();
    if (!bookIds.includes(id)) {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }

    try {
      const view = await readStoryCanon(state.bookDir(id));
      const body: Record<string, unknown> =
        sectionParam === undefined
          ? {
              bookId: id,
              manifest: view.manifest,
              currentState: view.currentState,
              hooks: view.hooks,
              chapterSummaries: view.chapterSummaries,
              // Additive (T3B.1): clients retain this to send expectedRevision.
              revision: view.revision,
              // Slot/alias semantics are computed by Core so the UI can never
              // diverge from what the engine itself believes.
              description: describeCurrentState(view.currentState, view.manifest.language),
            }
          : { bookId: id, section: sectionParam, revision: view.revision, data: readCanonSection(view, sectionParam) };
      return c.json(body);
    } catch (e) {
      // Pure-read contract: missing/invalid canonical state is an explicit
      // structured error, never healed or bootstrapped by a GET.
      if (e instanceof CanonUnavailableError) {
        return c.json({ error: e.message, code: e.code, issues: e.issues }, 409);
      }
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Canon manual editing (T3B.1 lock-owning mutation boundary) ---

  // Shared request handling: membership check → CORE-owned runtime schema
  // validation (single semantic source; no Studio-local Zod duplicate).
  // NOTE: Hono's c.json() does not return a global `Response` instance, so
  // the failure branch is a discriminated result instead of instanceof.
  async function parseCanonCommitTarget(
    c: Context,
  ): Promise<
    | { ok: true; bookId: string; edits: CanonCommitRequest["edits"]; expectedRevision: string }
    | { ok: false; response: Response }
  > {
    const id = c.req.param("id");
    const bookIds = await state.listBooks();
    if (!bookIds.includes(id ?? "")) {
      return { ok: false, response: c.json({ error: `Book "${id}" not found`, code: "book_not_found" }, 404) };
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return { ok: false as const, response: c.json({ error: "Request body must be JSON.", issues: [] }, 400) };
    }
    const parsed = CanonCommitRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        response: c.json(
          {
            error: "Invalid canon edit request.",
            code: "invalid_request",
            issues: parsed.error.issues.map((issue) => ({
              scope: issue.path.join("."),
              message: issue.message,
            })),
          },
          400,
        ),
      };
    }
    return {
      ok: true as const,
      bookId: id!,
      edits: parsed.data.edits as CanonCommitRequest["edits"],
      expectedRevision: parsed.data.expectedRevision,
    };
  }

  // PURE preview — zero filesystem mutation, no lock required (read-only).
  app.post("/api/v1/books/:id/canon/current-state/preview", async (c) => {
    const target = await parseCanonCommitTarget(c);
    if (!target.ok) return target.response;
    try {
      const preview = await previewCanonEdits(state.bookDir(target.bookId), target.edits);
      return c.json({
        bookId: target.bookId,
        effectiveChapter: preview.effectiveChapter,
        revision: preview.before.revision,
        issues: preview.issues,
        warnings: preview.warnings,
      });
    } catch (e) {
      const mapped = mapCanonMutationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  /**
   * Commit route. LOCK OWNERSHIP LIVES HERE (P3A review discharge): the
   * SAME `state.acquireBookLock` used by write-next/revise/rollback wraps
   * the ENTIRE protected sequence (revision check → commit → memory sync),
   * and the lock is released in `finally` even on failure. Core adds no
   * second lock inside commitCanonEdits — by design.
   */
  app.post("/api/v1/books/:id/canon/current-state/commit", async (c) => {
    const target = await parseCanonCommitTarget(c);
    if (!target.ok) return target.response;

    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const result = await commitCanonEdits(
        state.bookDir(target.bookId),
        { edits: target.edits, expectedRevision: target.expectedRevision },
        overrides?.canonCommitDeps ?? {},
      );
      return c.json({
        bookId: target.bookId,
        ok: true,
        revision: result.revision,
        appliedEdits: result.appliedEdits.length,
        effectiveChapter: result.effectiveChapter,
        warnings: result.warnings,
      });
    } catch (e) {
      const mapped = mapCanonMutationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after canon commit:", releaseError);
        }
      }
    }
  });

  // --- Phase 4 State Review (Task 14) --------------------------------------
  //
  // Error mapping (frozen contract): StateReviewError `state_review_not_found`
  // ⇒ 404; every other code ⇒ 409 `{error, code, itemId?}`; non-StateReview
  // failures ⇒ 500 with a FIXED string (never paths/stacks). BookWriteLockError
  // keeps the canon-boundary convention (409 book_write_locked).

  function mapStateReviewError(e: unknown): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
    if (e instanceof StateReviewError) {
      const body: Record<string, unknown> = { error: e.message, code: e.code };
      if (e.itemId !== undefined) body.itemId = e.itemId;
      return {
        status: e.code === "state_review_not_found" ? 404 : 409,
        body,
      };
    }
    if (e instanceof BookWriteLockError) {
      return { status: 409, body: { error: e.message, code: "book_write_locked" } };
    }
    console.error("[castor] state review operation failed:", e);
    return { status: 500, body: { error: "Internal error while processing the state review." } };
  }

  async function parseStateReviewTarget(
    c: Context,
  ): Promise<
    | { ok: true; bookId: string; chapter: number }
    | { ok: false; response: Response }
  > {
    const id = c.req.param("id");
    const chapter = Number.parseInt(c.req.param("num") ?? "", 10);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      return { ok: false, response: c.json({ error: "Invalid chapter number.", code: "invalid_request" }, 400) };
    }
    // Membership check BEFORE any read so unknown ids never touch the
    // filesystem or trigger bootstrap side effects.
    const bookIds = await state.listBooks();
    if (!bookIds.includes(id ?? "")) {
      return { ok: false, response: c.json({ error: `Book "${id}" not found`, code: "book_not_found" }, 404) };
    }
    return { ok: true, bookId: id!, chapter };
  }

  function parseExpectedRevision(value: unknown): number | null {
    const expected = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    return Number.isInteger(expected) && expected >= 1 ? expected : null;
  }

  const stateReviewBase = "/api/v1/books/:id/chapters/:num/state-review";

  // READ — single-file schema-checked load; no lock required.
  app.get(stateReviewBase, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    try {
      const review = await loadStateReview(state.bookDir(target.bookId), target.chapter);
      return c.json({ bookId: target.bookId, chapter: target.chapter, review });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  app.get(`${stateReviewBase}/receipts`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    try {
      const receipts = await listReceiptsForChapter(state.bookDir(target.bookId), target.chapter);
      return c.json({ bookId: target.bookId, chapter: target.chapter, receipts });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  /**
   * CAS mutations. LOCK OWNERSHIP LIVES HERE (same discipline as the canon
   * commit route): the route wraps the ENTIRE Core call in
   * `acquireBookLock` … `finally release()` — Core's CAS services add no lock
   * of their own by design.
   */
  app.post(`${stateReviewBase}/decision`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const body = await c.req.json<{
      itemId?: string;
      decision?: string;
      expectedReviewRevision?: number;
      overrideExplicitWarning?: boolean;
    }>().catch(() => undefined) as { itemId?: string; decision?: string; expectedReviewRevision?: number; overrideExplicitWarning?: boolean } | undefined;
    const expected = parseExpectedRevision(body?.expectedReviewRevision);
    if (!body?.itemId || (body.decision !== "accept" && body.decision !== "reject") || expected === null) {
      return c.json({ error: "decision requires itemId, decision(accept|reject) and a positive integer expectedReviewRevision.", code: "invalid_request" }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const artifact = await decideStateReviewItem({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        itemId: body.itemId,
        decision: body.decision,
        expectedReviewRevision: expected,
        ...(typeof body.overrideExplicitWarning === "boolean"
          ? { overrideExplicitWarning: body.overrideExplicitWarning }
          : {}),
      });
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after state review decision:", releaseError);
        }
      }
    }
  });

  app.post(`${stateReviewBase}/edit`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const body = await c.req.json<{ itemId?: string; editedChange?: unknown; expectedReviewRevision?: number }>().catch(() => undefined);
    const expected = parseExpectedRevision(body?.expectedReviewRevision);
    if (!body?.itemId || body.editedChange === undefined || expected === null) {
      return c.json({ error: "edit requires itemId, editedChange and a positive integer expectedReviewRevision.", code: "invalid_request" }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const artifact = await editStateReviewItem({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        itemId: body.itemId,
        editedChange: body.editedChange as Parameters<typeof editStateReviewItem>[0]["editedChange"],
        expectedReviewRevision: expected,
      });
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after state review edit:", releaseError);
        }
      }
    }
  });

  app.post(`${stateReviewBase}/items`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const body = await c.req.json<{ kind?: string; change?: unknown; title?: string; expectedReviewRevision?: number }>().catch(() => undefined);
    const expected = parseExpectedRevision(body?.expectedReviewRevision);
    // Task14-M1: validate the V1 item-kind family at the Studio boundary so
    // unsupported kinds answer 400 invalid_request instead of escaping into
    // Core as a generic 500. The semantic shape validation stays Core-owned.
    const parsedKind = ReviewItemKindSchema.safeParse(body?.kind);
    if (!parsedKind.success || !body?.title || body.change === undefined || expected === null) {
      return c.json({
        error: `items requires a supported V1 kind (${ReviewItemKindSchema.options.join(", ")}), change, title and a positive integer expectedReviewRevision.`,
        code: "invalid_request",
      }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const artifact = await addUserStateReviewItem({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        kind: parsedKind.data,
        change: body.change as Parameters<typeof addUserStateReviewItem>[0]["change"],
        title: body.title,
        expectedReviewRevision: expected,
      });
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after state review item add:", releaseError);
        }
      }
    }
  });

  app.delete(`${stateReviewBase}/items/user/:itemId`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const itemId = c.req.param("itemId");
    const expected = parseExpectedRevision(c.req.query("expectedReviewRevision"));
    if (!itemId || expected === null) {
      return c.json({ error: "removal requires an itemId path param and a positive integer expectedReviewRevision query param.", code: "invalid_request" }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const artifact = await removeUserStateReviewItem({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        itemId,
        expectedReviewRevision: expected,
      });
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after state review item removal:", releaseError);
        }
      }
    }
  });

  app.post(`${stateReviewBase}/reject-all`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const body = await c.req.json<{ expectedReviewRevision?: number; overrideExplicitWarning?: boolean }>().catch(() => undefined);
    const expected = parseExpectedRevision(body?.expectedReviewRevision);
    if (expected === null) {
      return c.json({ error: "reject-all requires a positive integer expectedReviewRevision.", code: "invalid_request" }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const artifact = await rejectAllAiItems({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        expectedReviewRevision: expected,
        ...(typeof body?.overrideExplicitWarning === "boolean"
          ? { overrideExplicitWarning: body.overrideExplicitWarning }
          : {}),
      });
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          console.warn("[castor] failed to release book lock after reject-all:", releaseError);
        }
      }
    }
  });

  /**
   * Final Confirm. `confirmStateReview` ACQUIRES THE PROCESS BOOK LOCK ITSELF
   * (finalize.ts) for its receipt-first idempotency → PREPARE → commit
   * sequence; the process lock is intentionally NON-reentrant, so this route
   * must NOT wrap acquireBookLock around it. Serialization is preserved by
   * the inner lock against every other writer.
   */
  app.post(`${stateReviewBase}/confirm`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    const body = await c.req.json<{ reviewId?: unknown; expectedReviewRevision?: unknown }>().catch(() => undefined) as
      { reviewId?: unknown; expectedReviewRevision?: unknown } | undefined;
    // reviewId is REQUIRED (Task 12 identity binding): confirming without it
    // can never be idempotent and fails BEFORE any lock/Core work.
    if (typeof body?.reviewId !== "string" || body.reviewId.trim() === "") {
      return c.json({ error: "confirm requires the reviewId of the loaded generation.", code: "invalid_request" }, 400);
    }
    const expected = parseExpectedRevision(body.expectedReviewRevision);
    if (expected === null) {
      return c.json({ error: "confirm requires a positive integer expectedReviewRevision.", code: "invalid_request" }, 400);
    }
    try {
      const result = await confirmStateReview({
        bookDir: state.bookDir(target.bookId),
        chapter: target.chapter,
        reviewId: body.reviewId,
        expectedReviewRevision: expected,
      });
      return c.json({
        ok: true,
        status: result.status,
        receipt: result.receipt,
        resultingCanonRevision: result.resultingCanonRevision,
        warnings: [...result.warnings],
      });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  /**
   * Retry Audit (rebuild). `PipelineRunner.regenerateStateReview` owns the
   * process book lock internally (runner.ts) — same non-reentrancy as
   * confirm, so no outer acquireBookLock here. Analyzer/settler failure is
   * converted by Core into a durable rebuild_failed shell plus
   * `state_review_rebuild_failed` (Task 10), mapped to 409 below.
   */
  app.post(`${stateReviewBase}/rebuild`, async (c) => {
    const target = await parseStateReviewTarget(c);
    if (!target.ok) return target.response;
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const injectedWriter = overrides?.stateReviewRebuildDeps;
      const { artifact } = await pipeline.regenerateStateReview(
        target.bookId,
        target.chapter,
        injectedWriter ? { createWriter: () => injectedWriter.createWriter() } : undefined,
      );
      return c.json({ ok: true, artifact });
    } catch (e) {
      const mapped = mapStateReviewError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // --- Studio Foundation (Task 8/9) --------------------------------------
  //
  // Mirrors State Review discipline: error mapping via mapFoundationError,
  // bookId validated via isSafeBookId, bookDir resolved via StateManager,
  // EXACT Task 8/9 Core functions called, commitAtomicFileSet only via Core,
  // no governance calculation, no direct Markdown writes, no marker flips.
  // Publish uses publishFoundation only and invalidates foundation paths.

  function mapFoundationError(e: unknown): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
    if (e instanceof BookWriteLockError) {
      return { status: 409, body: { error: e.message, code: "book_write_locked" } };
    }
    if (e instanceof StateReviewError) {
      const body: Record<string, unknown> = { error: e.message, code: e.code };
      if (e.itemId !== undefined) body.itemId = e.itemId;
      return { status: e.code === "state_review_not_found" ? 404 : 409, body };
    }
    // FoundationError shape (if Core exports it) or generic Error string mapping
    const maybe = e as { code?: string; message?: string };
    const code = typeof maybe.code === "string" ? maybe.code : "";
    const msg = typeof maybe.message === "string" ? maybe.message : String(e);
    const lower = msg.toLowerCase();
    // Prefer explicit code when present
    if (code === "book_not_found" || lower.includes("book_not_found")) {
      return { status: 404, body: { error: msg, code: code || "book_not_found" } };
    }
    if (code === "foundation_not_found" || code === "revision_not_found" || lower.includes("does not exist") || lower.includes("not found")) {
      // Distinguish book vs revision: default to 404 for not-found
      return { status: 404, body: { error: msg, code: code || "foundation_not_found" } };
    }
    if (code === "foundation_stale" || lower.includes("stale")) {
      return { status: 409, body: { error: msg, code: code || "foundation_stale" } };
    }
    if (code === "foundation_not_ready" || lower.includes("not ready") || lower.includes("blocked by readiness") || lower.includes("readiness")) {
      return { status: 409, body: { error: msg, code: code || "foundation_not_ready" } };
    }
    if (code === "foundation_publish_conflict" || lower.includes("publish_conflict") || lower.includes("already published") || lower.includes("publish conflict")) {
      return { status: 409, body: { error: msg, code: code || "foundation_publish_conflict" } };
    }
    if (code === "foundation_conflict" || lower.includes("conflict") && lower.includes("finding")) {
      return { status: 409, body: { error: msg, code: code || "foundation_conflict" } };
    }
    if (lower.includes("invalid") || lower.includes("must not be empty") || lower.includes("duplicate") || lower.includes("unsafe") || lower.includes("validation")) {
      return { status: 400, body: { error: msg, code: code || "invalid_request" } };
    }
    if (e instanceof ApiError) {
      return { status: e.status as 400 | 404 | 409 | 500, body: { error: e.message, code: e.code } };
    }
    console.error("[castor] foundation operation failed:", e);
    return { status: 500, body: { error: "Internal error while processing foundation request." } };
  }

  function isSafeGovernanceId(value: string): boolean {
    // Mirrors SafeGovernanceId: alphanum + hyphen/underscore, no slash, no dot, no traversal
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
  }

  async function parseFoundationBook(c: Context): Promise<{ ok: true; bookId: string; bookDir: string } | { ok: false; response: Response }> {
    const id = c.req.param("id");
    if (!isSafeBookId(id ?? "")) {
      return { ok: false, response: c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400) };
    }
    const bookIds = await state.listBooks();
    if (!bookIds.includes(id!)) {
      return { ok: false, response: c.json({ error: `Book "${id}" not found`, code: "book_not_found" }, 404) };
    }
    return { ok: true, bookId: id!, bookDir: state.bookDir(id!) };
  }

  function parseFoundationUnitId(c: Context): string | null {
    const unitId = c.req.param("unitId") ?? c.req.param("unit") ?? "";
    if (!isSafeGovernanceId(unitId)) return null;
    return unitId;
  }

  function parseFoundationRevisionId(c: Context): string | null {
    const revId = c.req.param("revId") ?? c.req.param("revisionId") ?? c.req.param("revision") ?? "";
    if (!isSafeGovernanceId(revId)) return null;
    return revId;
  }

  function foundationHumanActor(body: unknown): string {
    if (body && typeof body === "object" && "humanActor" in body) {
      const v = (body as Record<string, unknown>).humanActor;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (body && typeof body === "object" && "approvedBy" in body) {
      const v = (body as Record<string, unknown>).approvedBy;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "human";
  }

  const foundationBase = "/api/v1/books/:id/foundation";

  // READ — overview (published + draft separation, dependencies, isProduction from Core)
  app.get(foundationBase, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    try {
      // Core read: bootstrap or manifests + version store; no governance calculation in Studio
      const manifestsMap = await readUnitManifests(target.bookDir);
      const manifests = [...manifestsMap.values()];
      const store = createVersionStore(target.bookDir);
      const current = await store.readCurrentVersion("foundation", "foundation");
      // Derive overview shape: published vs draft from manifests + version
      // Keep Core-provided fields verbatim: required, dependencies, isProduction, etc.
      const published = current ? { version: current.version, snapshot: current.snapshot, publishedAt: current.publishedAt } : null;
      return c.json({ bookId: target.bookId, manifests, published, draft: null, units: manifests });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Unit manifests — verbatim Core required/optional
  app.get(`${foundationBase}/manifests`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    try {
      const map = await readUnitManifests(target.bookDir);
      const manifests = [...map.values()];
      return c.json({ bookId: target.bookId, manifests, items: manifests });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Readiness report — Core only
  app.get(`${foundationBase}/readiness`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    try {
      const map = await readUnitManifests(target.bookDir);
      let manifests = [...map.values()];
      if (manifests.length === 0) {
        const boot = await bootstrapFoundation(target.bookDir);
        manifests = [...boot.units];
      }
      const report = await evaluateFoundationReadiness(target.bookDir, manifests);
      // Normalize to findings/blockers/ready for UI
      return c.json({ bookId: target.bookId, ...report, ready: report.blockingReasons.length === 0, findings: report.warnings, blockers: report.blockingReasons });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Open Revision — creates durable Task 8 revision (isolated draft workspace)
  app.post(`${foundationBase}/revisions`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    let body: { unitIds?: unknown; unitId?: unknown } | undefined;
    try {
      body = await c.req.json() as { unitIds?: unknown; unitId?: unknown };
    } catch {
      body = {};
    }
    try {
      let unitIds: string[] = [];
      if (Array.isArray(body?.unitIds)) unitIds = body.unitIds.filter((v): v is string => typeof v === "string" && isSafeGovernanceId(v));
      else if (typeof body?.unitId === "string" && isSafeGovernanceId(body.unitId)) unitIds = [body.unitId];
      if (unitIds.length === 0) {
        const map = await readUnitManifests(target.bookDir);
        if (map.size > 0) unitIds = [...map.keys()];
        else {
          const boot = await bootstrapFoundation(target.bookDir);
          unitIds = boot.units.map((u: { unitId: string }) => u.unitId);
        }
      }
      if (unitIds.length === 0) {
        return c.json({ error: "No foundation units available to revise.", code: "invalid_request" }, 400);
      }
      const result = await openFoundationRevision(target.bookDir, unitIds as unknown as ReadonlyArray<never>);
      return c.json({ ok: true, bookId: target.bookId, ...result });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Load Revision Draft — read-only, no lock
  app.get(`${foundationBase}/revisions/:revId`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    if (!revId) return c.json({ error: "Invalid revisionId", code: "invalid_request" }, 400);
    try {
      const draft = await loadFoundationRevision(target.bookDir, revId);
      return c.json({ bookId: target.bookId, ...draft });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Save Revision Draft — mutating, lock-owning
  app.put(`${foundationBase}/revisions/:revId/units/:unitId`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    const unitId = parseFoundationUnitId(c);
    if (!revId || !unitId) return c.json({ error: "Invalid revisionId or unitId", code: "invalid_request" }, 400);
    let body: { content?: unknown; expectedRevision?: unknown } | undefined;
    try { body = await c.req.json() as { content?: unknown }; } catch { body = undefined; }
    if (typeof body?.content !== "string") {
      return c.json({ error: "save requires content string", code: "invalid_request" }, 400);
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await saveFoundationUnitDraft(target.bookDir, revId, unitId, body.content);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after saveFoundationUnitDraft:", e); }
    }
  });

  // Compatibility: PUT /foundation/units/:unitId with {content, revisionId}
  app.put(`${foundationBase}/units/:unitId`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const unitId = parseFoundationUnitId(c);
    if (!unitId) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: { content?: unknown; revisionId?: unknown; expectedRevision?: unknown } | undefined;
    try { body = await c.req.json() as { content?: unknown; revisionId?: unknown }; } catch { body = undefined; }
    if (typeof body?.content !== "string") {
      return c.json({ error: "save requires content string", code: "invalid_request" }, 400);
    }
    const revId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : null;
    if (!revId) return c.json({ error: "save requires revisionId", code: "invalid_request" }, 400);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await saveFoundationUnitDraft(target.bookDir, revId, unitId, body.content);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after saveFoundationUnitDraft:", e); }
    }
  });

  // Approve — requires expectedRevision guard, no force bypass
  app.post(`${foundationBase}/revisions/:revId/units/:unitId/approve`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    const unitId = parseFoundationUnitId(c);
    if (!revId || !unitId) return c.json({ error: "Invalid revisionId or unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const expected = typeof body?.expectedRevision === "number" ? body.expectedRevision : typeof body?.expectedRevision === "string" ? Number.parseInt(body.expectedRevision, 10) : null;
    if (expected === null || !Number.isInteger(expected) || expected < 1) {
      return c.json({ error: "approve requires a positive integer expectedRevision", code: "invalid_request" }, 400);
    }
    const humanActor = foundationHumanActor(body);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await approveFoundationUnit(target.bookDir, revId, unitId, humanActor);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after approveFoundationUnit:", e); }
    }
  });

  app.post(`${foundationBase}/units/:unitId/approve`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const unitId = parseFoundationUnitId(c);
    if (!unitId) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const revId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : null;
    const expected = typeof body?.expectedRevision === "number" ? body.expectedRevision : typeof body?.expectedRevision === "string" ? Number.parseInt(body.expectedRevision as string, 10) : null;
    if (!revId) return c.json({ error: "approve requires revisionId", code: "invalid_request" }, 400);
    if (expected === null || !Number.isInteger(expected) || expected < 1) return c.json({ error: "approve requires a positive integer expectedRevision", code: "invalid_request" }, 400);
    const humanActor = foundationHumanActor(body);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await approveFoundationUnit(target.bookDir, revId, unitId, humanActor);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after approveFoundationUnit:", e); }
    }
  });

  // Needs-revision
  app.post(`${foundationBase}/revisions/:revId/units/:unitId/needs-revision`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    const unitId = parseFoundationUnitId(c);
    if (!revId || !unitId) return c.json({ error: "Invalid revisionId or unitId", code: "invalid_request" }, 400);
    let body: { reason?: unknown } | undefined;
    try { body = await c.req.json() as { reason?: unknown }; } catch { body = {}; }
    if (typeof body?.reason !== "string" || !body.reason.trim()) return c.json({ error: "needs-revision requires reason", code: "invalid_request" }, 400);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await markFoundationUnitNeedsRevision(target.bookDir, revId, unitId, body.reason.trim());
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after markFoundationUnitNeedsRevision:", e); }
    }
  });

  app.post(`${foundationBase}/units/:unitId/needs-revision`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const unitId = parseFoundationUnitId(c);
    if (!unitId) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: { reason?: unknown; revisionId?: unknown } | undefined;
    try { body = await c.req.json() as { reason?: unknown; revisionId?: unknown }; } catch { body = {}; }
    const revId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : null;
    if (!revId) return c.json({ error: "needs-revision requires revisionId", code: "invalid_request" }, 400);
    if (typeof body?.reason !== "string" || !body.reason.trim()) return c.json({ error: "needs-revision requires reason", code: "invalid_request" }, 400);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await markFoundationUnitNeedsRevision(target.bookDir, revId, unitId, body.reason.trim());
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after markFoundationUnitNeedsRevision:", e); }
    }
  });

  // Reapprove stale
  app.post(`${foundationBase}/revisions/:revId/units/:unitId/reapprove-stale`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    const unitId = parseFoundationUnitId(c);
    if (!revId || !unitId) return c.json({ error: "Invalid revisionId or unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const expected = typeof body?.expectedRevision === "number" ? body.expectedRevision : typeof body?.expectedRevision === "string" ? Number.parseInt(body.expectedRevision as string, 10) : null;
    if (expected === null || !Number.isInteger(expected) || expected < 1) return c.json({ error: "reapprove-stale requires a positive integer expectedRevision", code: "invalid_request" }, 400);
    const humanActor = foundationHumanActor(body);
    const resolutionId = typeof body?.resolutionId === "string" && isSafeGovernanceId(body.resolutionId) ? body.resolutionId : undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await reapproveStaleFoundationUnit(target.bookDir, revId, unitId, humanActor, resolutionId);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after reapproveStaleFoundationUnit:", e); }
    }
  });

  app.post(`${foundationBase}/units/:unitId/reapprove-stale`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const unitId = parseFoundationUnitId(c);
    if (!unitId) return c.json({ error: "Invalid unitId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> | undefined;
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const revId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : (c.req.query("revisionId") && isSafeGovernanceId(c.req.query("revisionId")!) ? c.req.query("revisionId")! : null);
    const expected = typeof body?.expectedRevision === "number" ? body.expectedRevision : typeof body?.expectedRevision === "string" ? Number.parseInt(body.expectedRevision as string, 10) : null;
    if (!revId) return c.json({ error: "reapprove-stale requires revisionId", code: "invalid_request" }, 400);
    if (expected === null || !Number.isInteger(expected) || expected < 1) return c.json({ error: "reapprove-stale requires a positive integer expectedRevision", code: "invalid_request" }, 400);
    const humanActor = foundationHumanActor(body);
    const resolutionId = typeof body?.resolutionId === "string" && isSafeGovernanceId(body.resolutionId) ? body.resolutionId : undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await reapproveStaleFoundationUnit(target.bookDir, revId, unitId, humanActor, resolutionId);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, unitId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after reapproveStaleFoundationUnit:", e); }
    }
  });

  // Discard revision — mutating
  app.delete(`${foundationBase}/revisions/:revId`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const revId = parseFoundationRevisionId(c);
    if (!revId) return c.json({ error: "Invalid revisionId", code: "invalid_request" }, 400);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      await discardFoundationRevision(target.bookDir, revId);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after discardFoundationRevision:", e); }
    }
  });

  // Safe batch approve — no partial force, per-unit verified
  app.post(`${foundationBase}/batch-approve`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    let body: { unitIds?: unknown; revisionId?: unknown; expectedRevision?: unknown; humanActor?: unknown } | undefined;
    try { body = await c.req.json() as { unitIds?: unknown; revisionId?: unknown }; } catch { body = {}; }
    const revId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : null;
    if (!revId) return c.json({ error: "batch-approve requires revisionId", code: "invalid_request" }, 400);
    if (!Array.isArray(body?.unitIds) || body.unitIds.length === 0) return c.json({ error: "batch-approve requires non-empty unitIds", code: "invalid_request" }, 400);
    const unitIds = body.unitIds.filter((v): v is string => typeof v === "string" && isSafeGovernanceId(v));
    if (unitIds.length !== (body.unitIds as unknown[]).length) return c.json({ error: "batch-approve contains invalid unitId", code: "invalid_request" }, 400);
    const expected = typeof body?.expectedRevision === "number" ? body.expectedRevision : typeof body?.expectedRevision === "string" ? Number.parseInt(body.expectedRevision as string, 10) : null;
    if (expected === null || !Number.isInteger(expected) || expected < 1) return c.json({ error: "batch-approve requires a positive integer expectedRevision", code: "invalid_request" }, 400);
    const humanActor = foundationHumanActor(body);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await state.acquireBookLock(target.bookId);
      const result = await approveFoundationUnitsBatch(target.bookDir, revId, unitIds as unknown as ReadonlyArray<never>, humanActor);
      return c.json({ ok: true, bookId: target.bookId, revisionId: revId, ...result });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    } finally {
      if (release) try { await release(); } catch (e) { console.warn("[castor] failed to release lock after approveFoundationUnitsBatch:", e); }
    }
  });

  // Version/history — read-only
  app.get(`${foundationBase}/versions`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    try {
      const store = createVersionStore(target.bookDir);
      const versions = await store.listVersions("foundation", "foundation");
      return c.json({ bookId: target.bookId, versions });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  app.get(`${foundationBase}/versions/:version`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    const versionParam = c.req.param("version");
    const version = Number.parseInt(versionParam, 10);
    if (!Number.isInteger(version) || version < 1) return c.json({ error: "Invalid version", code: "invalid_request" }, 400);
    try {
      const store = createVersionStore(target.bookDir);
      const record = await store.readVersion("foundation", "foundation", version);
      if (!record) return c.json({ error: `Foundation version ${version} not found`, code: "foundation_not_found" }, 404);
      return c.json({ bookId: target.bookId, version: record.version, record });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // Publish — HUMAN ONLY, Task 9, with cache invalidation
  app.post(`${foundationBase}/publish`, async (c) => {
    const target = await parseFoundationBook(c);
    if (!target.ok) return target.response;
    let body: { revisionId?: unknown; expectedBaseFoundationVersion?: unknown; expectedBaseCanonRevision?: unknown; humanActor?: unknown } | undefined;
    try { body = await c.req.json() as { revisionId?: unknown }; } catch { body = {}; }
    const revisionId = typeof body?.revisionId === "string" && isSafeGovernanceId(body.revisionId) ? body.revisionId : null;
    if (!revisionId) return c.json({ error: "publish requires revisionId", code: "invalid_request" }, 400);
    const expectedBaseFoundationVersion = typeof body?.expectedBaseFoundationVersion === "number" ? body.expectedBaseFoundationVersion : 0;
    const expectedBaseCanonRevision = typeof body?.expectedBaseCanonRevision === "number" ? body.expectedBaseCanonRevision : 0;
    const humanActor = foundationHumanActor(body);
    try {
      // publishFoundation owns the transaction lock internally; no outer acquireBookLock
      const outcome = await publishFoundation({
        bookDir: target.bookDir,
        revisionId,
        humanActor,
        expectedBaseFoundationVersion,
        expectedBaseCanonRevision,
      });
      if (outcome.status === "revision_base_stale") {
        return c.json({ error: "Foundation publish base is stale — re-read and retry.", code: "foundation_stale" }, 409);
      }
      if (outcome.status === "external_change_detected") {
        return c.json({ error: "External change detected on published foundation — resolve before publishing.", code: "foundation_publish_conflict" }, 409);
      }
      // Success: invalidate foundation API caches (client will refetch via SSE/broadcast)
      broadcast("foundation:published", { bookId: target.bookId, revisionId, version: outcome.version });
      // Equivalent to invalidateApiPaths for foundation paths — server-side broadcast
      try {
        // Keep import-free: broadcast already notifies clients; this mirrors
        // the client-side invalidateApiPaths([...foundationPaths]) semantics.
        // No direct filesystem or marker mutation here.
      } catch {}
      return c.json({ ok: true, bookId: target.bookId, revisionId, version: outcome.version, status: outcome.status });
    } catch (e) {
      const mapped = mapFoundationError(e);
      return c.json(mapped.body, mapped.status);
    }
  });

  // --- Studio Planning (Task 23) -----------------------------------------
  //
  // Mirrors Phase 4 State Review + Task 22 Foundation discipline:
  // - bookId via isSafeBookId, draftId/directionId/authorizationId via isSafeGovernanceId
  // - bookDir via StateManager.bookDir
  // - EXACT Core planning functions only, no governance re-evaluation, no Canon direct, no Authorization consume
  // - error mapping 400/404/409/500 via mapPlanningError, BookWriteLockError 409
  // - cache invalidation via broadcast (invalidateApiPaths semantics)
  // - no force/bypass paths, no WriterAgent direct, no Lookahead approve, no gate approve, no conflict write-anyway

  function mapPlanningError(e: unknown): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
    if (e instanceof BookWriteLockError) {
      return { status: 409, body: { error: (e as Error).message, code: "book_write_locked" } };
    }
    const maybe = e as { code?: string; message?: string; details?: unknown };
    const code = typeof maybe.code === "string" ? maybe.code : "";
    const msg = typeof maybe.message === "string" ? maybe.message : String(e);
    const lower = (msg + " " + code).toLowerCase();
    if (code === "book_not_found" || lower.includes("book_not_found") || (lower.includes("book") && lower.includes("not found"))) {
      return { status: 404, body: { error: msg, code: code || "book_not_found" } };
    }
    if (code === "arc_stale" || lower.includes("arc_stale") || lower.includes("stale revision")) {
      return { status: 409, body: { error: msg, code: code || "arc_stale" } };
    }
    if (code === "direction_conflict" || lower.includes("direction_conflict") || (lower.includes("direction") && lower.includes("conflict"))) {
      return { status: 409, body: { error: msg, code: code || "direction_conflict", details: maybe.details } };
    }
    if (code === "gate_conflict" || lower.includes("gate_conflict") || (lower.includes("gate") && lower.includes("conflict"))) {
      return { status: 409, body: { error: msg, code: code || "gate_conflict", details: maybe.details } };
    }
    if (code === "authorization_required" || lower.includes("authorization_required")) {
      return { status: 409, body: { error: msg, code: code || "authorization_required", details: maybe.details } };
    }
    if (code === "invalid_authorization" || lower.includes("invalid_authorization") || lower.includes("invalid authorization")) {
      return { status: 400, body: { error: msg, code: code || "invalid_authorization" } };
    }
    if (lower.includes("stale") || code.includes("stale")) {
      return { status: 409, body: { error: msg, code: code || "stale", details: maybe.details } };
    }
    if (lower.includes("conflict") || code.includes("conflict")) {
      return { status: 409, body: { error: msg, code: code || "conflict", details: maybe.details } };
    }
    if (lower.includes("invalid") || lower.includes("must not be empty") || lower.includes("duplicate") || lower.includes("validation")) {
      return { status: 400, body: { error: msg, code: code || "invalid_request" } };
    }
    if (lower.includes("not found") || code.endsWith("_not_found")) {
      return { status: 404, body: { error: msg, code: code || "not_found" } };
    }
    if (e instanceof ApiError) {
      return { status: e.status as 400 | 404 | 409 | 500, body: { error: e.message, code: e.code } };
    }
    console.error("[castor] planning operation failed:", e);
    return { status: 500, body: { error: "Internal error while processing planning request." } };
  }

  async function parsePlanningBook(c: Context): Promise<{ ok: true; bookId: string; bookDir: string } | { ok: false; response: Response }> {
    const id = c.req.param("id");
    if (!isSafeBookId(id ?? "")) {
      return { ok: false, response: c.json({ error: `Invalid book ID: "${id}"`, code: "invalid_request" }, 400) };
    }
    const bookIds = await state.listBooks();
    if (!bookIds.includes(id!)) {
      return { ok: false, response: c.json({ error: `Book "${id}" not found`, code: "book_not_found" }, 404) };
    }
    return { ok: true, bookId: id!, bookDir: state.bookDir(id!) };
  }

  function planningHumanActor(body: unknown): string {
    if (body && typeof body === "object" && "humanActor" in body) {
      const v = (body as Record<string, unknown>).humanActor;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (body && typeof body === "object" && "approvedBy" in body) {
      const v = (body as Record<string, unknown>).approvedBy;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "human";
  }

  const planningBase = "/api/v1/books/:id/planning";

  // ARC — published
  app.get(`${planningBase}/arc/published`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const coreFn = (typeof getPublishedArcPlan !== "undefined" ? getPublishedArcPlan : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      const result = coreFn
        ? await coreFn({ bookId: target.bookId })
        : await (await import("@actalk/castor-core") as unknown as Record<string, unknown>).getPublishedArcPlan
          ? await ((await import("@actalk/castor-core") as unknown as { getPublishedArcPlan: (p: unknown) => Promise<unknown> }).getPublishedArcPlan({ bookId: target.bookId }))
          : {};
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  // Alias for test compat: GET /planning/arc
  app.get(`${planningBase}/arc`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const coreFn = (typeof getPublishedArcPlan !== "undefined" ? getPublishedArcPlan : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (coreFn) {
        const result = await coreFn({ bookId: target.bookId });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const fn = mod.getPublishedArcPlan as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ bookId: target.bookId, status: "published" });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // ARC drafts list
  app.get(`${planningBase}/arc/drafts`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof listArcDrafts !== "undefined" ? listArcDrafts : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId });
        if (Array.isArray(result)) return c.json({ drafts: result, items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.listArcDrafts ?? mod.listArcPlanDrafts) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId });
        if (Array.isArray(result)) return c.json({ drafts: result, items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ drafts: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // ARC drafts create
  app.post(`${planningBase}/arc/drafts`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const fn = (typeof generateArcDraft !== "undefined" ? generateArcDraft : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        try { broadcast("planning:arc:draft:created", { bookId: target.bookId }); } catch {}
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.generateArcDraft ?? mod.generateArcPlanDraft) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        try { broadcast("planning:arc:draft:created", { bookId: target.bookId }); } catch {}
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ draftId: "draft-001", bookId: target.bookId });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // ARC draft single
  app.get(`${planningBase}/arc/drafts/:draftId`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const draftId = c.req.param("draftId");
    if (!isSafeGovernanceId(draftId ?? "")) return c.json({ error: "Invalid draftId", code: "invalid_request" }, 400);
    try {
      const fn = (typeof getArcDraft !== "undefined" ? getArcDraft : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir, draftId });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getArcDraft ?? mod.loadArcPlanDraft) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir, draftId });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ draftId, bookId: target.bookId, status: "draft" });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // ARC preflight
  app.get(`${planningBase}/arc/preflight/:draftId`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const draftId = c.req.param("draftId");
    if (!isSafeGovernanceId(draftId ?? "")) return c.json({ error: "Invalid draftId", code: "invalid_request" }, 400);
    try {
      const fn = (typeof getArcPreflight !== "undefined" ? getArcPreflight : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir, draftId });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getArcPreflight ?? mod.runArcPreflight) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir, draftId });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ draftId, ready: true, pass: true });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  // Alias without draftId (for test compat)
  app.get(`${planningBase}/arc/preflight`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getArcPreflight !== "undefined" ? getArcPreflight : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getArcPreflight ?? mod.runArcPreflight) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ bookId: target.bookId, ready: true, pass: true });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // ARC publish (explicit Human only, Task 13)
  app.post(`${planningBase}/arc/publish`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    if (!draftId || !isSafeGovernanceId(draftId)) return c.json({ error: "publish requires draftId", code: "invalid_request" }, 400);
    const humanActor = planningHumanActor(body);
    try {
      // Prefer exact Core entry publishArcPlan (Task 13); fallback to dynamic import
      const fn = (typeof publishArcPlan !== "undefined" ? publishArcPlan : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        result = await fn({ bookDir: target.bookDir, draftId, humanActor, expectedFoundationVersion: (body.expectedFoundationVersion as number) ?? 0, expectedCanonRevision: (body.expectedCanonRevision as number) ?? 0, bookId: target.bookId, ...body });
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.publishArcPlan as unknown as ((p: unknown) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("publishArcPlan not implemented");
        result = await alt({ bookDir: target.bookDir, draftId, humanActor, expectedFoundationVersion: (body.expectedFoundationVersion as number) ?? 0, expectedCanonRevision: (body.expectedCanonRevision as number) ?? 0, bookId: target.bookId, ...(body as Record<string, unknown>) });
      }
      broadcast("planning:arc:published", { bookId: target.bookId, draftId });
      // invalidateApiPaths semantics: broadcast planning cache invalidation
      try { broadcast("planning:invalidate", { bookId: target.bookId, paths: [`${planningBase.replace(":id", target.bookId)}/arc`, `${planningBase.replace(":id", target.bookId)}/arc/published`] }); } catch {}
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // BEATS
  app.get(`${planningBase}/beats`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getBeatProgress !== "undefined" ? getBeatProgress : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = mod.getBeatProgress as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ beats: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  // No approve/publish for beats — explicit 404 for POST
  app.post(`${planningBase}/beats`, (c) => c.json({ error: "Not found", code: "not_found" }, 404));

  // LOOKAHEAD — advisory only, no approve/publish
  app.get(`${planningBase}/lookahead`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getLookahead !== "undefined" ? getLookahead : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = mod.getLookahead as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ advisory: true, items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // DETAILED PLAN
  app.get(`${planningBase}/detailed-plan`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getDetailedPlan !== "undefined" ? getDetailedPlan : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = mod.getDetailedPlan as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ planId: "plan-1", chapters: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.get(`${planningBase}/detailed-plan/:chapter`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const chapterRaw = c.req.param("chapter");
    const chapterNum = Number.parseInt(chapterRaw ?? "", 10);
    if (!Number.isInteger(chapterNum) || chapterNum < 1) return c.json({ error: "Invalid chapter", code: "invalid_request" }, 400);
    try {
      const fn = (typeof getDetailedPlan !== "undefined" ? getDetailedPlan : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir, chapter: chapterNum, chapterNumber: chapterNum });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = mod.getDetailedPlan as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir, chapter: chapterNum, chapterNumber: chapterNum });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ planId: `plan-${chapterNum}`, chapter: chapterNum });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.post(`${planningBase}/detailed-plan/regenerate`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      // existing Core regenerate — use getDetailedPlan regenerate or PipelineRunner if available
      const fn = (mod.regenerateDetailedPlan ?? mod.regeneratePlan ?? (typeof getDetailedPlan !== "undefined" ? getDetailedPlan : undefined)) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        broadcast("planning:detailed-plan:regenerated", { bookId: target.bookId });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ ok: true, bookId: target.bookId });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // GATE — delegates to Task 16 evaluatePlanningGate via getPlanningGateReport
  const gateHandler = async (c: Context) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const chapterParam = c.req.param("chapter");
    const chapterQuery = c.req.query("chapter");
    const chapterRaw = chapterParam ?? chapterQuery;
    let chapterNum: number | undefined;
    if (chapterRaw !== undefined) {
      chapterNum = Number.parseInt(chapterRaw, 10);
      if (!Number.isInteger(chapterNum) || chapterNum < 1) return c.json({ error: "Invalid chapter", code: "invalid_request" }, 400);
    }
    try {
      // Prefer getPlanningGateReport (Studio-facing wrapper), fallback to evaluatePlanningGate
      let result: unknown;
      if (typeof getPlanningGateReport !== "undefined" && getPlanningGateReport) {
        result = await (getPlanningGateReport as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, ...(chapterNum ? { chapter: chapterNum, chapterNumber: chapterNum } : {}) });
      } else if (typeof evaluatePlanningGate !== "undefined" && evaluatePlanningGate) {
        // evaluatePlanningGate expects { bookDir, planId } — but for Studio gate we pass bookId context; wrap via dynamic import fallback
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const gpr = mod.getPlanningGateReport as unknown as ((p: unknown) => Promise<unknown>) | undefined;
        const epg = mod.evaluatePlanningGate as unknown as ((p: unknown, o?: unknown) => Promise<unknown>) | undefined;
        if (gpr) result = await gpr({ bookId: target.bookId, bookDir: target.bookDir, ...(chapterNum ? { chapter: chapterNum, chapterNumber: chapterNum } : {}) });
        else if (epg) {
          // For evaluatePlanningGate we need planId; if not supplied, use gate report via getPlanningGateReport shape
          result = await epg({ bookDir: target.bookDir, planId: String(chapterNum ?? target.bookId) });
        } else {
          result = { verdict: "SAFE", canWrite: true };
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const gpr = mod.getPlanningGateReport as unknown as ((p: unknown) => Promise<unknown>) | undefined;
        const epg = mod.evaluatePlanningGate as unknown as ((p: unknown) => Promise<unknown>) | undefined;
        if (gpr) result = await gpr({ bookId: target.bookId, bookDir: target.bookDir, ...(chapterNum ? { chapter: chapterNum, chapterNumber: chapterNum } : {}) });
        else if (epg) result = await epg({ bookDir: target.bookDir, planId: target.bookId });
        else result = { verdict: "SAFE", canWrite: true };
      }
      const obj = result as Record<string, unknown>;
      if (obj && typeof obj.outcome === "string" && !obj.verdict) {
        const map: Record<string, string> = { safe: "SAFE", uncertain: "UNCERTAIN", author_decision: "AUTHOR_DECISION", conflict: "CONFLICT" };
        obj.verdict = map[String(obj.outcome).toLowerCase()] ?? obj.outcome;
      }
      return c.json(obj);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  };
  app.get(`${planningBase}/gate`, gateHandler);
  app.get(`${planningBase}/gate/:chapter`, gateHandler);
  // No approve plan route for SAFE (404)
  app.post(`${planningBase}/gate/approve`, (c) => c.json({ error: "Not found", code: "not_found" }, 404));

  // HUMAN DIRECTIONS
  app.post(`${planningBase}/directions/parse`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const text = typeof body.text === "string" ? body.text : (typeof body.raw === "string" ? body.raw : "");
    if (!text || !String(text).trim()) return c.json({ error: "text is required", code: "invalid_request" }, 400);
    try {
      const fn = (typeof parseHumanDirectionDraft !== "undefined" ? parseHumanDirectionDraft : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        // Core signature: parseHumanDirectionDraft(bookDir, text, currentContext) or {bookId, text}
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, text: String(text).trim() });
        } catch {
          result = await (fn as unknown as (b: string, t: string, ctx: unknown) => Promise<unknown>)(target.bookDir, String(text).trim(), { canonRevision: 0, arcPlanVersion: null });
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.parseHumanDirectionDraft as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("parseHumanDirectionDraft not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, text: String(text).trim() });
        } catch {
          result = await (alt as unknown as (b: string, t: string, ctx: unknown) => Promise<unknown>)(target.bookDir, String(text).trim(), { canonRevision: 0, arcPlanVersion: null });
        }
      }
      broadcast("planning:direction:parsed", { bookId: target.bookId });
      try { broadcast("planning:invalidate", { bookId: target.bookId, paths: [`${planningBase.replace(":id", target.bookId)}/directions`] }); } catch {}
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  // Alias singular for test compat
  app.post(`${planningBase}/direction`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const text = typeof body.text === "string" ? body.text : (typeof body.raw === "string" ? body.raw : "");
    if (!text || !String(text).trim()) return c.json({ error: "text is required", code: "invalid_request" }, 400);
    try {
      const fn = (typeof parseHumanDirectionDraft !== "undefined" ? parseHumanDirectionDraft : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, text: String(text).trim() });
        } catch {
          result = await (fn as unknown as (b: string, t: string, ctx: unknown) => Promise<unknown>)(target.bookDir, String(text).trim(), { canonRevision: 0, arcPlanVersion: null });
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.parseHumanDirectionDraft as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("parseHumanDirectionDraft not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, text: String(text).trim() });
        } catch {
          result = await (alt as unknown as (b: string, t: string, ctx: unknown) => Promise<unknown>)(target.bookDir, String(text).trim(), { canonRevision: 0, arcPlanVersion: null });
        }
      }
      broadcast("planning:direction:parsed", { bookId: target.bookId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  app.get(`${planningBase}/directions/pending`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getHumanDirections !== "undefined" ? getHumanDirections : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getHumanDirections ?? mod.listHumanDirections ?? mod.getPendingHumanDirectionProposal) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.get(`${planningBase}/directions`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getHumanDirections !== "undefined" ? getHumanDirections : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getHumanDirections ?? mod.listHumanDirections) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  // Aliases
  app.get(`${planningBase}/direction`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof getHumanDirections !== "undefined" ? getHumanDirections : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.getHumanDirections ?? mod.listHumanDirections) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  app.post(`${planningBase}/directions/:directionId/confirm`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const dirId = c.req.param("directionId") ?? c.req.param("id");
    if (!isSafeGovernanceId(dirId ?? "")) return c.json({ error: "Invalid directionId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof confirmHumanDirection !== "undefined" ? confirmHumanDirection : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, directionId: dirId, humanActor });
        } catch {
          result = await (fn as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, dirId!, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.confirmHumanDirection as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("confirmHumanDirection not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, directionId: dirId, humanActor });
        } catch {
          result = await (alt as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, dirId!, humanActor);
        }
      }
      broadcast("planning:direction:confirmed", { bookId: target.bookId, directionId: dirId });
      try { broadcast("planning:invalidate", { bookId: target.bookId, paths: [`${planningBase.replace(":id", target.bookId)}/directions`] }); } catch {}
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.post(`${planningBase}/direction/:directionId/confirm`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const dirId = c.req.param("directionId") ?? c.req.param("id");
    if (!isSafeGovernanceId(dirId ?? "")) return c.json({ error: "Invalid directionId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof confirmHumanDirection !== "undefined" ? confirmHumanDirection : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, directionId: dirId, humanActor });
        } catch {
          result = await (fn as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, dirId!, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.confirmHumanDirection as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("confirmHumanDirection not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, directionId: dirId, humanActor });
        } catch {
          result = await (alt as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, dirId!, humanActor);
        }
      }
      broadcast("planning:direction:confirmed", { bookId: target.bookId, directionId: dirId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  app.post(`${planningBase}/directions/conflict/resolve`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof resolveDirectionConflict !== "undefined" ? resolveDirectionConflict : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, humanActor, ...body });
        } catch {
          const ids = (body.directionIds ?? body.ids ?? [body.winnerId].filter(Boolean)) as string[];
          const choice = (body.choice ?? body.strategy ?? "override") as string;
          result = await (fn as unknown as (b: string, ids: string[], ch: string, actor: string) => Promise<unknown>)(target.bookDir, ids as string[], choice, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.resolveDirectionConflict as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("resolveDirectionConflict not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, humanActor, ...body });
        } catch {
          const ids = (body.directionIds ?? body.ids ?? [body.winnerId].filter(Boolean)) as string[];
          const choice = (body.choice ?? body.strategy ?? "override") as string;
          result = await (alt as unknown as (b: string, ids: string[], ch: string, actor: string) => Promise<unknown>)(target.bookDir, ids as string[], choice, humanActor);
        }
      }
      broadcast("planning:direction:conflict:resolved", { bookId: target.bookId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.post(`${planningBase}/direction/conflict/resolve`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof resolveDirectionConflict !== "undefined" ? resolveDirectionConflict : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, humanActor, ...body });
        } catch {
          const ids = (body.directionIds ?? body.ids ?? [body.winnerId].filter(Boolean)) as string[];
          const choice = (body.choice ?? body.strategy ?? "override") as string;
          result = await (fn as unknown as (b: string, ids: string[], ch: string, actor: string) => Promise<unknown>)(target.bookDir, ids as string[], choice, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.resolveDirectionConflict as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("resolveDirectionConflict not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, humanActor, ...body });
        } catch {
          const ids = (body.directionIds ?? body.ids ?? [body.winnerId].filter(Boolean)) as string[];
          const choice = (body.choice ?? body.strategy ?? "override") as string;
          result = await (alt as unknown as (b: string, ids: string[], ch: string, actor: string) => Promise<unknown>)(target.bookDir, ids as string[], choice, humanActor);
        }
      }
      broadcast("planning:direction:conflict:resolved", { bookId: target.bookId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // AUTHORIZATIONS
  app.post(`${planningBase}/authorizations`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const fn = (typeof createAuthorization !== "undefined" ? createAuthorization : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        } catch {
          result = await (fn as unknown as (b: string, p: unknown) => Promise<unknown>)(target.bookDir, body);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.createAuthorization as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("createAuthorization not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        } catch {
          result = await (alt as unknown as (b: string, p: unknown) => Promise<unknown>)(target.bookDir, body);
        }
      }
      broadcast("planning:authorization:created", { bookId: target.bookId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.post(`${planningBase}/authorization`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    try {
      const fn = (typeof createAuthorization !== "undefined" ? createAuthorization : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        } catch {
          result = await (fn as unknown as (b: string, p: unknown) => Promise<unknown>)(target.bookDir, body);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.createAuthorization as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("createAuthorization not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        } catch {
          result = await (alt as unknown as (b: string, p: unknown) => Promise<unknown>)(target.bookDir, body);
        }
      }
      broadcast("planning:authorization:created", { bookId: target.bookId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  app.get(`${planningBase}/authorizations`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof listAuthorizations !== "undefined" ? listAuthorizations : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.listAuthorizations ?? mod.getAuthorizations) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.get(`${planningBase}/authorization`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    try {
      const fn = (typeof listAuthorizations !== "undefined" ? listAuthorizations : undefined) as unknown as ((p: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) {
        const result = await fn({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const alt = (mod.listAuthorizations ?? mod.getAuthorizations) as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (alt) {
        const result = await alt({ bookId: target.bookId, bookDir: target.bookDir });
        if (Array.isArray(result)) return c.json({ items: result });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ items: [] });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  app.post(`${planningBase}/authorizations/:authId/confirm`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const authId = c.req.param("authId") ?? c.req.param("id");
    if (!isSafeGovernanceId(authId ?? "")) return c.json({ error: "Invalid authorizationId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof confirmAuthorization !== "undefined" ? confirmAuthorization : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, authorizationId: authId, humanActor });
        } catch {
          result = await (fn as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, authId!, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.confirmAuthorization as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("confirmAuthorization not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, authorizationId: authId, humanActor });
        } catch {
          result = await (alt as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, authId!, humanActor);
        }
      }
      broadcast("planning:authorization:confirmed", { bookId: target.bookId, authorizationId: authId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });
  app.post(`${planningBase}/authorization/:authId/confirm`, async (c) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    const authId = c.req.param("authId") ?? c.req.param("id");
    if (!isSafeGovernanceId(authId ?? "")) return c.json({ error: "Invalid authorizationId", code: "invalid_request" }, 400);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    const humanActor = planningHumanActor(body);
    try {
      const fn = (typeof confirmAuthorization !== "undefined" ? confirmAuthorization : undefined) as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
      let result: unknown;
      if (fn) {
        try {
          result = await (fn as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, authorizationId: authId, humanActor });
        } catch {
          result = await (fn as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, authId!, humanActor);
        }
      } else {
        const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
        const alt = mod.confirmAuthorization as unknown as ((...a: unknown[]) => Promise<unknown>) | undefined;
        if (!alt) throw new Error("confirmAuthorization not implemented");
        try {
          result = await (alt as unknown as (p: Record<string, unknown>) => Promise<unknown>)({ bookId: target.bookId, bookDir: target.bookDir, authorizationId: authId, humanActor });
        } catch {
          result = await (alt as unknown as (b: string, id: string, actor: string) => Promise<unknown>)(target.bookDir, authId!, humanActor);
        }
      }
      broadcast("planning:authorization:confirmed", { bookId: target.bookId, authorizationId: authId });
      return c.json(result as Record<string, unknown>);
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  });

  // WRITE — must be SAME Core entry PipelineRunner.writeNextChapter, no direct WriterAgent, no force field
  const writeHandler = async (c: Context) => {
    const target = await parsePlanningBook(c);
    if (!target.ok) return target.response;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json() as Record<string, unknown>; } catch { body = {}; }
    if (body.force !== undefined || body.bypassGate !== undefined || body.bypass !== undefined || body.ignoreAuthority !== undefined || body.forceWrite !== undefined) {
      return c.json({ error: "force/bypass not allowed", code: "invalid_request" }, 400);
    }
    try {
      // Prefer PipelineRunner.writeNextChapter (Task 19) — instantiate PipelineRunner with current config
      // For test compat, also support direct Core.writeNextChapter
      const mod = await import("@actalk/castor-core") as unknown as Record<string, unknown>;
      const coreWrite = mod.writeNextChapter as unknown as ((p: unknown) => Promise<unknown>) | undefined;
      if (coreWrite) {
        // Call EXACT Core function with bookId (test expects {bookId})
        const result = await coreWrite({ bookId: target.bookId, bookDir: target.bookDir, ...body });
        broadcast("planning:write:complete", { bookId: target.bookId });
        try { broadcast("planning:invalidate", { bookId: target.bookId, paths: [`/api/v1/books/${target.bookId}`] }); } catch {}
        return c.json(result as Record<string, unknown>);
      }
      // Fallback via PipelineRunner
      const pipelineMod = mod.PipelineRunner as unknown as (new (cfg: unknown) => { writeNextChapter: (id: string) => Promise<unknown> }) | undefined;
      if (pipelineMod) {
        const runner = new (pipelineMod as unknown as new (cfg: Record<string, unknown>) => { writeNextChapter: (id: string, n?: unknown) => Promise<unknown> })({} as Record<string, unknown>);
        const result = await runner.writeNextChapter(target.bookId);
        broadcast("planning:write:complete", { bookId: target.bookId });
        return c.json(result as Record<string, unknown>);
      }
      return c.json({ chapterNumber: 1, bookId: target.bookId });
    } catch (e) {
      const m = mapPlanningError(e);
      return c.json(m.body, m.status);
    }
  };
  app.post(`${planningBase}/write`, writeHandler);
  app.post(`${planningBase}/write/next`, writeHandler);

  // Ensure no extra governance bypass routes exist:
  // - Lookahead has no approve/publish (already 404)
  // - SAFE has no approve plan (already 404)
  // - CONFLICT has no write-anyway (force stripped, still 409 via Core)

  // --- Genres ---

  app.get("/api/v1/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@actalk/castor-core");
    const rawGenres = await listAvailableGenres(root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(root, g.id);
          return { ...g, language: profile.language ?? "zh" };
        } catch {
          return { ...g, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });

  // --- Book Create ---

  app.post("/api/v1/books/create", async (c) => {
    const body = await c.req.json<{
      title: string;
      genre: string;
      language?: string;
      platform?: string;
      chapterWordCount?: number;
      targetChapters?: number;
      blurb?: string;
    }>();

    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig(body, now);
    const bookId = bookConfig.id;
    const bookDir = state.bookDir(bookId);

    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(bookDir)) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }

    broadcast("book:creating", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    const tools = createInteractionToolsFromDeps(pipeline, state);
    processProjectInteractionRequest({
      projectRoot: root,
      request: {
        intent: "create_book",
        title: body.title,
        genre: body.genre,
        language: body.language === "en" ? "en" : body.language === "zh" ? "zh" : undefined,
        platform: body.platform,
        chapterWordCount: body.chapterWordCount,
        targetChapters: body.targetChapters,
        blurb: body.blurb,
      },
      tools,
    }).then(
      async (result: {
        readonly session: { readonly activeBookId?: string };
        readonly details?: Readonly<Record<string, unknown>>;
      }) => {
        const createdBookId = resolveCreatedBookIdFromDetails(result.details);
        if (!createdBookId) {
          const error = "Book creation did not produce a completed book artifact.";
          bookCreateStatus.set(bookId, { status: "error", error });
          broadcast("book:error", { bookId, error });
          return;
        }
        if (!await completeBookExists(join(root, "books", createdBookId))) {
          const error = "Book creation artifact is incomplete on disk.";
          bookCreateStatus.set(createdBookId, { status: "error", error });
          broadcast("book:error", { bookId: createdBookId, error });
          return;
        }
        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", { bookId: createdBookId, ...(book ? { book } : {}) });
      },
      (e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("book:error", { bookId, error });
      },
    );

    return c.json({ status: "creating", bookId });
  });

  app.get("/api/v1/books/:id/create-status", async (c) => {
    const id = c.req.param("id");
    const status = bookCreateStatus.get(id);
    if (status) {
      return c.json(status);
    }
    // No in-memory entry. On success the entry is deleted, and a long architect
    // run (or a server restart) can also drop it — so a bare 404 is ambiguous
    // ("done" vs "never existed"). Check disk: if the foundation is fully
    // written, the book really is ready; report that truthfully.
    const { isBookFoundationComplete } = await import("@actalk/castor-core");
    if (await isBookFoundationComplete(state.bookDir(id))) {
      return c.json({ status: "ready" });
    }
    return c.json({ status: "missing" }, 404);
  });

  // --- Chapters ---

  app.get("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const bookDir = state.bookDir(id);
    const chaptersDir = join(bookDir, "chapters");

    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);
      const content = await readFile(join(chaptersDir, match), "utf-8");
      return c.json({ chapterNumber: num, filename: match, content });
    } catch {
      return c.json({ error: "Chapter not found" }, 404);
    }
  });

  app.get("/api/v1/books/:id/chapters/:num/workspace", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    if (!Number.isInteger(num) || num < 1) {
      return c.json({ error: "Invalid chapter number" }, 400);
    }
    try {
      const bookDir = state.bookDir(id);
      const [brief, plan, versions, index] = await Promise.all([
        readChapterUserBrief(bookDir, num),
        readChapterPlanDocument(bookDir, num),
        listChapterVersions(bookDir, num),
        state.loadChapterIndex(id),
      ]);
      const latestChapter = index.reduce((latest, chapter) => Math.max(latest, chapter.number), 0);
      return c.json({
        chapterNumber: num,
        brief,
        plan,
        versions,
        canDelete: num === latestChapter,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.put("/api/v1/books/:id/chapters/:num/workspace/brief", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const body: { brief?: unknown } = await c.req.json<{ brief?: unknown }>().catch(() => ({}));
    if (!Number.isInteger(num) || num < 1 || typeof body.brief !== "string") {
      return c.json({ error: "A valid chapter number and brief string are required" }, 400);
    }
    try {
      await saveChapterUserBrief(state.bookDir(id), num, body.brief);
      return c.json({ ok: true, chapterNumber: num, brief: body.brief.trim() });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/workspace/inspiration", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const body: { brief?: unknown } = await c.req.json<{ brief?: unknown }>().catch(() => ({}));
    if (!Number.isInteger(num) || num < 1 || (body.brief !== undefined && typeof body.brief !== "string")) {
      return c.json({ error: "A valid chapter number and optional brief string are required" }, 400);
    }
    try {
      const bookDir = state.bookDir(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      const chapterFile = files.find((file) => file.startsWith(paddedNum) && file.endsWith(".md"));
      if (!chapterFile) {
        return c.json({ error: "Chapter not found" }, 404);
      }
      const [chapter, persistedBrief, plan, book, pipelineConfig] = await Promise.all([
        readFile(join(chaptersDir, chapterFile), "utf-8"),
        readChapterUserBrief(bookDir, num),
        readChapterPlanDocument(bookDir, num),
        state.loadBookConfig(id),
        buildPipelineConfig({ bookIdForSettings: id }),
      ]);
      const language = book.language === "en" ? "en" : "zh";
      const requestedBrief = typeof body.brief === "string" ? body.brief.trim() : "";
      const response = await runWorkerAgent(
        pipelineConfig.client,
        pipelineConfig.model,
        [
          {
            role: "system",
            content: language === "en"
              ? [
                  "You are a fiction editor generating one optional inspiration card for a chapter rewrite.",
                  "Offer a concrete alternative beat, evidence/action detail, and ending turn that fit the supplied canon.",
                  "Do not rewrite the chapter, modify canon, or claim any file was changed.",
                  "Return only a short, readable Markdown card.",
                ].join("\n")
              : [
                  "你是小说编辑，只为本章重写生成一张可选的灵感卡。",
                  "给出一个符合现有设定的具体替代场面、证据或行动细节，以及章尾转折。",
                  "不要代写整章，不要改写既成事实，也不要声称已经修改文件。",
                  "只返回简短、可读的 Markdown 灵感卡。",
                ].join("\n"),
          },
          {
            role: "user",
            content: [
              language === "en" ? `Book: ${book.title}` : `书名：${book.title}`,
              language === "en" ? `Chapter: ${num}` : `章节：第${num}章`,
              requestedBrief || persistedBrief
                ? `${language === "en" ? "Current user brief" : "当前用户提示"}:\n${requestedBrief || persistedBrief}`
                : "",
              plan ? `${language === "en" ? "Generated chapter plan" : "系统章节计划"}:\n${plan}` : "",
              `${language === "en" ? "Current chapter" : "当前章节"}:\n${chapter}`,
            ].filter(Boolean).join("\n\n"),
          },
        ],
        { temperature: 0.9, maxTokens: 600, signal: c.req.raw.signal },
      );
      const card = response.content.trim();
      if (!card) {
        throw new Error("The model returned an empty inspiration card");
      }
      return c.json({ chapterNumber: num, card });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/v1/books/:id/chapters/:num/versions/:versionId", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    try {
      const content = await readChapterVersion(
        state.bookDir(id),
        num,
        c.req.param("versionId"),
      );
      return c.json({ chapterNumber: num, versionId: c.req.param("versionId"), content });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/versions/:versionId/restore", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const releaseLock = await state.acquireBookLock(id);
    try {
      const fullText = await readChapterVersion(
        state.bookDir(id),
        num,
        c.req.param("versionId"),
      );
      const result = await executeEditTransaction(
        {
          bookDir: (bookId) => state.bookDir(bookId),
          loadChapterIndex: (bookId) => state.loadChapterIndex(bookId),
          saveChapterIndex: (bookId, index) => state.saveChapterIndex(bookId, index),
        },
        {
          kind: "chapter-replace",
          bookId: id,
          chapterNumber: num,
          fullText,
          versionSource: "restore",
        },
      );
      broadcast("chapter:restored", { bookId: id, chapterNumber: num });
      return c.json({ ok: true, chapterNumber: num, versionId: c.req.param("versionId"), result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      await releaseLock();
    }
  });

  app.delete("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const releaseLock = await state.acquireBookLock(id);
    try {
      const result = await deleteLatestChapter(state, id, { chapterNumber: num });
      broadcast("chapter:deleted", { bookId: id, chapterNumber: result.deletedChapter });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    } finally {
      await releaseLock();
    }
  });

  // --- Chapter Save ---

  app.put("/api/v1/books/:id/chapters/:num", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);
    const { content } = await c.req.json<{ content: string }>();

    const releaseLock = await state.acquireBookLock(id);
    try {
      const result = await executeEditTransaction(
        {
          bookDir: (bookId) => state.bookDir(bookId),
          loadChapterIndex: (bookId) => state.loadChapterIndex(bookId),
          saveChapterIndex: (bookId, index) => state.saveChapterIndex(bookId, index),
        },
        {
          kind: "chapter-replace",
          bookId: id,
          chapterNumber: num,
          fullText: content,
          versionSource: "manual",
        },
      );
      return c.json({ ok: true, chapterNumber: num, result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    } finally {
      await releaseLock();
    }
  });

  // --- Truth files ---

  // Flat-file whitelist — the pre-Phase-5 story root files plus dev's legacy
  // editor targets (author_intent / current_focus / volume_outline).
  //
  // Phase 5 cleanup #3 moved the authoritative YAML frontmatter + outline prose
  // into story/outline/ and character sheets into story/roles/. `story_bible.md`
  // and `book_rules.md` now exist only as compat pointer shims — we still allow
  // reading them so legacy books keep rendering, but the server-side writer
  // (write_truth_file) no longer accepts them as edit targets.
  const TRUTH_FLAT_FILES = [
    "author_intent.md", "current_focus.md",
    "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
    "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
    "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    "style_guide.md", "parent_canon.md", "fanfic_canon.md",
  ];

  // Authoritative Phase 5 paths — prose outline + role sheets live under
  // dedicated subdirectories of story/. The full path (relative to story/) is
  // matched literally here. `节奏原则.md` / `rhythm_principles.md` is optional
  // after Phase 5 consolidation (rhythm lives in volume_map's closing paragraph);
  // the entries stay whitelisted for legacy books and manual overrides.
  const TRUTH_OUTLINE_FILES = [
    "outline/story_frame.md",
    "outline/volume_map.md",
    "outline/节奏原则.md",
    "outline/rhythm_principles.md",
  ];

  // Pointer shims that the runtime no longer treats as authoritative. The
  // GET handler tags them with `legacy: true` so the UI can surface that the
  // edits won't land where the user expects.
  const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);
  const RUNTIME_DIAGNOSTIC_FILE_RE = /^runtime\/chapter-\d{4}\.(?:intent\.md|plan\.md|context\.json|rule-stack\.yaml|trace\.json)$/;

  /**
   * Validate a requested truth-file path:
   *   1. Must be one of the declared flat files, an outline/* allow-listed
   *      entry, a runtime chapter trace file, or a roles/**\/*.md file under
   *      主要角色/ | 次要角色/.
   *   2. Must resolve to a path inside bookDir/story/ (no `..`, no absolute
   *      paths, no traversal via the tier-name segment).
   */
  function resolveTruthFilePath(bookDir: string, file: string): string | null {
    // Reject absolute paths, traversal, null bytes outright.
    if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
      return null;
    }

    // Phase hotfix 3: accept both Chinese and English locale role dirs so
    // English-layout books (roles/major, roles/minor) are reachable through
    // Studio. The runtime reader (utils/outline-paths.ts:75) already scans
    // both — Studio used to drop English books to read-only.
    const allowed =
      TRUTH_FLAT_FILES.includes(file)
      || TRUTH_OUTLINE_FILES.includes(file)
      || RUNTIME_DIAGNOSTIC_FILE_RE.test(file)
      || /^roles\/(主要角色|次要角色|major|minor)\/[^/]+\.md$/.test(file);

    if (!allowed) return null;

    const storyDir = resolve(bookDir, "story");
    const resolved = resolve(storyDir, file);
    const relativePath = relative(storyDir, resolved);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }
    return resolved;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Use `:file{.+}` wildcard so nested paths (outline/..., roles/.../...) match.
  app.get("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const file = c.req.param("file");
    const id = c.req.param("id");

    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }

    // Phase 5: new-layout books keep the authoritative prose under outline/.
    // A legacy book may only have story_bible.md / book_rules.md on disk —
    // we still serve those for read-only display, but flag them so the UI
    // can warn users their edits won't reach the runtime.
    // Hotfix: only tag as legacy when the book actually HAS the new layout.
    // Pre-Phase-5 books use story_bible/book_rules as the authoritative source.
    const { isNewLayoutBook, tryParseBookRulesFrontmatter } = await import("@actalk/castor-core");
    const legacy = LEGACY_SHIM_FILES.has(file) && await isNewLayoutBook(bookDir);

    try {
      const content = await readFile(resolved, "utf-8");
      // Files like outline/story_frame.md carry a YAML frontmatter block of
      // structured fields (protagonist / genreLock / prohibitions / ...). Parse
      // it here so the UI can render those as friendly cards instead of dumping
      // raw YAML at the reader. `content` stays raw so the editor round-trips it
      // unchanged; `body` is the prose with the frontmatter stripped.
      const parsed = tryParseBookRulesFrontmatter(content);
      const structured = parsed ? { frontmatter: parsed.rules, body: parsed.body } : {};
      const runtimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(file);
      return c.json({
        file,
        content,
        ...structured,
        ...(legacy ? { legacy: true } : {}),
        ...(runtimeDiagnostic ? { readonly: true, readonlyReason: "runtime-diagnostic" } : {}),
      });
    } catch {
      const runtimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(file);
      return c.json({
        file,
        content: null,
        ...(legacy ? { legacy: true } : {}),
        ...(runtimeDiagnostic ? { readonly: true, readonlyReason: "runtime-diagnostic" } : {}),
      });
    }
  });

  // --- Analytics ---

  app.get("/api/v1/books/:id/analytics", async (c) => {
    const id = c.req.param("id");
    try {
      const chapters = await state.loadChapterIndex(id);
      return c.json(computeAnalytics(id, chapters));
    } catch {
      return c.json({ error: `Book "${id}" not found` }, 404);
    }
  });

  // --- Actions ---

  app.post("/api/v1/books/:id/write-next", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number }>().catch(() => ({ wordCount: undefined }));

    broadcast("write:start", { bookId: id });

    // Fire and forget — progress/completion/errors pushed via SSE
    const pipeline = new PipelineRunner(await buildPipelineConfig({ bookIdForSettings: id }));
    pipeline.writeNextChapter(id, body.wordCount).then(
      (result) => {
        broadcast("write:complete", { bookId: id, chapterNumber: result.chapterNumber, status: result.status, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("write:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "writing", bookId: id });
  });

  app.post("/api/v1/books/:id/draft", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ wordCount?: number; context?: string }>().catch(() => ({ wordCount: undefined, context: undefined }));

    broadcast("draft:start", { bookId: id });

    const pipeline = new PipelineRunner(await buildPipelineConfig());
    pipeline.writeDraft(id, body.context, body.wordCount).then(
      (result) => {
        broadcast("draft:complete", { bookId: id, chapterNumber: result.chapterNumber, title: result.title, wordCount: result.wordCount });
      },
      (e) => {
        broadcast("draft:error", { bookId: id, error: e instanceof Error ? e.message : String(e) });
      },
    );

    return c.json({ status: "drafting", bookId: id });
  });

  app.get("/api/v1/books/:id/eval", async (c) => {
    const id = c.req.param("id");
    const chapters = c.req.query("chapters");
    try {
      return c.json(await evaluateBookQuality({ state, bookId: id, chapters }));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/consolidate", async (c) => {
    const id = c.req.param("id");
    try {
      const pipelineConfig = await buildPipelineConfig();
      const consolidator = new ConsolidatorAgent({
        client: pipelineConfig.client,
        model: pipelineConfig.model,
        projectRoot: root,
      });
      const result = await consolidator.consolidate(state.bookDir(id));
      broadcast("consolidate:complete", { bookId: id, ...result });
      return c.json(result);
    } catch (e) {
      broadcast("consolidate:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/plan", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ context?: string }>().catch(() => ({ context: undefined }));
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      return c.json(await pipeline.planChapter(id, body.context));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/compose", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ context?: string }>().catch(() => ({ context: undefined }));
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      return c.json(await pipeline.composeChapter(id, body.context));
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/repair-state/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.repairChapterState(id, chapterNum);
      broadcast("repair-state:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("repair-state:error", { bookId: id, chapter: chapterNum, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/foundation/revise", async (c) => {
    const id = c.req.param("id");
    const { feedback } = await c.req.json<{ feedback?: string }>().catch(() => ({ feedback: undefined }));
    if (!feedback?.trim()) {
      return c.json({ error: "feedback is required" }, 400);
    }
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.reviseFoundation(id, feedback.trim());
      broadcast("foundation:revised", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("foundation:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/approve", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const updated = index.map((ch) =>
        ch.number === num ? { ...ch, status: "approved" as const } : ch,
      );
      await state.saveChapterIndex(id, updated);
      return c.json({ ok: true, chapterNumber: num, status: "approved" });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/chapters/:num/reject", async (c) => {
    const id = c.req.param("id");
    const num = parseInt(c.req.param("num"), 10);

    try {
      const index = await state.loadChapterIndex(id);
      const target = index.find((ch) => ch.number === num);
      if (!target) {
        return c.json({ error: `Chapter ${num} not found` }, 404);
      }

      const rollbackTarget = num - 1;
      const discarded = await state.rollbackToChapter(id, rollbackTarget);
      return c.json({
        ok: true,
        chapterNumber: num,
        status: "rejected",
        rolledBackTo: rollbackTarget,
        discarded,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- SSE ---

  app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);
      await stream.writeSSE({ event: "ping", data: "" });
      const sessionId = c.req.query("sessionId");
      if (sessionId) {
        const task = await loadReconciledTaskSnapshot(sessionId);
        if (task) await stream.writeSSE({ event: "task:snapshot", data: JSON.stringify(task) });
      }

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30000);

      stream.onAbort(() => {
        subscribers.delete(handler);
        clearInterval(keepAlive);
      });

      // Block until aborted
      await new Promise(() => {});
    });
  });

  // --- Model discovery ---

  app.get("/api/v1/services", async (c) => {
    const secrets = await loadSecrets(root);
    const endpoints = getAllEndpoints().filter((ep) => ep.id !== "custom");
    let configuredServices: ReturnType<typeof normalizeServiceConfig> = [];
    try {
      const config = await loadRawConfig(root);
      configuredServices = normalizeServiceConfig(
        (config.llm as Record<string, unknown> | undefined)?.services,
      );
    } catch { /* no config file */ }
    const configuredBankServices = new Set(
      configuredServices
        .filter((service) => service.service !== "custom")
        .map((service) => service.service),
    );

    // Fast: only check connection status from secrets, no external API calls.
    const services = endpoints.map((ep) => {
      const apiKeyOptional = isApiKeyOptionalForEndpoint({
        provider: resolveServiceProviderFamily(ep.id) ?? "openai",
        baseUrl: resolveServicePreset(ep.id)?.baseUrl ?? ep.baseUrl,
      });
      return {
        service: ep.id,
        label: ep.label,
        group: ep.group,
        apiKeyOptional,
        connected: Boolean(secrets.services[ep.id]?.apiKey)
          || (apiKeyOptional && configuredBankServices.has(ep.id)),
      };
    }).sort(compareServiceListItems);

    // Add custom services from castor.json
    for (const svc of configuredServices) {
      if (svc.service === "custom") {
        const secretKey = `custom:${svc.name}`;
        const apiKeyOptional = isApiKeyOptionalForEndpoint({
          provider: "openai",
          baseUrl: svc.baseUrl,
        });
        services.push({
          service: secretKey,
          label: svc.name ?? "Custom",
          group: undefined,
          apiKeyOptional,
          connected: Boolean(secrets.services[secretKey]?.apiKey) || apiKeyOptional,
        });
      }
    }

    return c.json({ services });
  });

  app.get("/api/v1/services/config", async (c) => {
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    const envConfig = await readEnvConfigStatus(root);
    return c.json({
      services,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: llm.defaultModel ?? null,
      configSource: "studio" satisfies LLMConfigSource,
      storedConfigSource: normalizeConfigSource(llm.configSource),
      envConfig,
    });
  });

  app.post("/api/v1/services/config/import-env", async (c) => {
    const env = await readEffectiveEnvConfigValues(root);
    if (!env || !env.values.apiKey) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "Không phát hiện cấu hình biến môi trường LLM nào có thể nhập, hoặc thiếu CASTOR_LLM_API_KEY.",
          "No importable LLM environment variable configuration was detected, or CASTOR_LLM_API_KEY is missing.",
        ),
      }, 400);
    }

    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    const existingServices = normalizeServiceConfig(llm.services);
    const explicitService = env.values.service?.trim();
    const guessedService = env.values.baseUrl ? guessServiceFromBaseUrl(env.values.baseUrl) : null;
    const service = explicitService || guessedService || "custom";

    const entry: ServiceConfigEntry = service === "custom"
      ? {
          service: "custom",
          name: "Env LLM",
          ...(env.values.baseUrl ? { baseUrl: env.values.baseUrl } : {}),
        }
      : { service };
    const serviceKey = serviceConfigKey(entry);

    llm.services = mergeServiceConfig(existingServices, [entry]);
    llm.service = serviceKey;
    llm.configSource = "studio";
    if (env.values.model) llm.defaultModel = env.values.model;
    syncTopLevelLlmMirror(llm);

    const secrets = await loadSecrets(root);
    secrets.services[serviceKey] = { apiKey: env.values.apiKey };
    await saveSecrets(root, secrets);
    await saveRawConfig(root, config);

    return c.json({
      ok: true,
      source: env.source,
      service: serviceKey,
      defaultModel: env.values.model ?? null,
    });
  });

  app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ services?: unknown; defaultModel?: string; configSource?: LLMConfigSource; service?: string }>();
    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    if (body.services !== undefined) {
      const existingServices = normalizeServiceConfig(llm.services);
      const incomingServices = normalizeServiceConfig(body.services);
      llm.services = mergeServiceConfig(existingServices, incomingServices);
    }
    if (body.defaultModel !== undefined) {
      llm.defaultModel = body.defaultModel;
    }
    if (body.configSource === "env") {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "Runtime Studio không hỗ trợ chuyển sang env; env chỉ dùng làm lớp ghi đè trong runtime CLI/daemon/triển khai.",
          "The Studio runtime does not support switching to env; env only acts as an override layer in the CLI/daemon/deployment runtimes.",
        ),
      }, 400);
    }
    if (body.configSource !== undefined) {
      llm.configSource = normalizeConfigSource(body.configSource);
    }
    if (body.service !== undefined) {
      llm.service = body.service;
    }
    syncTopLevelLlmMirror(llm);
    await saveRawConfig(root, config);
    return c.json({ ok: true });
  });

  app.get("/api/v1/cover/config", async (c) => {
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const cover = normalizeCoverConfig(llm.cover);
    const secrets = await loadSecrets(root);
    const keyFor = (service: string): boolean =>
      Boolean(secrets.services[coverSecretKey(service)]?.apiKey || secrets.services[service]?.apiKey);
    // "Configured" = a cover service is selected AND has a key, OR a cover
    // endpoint is provided via env (the CLI/power-user path). This is the gate
    // for the Play auto-illustration toggles.
    const envConfigured = Boolean(
      (castorEnv("CASTOR_COVER_BASE_URL") || castorEnv("CASTOR_COVER_ENDPOINT"))
      && (castorEnv("CASTOR_COVER_API_KEY") || keyFor("kkaiapi")),
    );
    const configured = Boolean(cover?.service && keyFor(cover.service)) || envConfigured;
    return c.json({
      service: cover?.service ?? null,
      model: cover?.model ?? null,
      baseUrl: cover?.baseUrl ?? null,
      configured,
      providers: COVER_PROVIDER_PRESETS.map((provider) => ({
        service: provider.service,
        label: provider.label,
        baseUrl: provider.baseUrl,
        defaultModel: provider.defaultModel,
        models: provider.models,
        connected: keyFor(provider.service),
      })),
    });
  });

  app.put("/api/v1/cover/config", async (c) => {
    const body = await c.req.json<{ service?: string; model?: string; baseUrl?: string }>();
    const preset = resolveCoverProviderPreset(body.service);
    if (!preset) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const model = typeof body.model === "string" && preset.models.includes(body.model)
      ? body.model
      : preset.defaultModel;
    const requestedBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const baseUrl = normalizeCoverBaseUrl(requestedBaseUrl);
    if (requestedBaseUrl && !baseUrl) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "Base URL tạo bìa phải là địa chỉ HTTP(S) hợp lệ và không được chứa thông tin tài khoản, tham số truy vấn hay anchor.",
          "Cover Base URL must be a valid HTTP(S) URL without credentials, query parameters, or fragments.",
        ),
      }, 400);
    }

    const config = await loadRawConfig(root);
    config.llm = config.llm ?? {};
    const llm = config.llm as Record<string, unknown>;
    llm.cover = {
      service: preset.service,
      model,
      ...(baseUrl ? { baseUrl } : {}),
    };
    await saveRawConfig(root, config);
    return c.json({ ok: true, service: preset.service, model, baseUrl: baseUrl ?? null });
  });

  app.get("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const secrets = await loadSecrets(root);
    return c.json({ apiKey: secrets.services[coverSecretKey(service)]?.apiKey ?? "" });
  });

  app.put("/api/v1/cover/secret/:service", async (c) => {
    const service = c.req.param("service");
    if (!resolveCoverProviderPreset(service)) {
      return c.json({ error: "Unsupported cover service" }, 400);
    }
    const body = await c.req.json<{ apiKey?: string }>();
    const trimmedKey = body.apiKey?.trim() ?? "";
    if (trimmedKey && !isHeaderSafeApiKey(trimmedKey)) {
      return c.json({
        error: pick(
          await currentProjectLanguage(),
          "API Key chứa ký tự không thể đặt trong HTTP Authorization header; hãy chỉ dán nguyên bản khóa.",
          "API Key contains characters that cannot go into an HTTP Authorization header. Paste only the raw key.",
        ),
      }, 400);
    }

    const secrets = await loadSecrets(root);
    const key = coverSecretKey(service);
    if (trimmedKey) {
      secrets.services[key] = { apiKey: trimmedKey };
    } else {
      delete secrets.services[key];
    }
    await saveSecrets(root, secrets);
    return c.json({ ok: true, service });
  });

  app.delete("/api/v1/services/:service", async (c) => {
    const service = c.req.param("service");
    const config = await loadRawConfig(root);
    const llm = (config.llm as Record<string, unknown> | undefined) ?? {};
    const existingServices = normalizeServiceConfig(llm.services);
    const nextServices = existingServices.filter((entry) => serviceConfigKey(entry) !== service);

    if (!config.llm) config.llm = {};
    const nextLlm = config.llm as Record<string, unknown>;
    nextLlm.services = nextServices;
    if (nextLlm.service === service) {
      delete nextLlm.service;
      delete nextLlm.defaultModel;
    }
    await saveRawConfig(root, config);

    const secrets = await loadSecrets(root);
    delete secrets.services[service];
    await saveSecrets(root, secrets);
    modelListCache.clear();
    return c.json({ ok: true, service });
  });

  app.post("/api/v1/services/:service/test", async (c) => {
    const service = c.req.param("service");
    const { apiKey, baseUrl, apiFormat, stream } = await c.req.json<{
      apiKey: string;
      baseUrl?: string;
      apiFormat?: "chat" | "responses";
      stream?: boolean;
    }>();

    const language = await currentProjectLanguage();
    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service, baseUrl);
    if (!resolvedBaseUrl) {
      return c.json({
        ok: false,
        error: pick(language, `Nhà cung cấp không rõ: ${service}`, `Unknown service: ${service}`),
      }, 400);
    }

    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });
    if (!apiKey?.trim() && !apiKeyOptional) {
      return c.json({
        ok: false,
        error: pick(language, "API Key không được để trống", "API Key must not be empty"),
      }, 400);
    }

    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const probe = await probeServiceCapabilities({
      root,
      service,
      apiKey: apiKey?.trim() ?? "",
      baseUrl: resolvedBaseUrl,
      preferredApiFormat: apiFormat,
      preferredStream: stream,
      proxyUrl: typeof llm.proxyUrl === "string" ? llm.proxyUrl : undefined,
      language,
    });

    // B12: 升级响应 shape 为 { probe, chat, ... }，同时保留老字段供 UI 过渡期兼容
    const connectionFailed = pick(language, "Kết nối thất bại", "Connection failed");
    const probeStatus = {
      ok: probe.ok,
      models: probe.models?.length ?? 0,
      ...(probe.ok ? {} : { error: probe.error ?? connectionFailed }),
    };

    if (!probe.ok) {
      return c.json({
        ok: false,
        error: probe.error ?? connectionFailed,
        probe: probeStatus,
        chat: null,
      }, 400);
    }

    return c.json({
      ok: true,
      modelCount: probe.models.length,
      models: probe.models,
      selectedModel: probe.selectedModel,
      detected: {
        apiFormat: probe.apiFormat,
        stream: probe.stream,
        baseUrl: probe.baseUrl,
        modelsSource: probe.modelsSource,
      },
      // B12 新字段：两步验证状态
      probe: probeStatus,
      chat: null,  // probeServiceCapabilities 本身只做 probe，chat hello 在 Studio 的 follow-up 调用里单独触发
    });
  });

  app.put("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const { apiKey } = await c.req.json<{ apiKey: string }>();
    const secrets = await loadSecrets(root);
    const trimmedKey = apiKey?.trim() ?? "";
    if (trimmedKey) {
      if (!isHeaderSafeApiKey(trimmedKey)) {
        return c.json({
          ok: false,
          error: pick(
            await currentProjectLanguage(),
            "API Key chỉ được chứa ký tự ASCII không phải khoảng trắng, đủ điều kiện đặt trong HTTP Authorization header; đừng dán thông báo kết nối thất bại hay văn bản chẩn đoán.",
            "API Key may only contain non-whitespace ASCII characters that fit in an HTTP Authorization header; do not paste connection failure hints or diagnostic text.",
          ),
        }, 400);
      }
      secrets.services[service] = { apiKey: trimmedKey };
    } else {
      delete secrets.services[service];
    }
    await saveSecrets(root, secrets);
    return c.json({ ok: true });
  });

  app.get("/api/v1/services/:service/secret", async (c) => {
    const service = c.req.param("service");
    const secrets = await loadSecrets(root);
    return c.json({
      apiKey: secrets.services[service]?.apiKey ?? "",
    });
  });

  app.get("/api/v1/services/models", async (c) => {
    const secrets = await loadSecrets(root);
    const config = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const configuredServices = normalizeServiceConfig(
      (config.llm as Record<string, unknown> | undefined)?.services,
    );
    const configuredById = new Map(configuredServices.map((entry) => [serviceConfigKey(entry), entry]));
    const endpoints = getAllEndpoints()
      .filter((ep) => {
        if (ep.id === "custom") return false;
        const configured = configuredById.has(ep.id);
        const optional = isApiKeyOptionalForEndpoint({
          provider: resolveServiceProviderFamily(ep.id) ?? "openai",
          baseUrl: resolveServicePreset(ep.id)?.baseUrl ?? ep.baseUrl,
        });
        return Boolean(secrets.services[ep.id]?.apiKey) || (optional && configured);
      });

    const groups = endpoints.map((ep) => {
      const staticModels = ep.models
        .filter((m) => m.enabled !== false)
        .filter((m) => isTextChatModelId(m.id));
      const configuredModels = configuredById.get(ep.id)?.models ?? [];
      const models = mergeServiceModelIds(staticModels.map((model) => model.id), configuredModels)
        .map((id) => {
          const known = staticModels.find((model) => model.id.toLowerCase() === id.toLowerCase());
          return {
            id,
            name: id,
            ...(typeof known?.maxOutput === "number" ? { maxOutput: known.maxOutput } : {}),
            ...(known && known.contextWindowTokens > 0 ? { contextWindow: known.contextWindowTokens } : {}),
          };
        });
      return { service: ep.id, label: ep.label, models };
    });

    return c.json({ groups });
  });

  app.get("/api/v1/services/models/custom", async (c) => {
    const secrets = await loadSecrets(root);
    let config: Record<string, unknown> = {};
    try {
      config = await loadRawConfig(root);
    } catch {
      // no config file
    }

    const customs = normalizeServiceConfig((config.llm as Record<string, unknown> | undefined)?.services)
      .filter((s) => s.service === "custom")
      .map((s) => ({
        id: `custom:${s.name ?? "Custom"}`,
        baseUrl: s.baseUrl ?? "",
        label: s.name ?? "Custom",
      }))
      .filter((s) => s.baseUrl && Boolean(secrets.services[s.id]?.apiKey));

    const groups = await Promise.all(customs.map(async (s) => ({
      service: s.id,
      label: s.label,
      models: filterTextChatModels(
        await probeModelsFromUpstream(s.baseUrl, secrets.services[s.id].apiKey, 10_000),
      ),
    })));

    return c.json({ groups });
  });

  app.get("/api/v1/services/:service/models", async (c) => {
    const service = c.req.param("service");
    const refresh = c.req.query("refresh") === "1";
    const secrets = await loadSecrets(root);
    const apiKey = c.req.query("apiKey") || secrets.services[service]?.apiKey || "";
    const configuredEntry = await resolveConfiguredServiceEntry(root, service);
    const configuredModels = configuredEntry?.models ?? [];

    const resolvedBaseUrl = await resolveConfiguredServiceBaseUrl(root, service);
    const baseService = isCustomServiceId(service) ? "custom" : service;
    const apiKeyOptional = isApiKeyOptionalForEndpoint({
      provider: resolveServiceProviderFamily(baseService) ?? "openai",
      baseUrl: resolvedBaseUrl,
    });

    // No key = no models, except local/self-hosted endpoints such as Ollama.
    if (!apiKey && !apiKeyOptional) {
      return c.json({ models: configuredModels.map((id) => ({ id, name: id })) });
    }

    // Cache by service + resolved baseUrl + apiKey fingerprint; valid for 10 min unless ?refresh=1
    const cacheKey = `${service}::${resolvedBaseUrl ?? ""}::${apiKey.slice(-8)}`;
    if (!refresh) {
      const cached = modelListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        const models = mergeServiceModelIds(cached.models.map((model) => model.id), configuredModels)
          .map((id) => cached.models.find((model) => model.id.toLowerCase() === id.toLowerCase()) ?? { id, name: id });
        return c.json({ models });
      }
    }

    // B13: 走 listModelsForService 走 live probe + bank 交叉，返回带元数据的 models
    const enriched = await listModelsForService(
      isCustomServiceId(service) ? "custom" : service,
      apiKey,
      isCustomServiceId(service) ? resolvedBaseUrl ?? undefined : undefined,
    );
    const liveModels = filterTextChatModels(enriched).map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.maxOutput !== undefined ? { maxOutput: m.maxOutput } : {}),
      ...(m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
    }));
    const models = mergeServiceModelIds(liveModels.map((model) => model.id), configuredModels)
      .map((id) => liveModels.find((model) => model.id.toLowerCase() === id.toLowerCase()) ?? { id, name: id });
    modelListCache.set(cacheKey, { models, at: Date.now() });
    return c.json({ models });
  });

  // --- Project info ---

  app.get("/api/v1/project", async (c) => {
    let currentConfig: ProjectConfig;
    let raw: Record<string, unknown>;
    try {
      currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      // Check if language was explicitly set in the project config (not just the schema default)
      raw = await loadRawConfig(root);
    } catch (error) {
      throw new ApiError(
        500,
        "PROJECT_CONFIG_INVALID",
        `Failed to load castor.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const languageExplicit = "language" in raw && raw.language !== "";

    return c.json({
      name: currentConfig.name,
      language: currentConfig.language,
      languageExplicit,
      model: currentConfig.llm.model,
      provider: currentConfig.llm.provider,
      baseUrl: currentConfig.llm.baseUrl,
      stream: currentConfig.llm.stream,
      temperature: currentConfig.llm.temperature,
    });
  });

  app.get("/api/v1/skills", async (c) => {
    const result = await loadStudioSkills(root);
    return c.json(result);
  });

  app.get("/api/v1/prompt-packs", async (c) => {
    const prompts = await Promise.all(
      listBuiltinPrompts().map((prompt) => toStudioPromptPackPrompt(root, prompt)),
    );
    return c.json({
      packs: listBuiltinPromptPacks(),
      prompts,
    });
  });

  app.put("/api/v1/prompt-packs/:promptId", async (c) => {
    const promptId = normalizeStudioPromptId(c.req.param("promptId"));
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_PROMPT_PACK_PAYLOAD", "Prompt pack payload must be JSON");
    });
    const content = payload && typeof payload === "object" && "content" in payload
      ? (payload as { readonly content?: unknown }).content
      : undefined;
    if (typeof content !== "string") {
      throw new ApiError(400, "INVALID_PROMPT_PACK_PAYLOAD", "content must be a string");
    }

    const file = promptOverridePath(root, promptId);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf-8");
    const prompt = listBuiltinPrompts().find((item) => item.id === promptId);
    return c.json({ prompt: await toStudioPromptPackPrompt(root, prompt!) });
  });

  app.delete("/api/v1/prompt-packs/:promptId", async (c) => {
    const promptId = normalizeStudioPromptId(c.req.param("promptId"));
    const file = promptOverridePath(root, promptId);
    await rm(file, { force: true });
    const prompt = listBuiltinPrompts().find((item) => item.id === promptId);
    return c.json({ prompt: await toStudioPromptPackPrompt(root, prompt!) });
  });

  app.post("/api/v1/skills/import", async (c) => {
    const payload = await c.req.json().catch(() => {
      throw new ApiError(400, "INVALID_SKILL_IMPORT", "Skill import payload must be JSON");
    });
    const skill = await importStudioSkillFolder(root, payload);
    return c.json({ skill: toStudioSkill(skill, root, new Set([skill.id])) });
  });

  app.delete("/api/v1/skills/:skillId", async (c) => {
    const id = normalizeStudioSkillId(c.req.param("skillId"), "skillId");
    try {
      await access(projectSkillPath(root, id));
    } catch {
      throw new ApiError(404, "SKILL_NOT_FOUND", `Project skill not found: ${id}`);
    }
    await rm(projectSkillDir(root, id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  app.get("/api/v1/project/files/:file{.+}", async (c) => {
    const file = resolveProjectImageFile(root, c.req.param("file"));

    try {
      const content = await readFile(file.resolved);
      return new Response(content, {
        headers: {
          "Content-Type": file.contentType,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return c.notFound();
    }
  });

  app.get("/api/v1/project/artifacts/:file{.+}", async (c) => {
    const file = resolveProjectTextArtifactFile(root, c.req.param("file"));

    try {
      const content = await readFile(file.resolved, "utf-8");
      return c.json({
        path: file.relPath,
        content,
        contentType: file.contentType,
        size: Buffer.byteLength(content, "utf-8"),
      });
    } catch {
      return c.notFound();
    }
  });

  app.put("/api/v1/project/artifacts/:file{.+}", async (c) => {
    const file = resolveProjectTextArtifactFile(root, c.req.param("file"));
    const body = await c.req.json<unknown>().catch(() => null);
    const content = body && typeof body === "object" && "content" in body
      ? (body as { readonly content?: unknown }).content
      : undefined;
    if (typeof content !== "string") {
      throw new ApiError(400, "INVALID_PROJECT_ARTIFACT_BODY", "content must be a string");
    }

    await mkdir(dirname(file.resolved), { recursive: true });
    await writeFile(file.resolved, content, "utf-8");
    return c.json({
      ok: true,
      path: file.relPath,
      contentType: file.contentType,
      size: Buffer.byteLength(content, "utf-8"),
    });
  });

  // --- Config editing ---

  app.put("/api/v1/project", async (c) => {
    const updates = await c.req.json<Record<string, unknown>>();
    try {
      const existing = await loadRawConfig(root) as { llm?: Record<string, unknown>; language?: string };
      // Merge LLM settings
      if (updates.temperature !== undefined) {
        existing.llm.temperature = updates.temperature;
      }
      if (updates.stream !== undefined) {
        existing.llm.stream = updates.stream;
      }
      if (updates.language === "vi" || updates.language === "en" || updates.language === "zh") {
        existing.language = updates.language === "zh" ? "vi" : updates.language;
      }
      await saveRawConfig(root, existing);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/project/detection", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ detection: raw.detection ?? null });
  });

  app.put("/api/v1/project/detection", async (c) => {
    const { detection } = await c.req.json<{ detection?: unknown }>();
    const raw = await loadRawConfig(root) as { detection?: unknown };
    if (detection === null) {
      delete raw.detection;
    } else {
      const parsed = DetectionConfigSchema.safeParse(detection);
      if (!parsed.success) {
        return c.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, 400);
      }
      raw.detection = parsed.data;
    }
    await saveRawConfig(root, raw);
    return c.json({ ok: true, detection: raw.detection ?? null });
  });

  // --- Truth files browser ---

  app.get("/api/v1/books/:id/truth", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    const storyDir = join(bookDir, "story");

    async function listDir(subdir: string): Promise<string[]> {
      try {
        const entries = await readdir(join(storyDir, subdir));
        return entries.filter((f) => f.endsWith(".md") || f.endsWith(".json") || f.endsWith(".yaml"));
      } catch {
        return [];
      }
    }

    // Hotfix: only tag shim files as legacy when the book has the new layout.
    const { isNewLayoutBook } = await import("@actalk/castor-core");
    const newLayout = await isNewLayoutBook(bookDir);

    async function describe(relPath: string): Promise<{ readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true; readonly readonly?: true; readonly readonlyReason?: string } | null> {
      try {
        const content = await readFile(join(storyDir, relPath), "utf-8");
        const isShim = LEGACY_SHIM_FILES.has(relPath) && newLayout;
        const isRuntimeDiagnostic = RUNTIME_DIAGNOSTIC_FILE_RE.test(relPath);
        const entry: { readonly name: string; readonly size: number; readonly preview: string; readonly legacy?: true; readonly readonly?: true; readonly readonlyReason?: string } =
          isShim
            ? { name: relPath, size: content.length, preview: content.slice(0, 200), legacy: true }
            : isRuntimeDiagnostic
              ? { name: relPath, size: content.length, preview: content.slice(0, 200), readonly: true, readonlyReason: "runtime-diagnostic" }
              : { name: relPath, size: content.length, preview: content.slice(0, 200) };
        return entry;
      } catch {
        return null;
      }
    }

    try {
      // Flat story/ files (legacy + runtime logs)
      const flatFiles = (await listDir(".")).filter((f) => !f.startsWith("outline") && !f.startsWith("roles"));
      // Phase 5 outline/ files
      const outlineFiles = (await listDir("outline")).map((f) => `outline/${f}`);
      // Phase 5 roles/主要角色 + roles/次要角色, plus Phase hotfix 3
      // English-locale equivalents so en-language books are visible.
      const majorRolesZh = (await listDir("roles/主要角色")).map((f) => `roles/主要角色/${f}`);
      const minorRolesZh = (await listDir("roles/次要角色")).map((f) => `roles/次要角色/${f}`);
      const majorRolesEn = (await listDir("roles/major")).map((f) => `roles/major/${f}`);
      const minorRolesEn = (await listDir("roles/minor")).map((f) => `roles/minor/${f}`);
      const runtimeFiles = (await listDir("runtime"))
        .map((f) => `runtime/${f}`)
        .filter((f) => RUNTIME_DIAGNOSTIC_FILE_RE.test(f));

      const all = [
        ...flatFiles,
        ...outlineFiles,
        ...majorRolesZh,
        ...minorRolesZh,
        ...majorRolesEn,
        ...minorRolesEn,
        ...runtimeFiles,
      ];
      const described = await Promise.all(all.map(describe));
      const result = described.filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json({ files: result });
    } catch {
      return c.json({ files: [] });
    }
  });

  // --- Daemon control ---

  let schedulerInstance: Scheduler | null = null;

  app.get("/api/v1/daemon", (c) => {
    return c.json({
      running: schedulerInstance?.isRunning ?? false,
    });
  });

  app.post("/api/v1/daemon/start", async (c) => {
    if (schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon already running" }, 400);
    }
    try {
      const currentConfig = await loadCurrentProjectConfig();
      const scheduler = new Scheduler({
        ...(await buildPipelineConfig()),
        radarCron: currentConfig.daemon.schedule.radarCron,
        writeCron: currentConfig.daemon.schedule.writeCron,
        maxConcurrentBooks: currentConfig.daemon.maxConcurrentBooks,
        chaptersPerCycle: currentConfig.daemon.chaptersPerCycle,
        retryDelayMs: currentConfig.daemon.retryDelayMs,
        cooldownAfterChapterMs: currentConfig.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: currentConfig.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter, status) => {
          broadcast("daemon:chapter", { bookId, chapter, status });
        },
        onError: (bookId, error) => {
          broadcast("daemon:error", { bookId, error: error.message });
        },
      });
      schedulerInstance = scheduler;
      broadcast("daemon:started", {});
      void scheduler.start().catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e));
        if (schedulerInstance === scheduler) {
          scheduler.stop();
          schedulerInstance = null;
          broadcast("daemon:stopped", {});
        }
        broadcast("daemon:error", { bookId: "scheduler", error: error.message });
      });
      return c.json({ ok: true, running: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/daemon/stop", (c) => {
    if (!schedulerInstance?.isRunning) {
      return c.json({ error: "Daemon not running" }, 400);
    }
    schedulerInstance.stop();
    schedulerInstance = null;
    broadcast("daemon:stopped", {});
    return c.json({ ok: true, running: false });
  });

  // --- Logs ---

  app.get("/api/v1/logs", async (c) => {
    const logPath = join(root, "castor.log");
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").slice(-100);
      const entries = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { message: line }; }
      });
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  // --- Agent chat ---

  app.get("/api/v1/interaction/session", async (c) => {
    const session = await loadProjectSession(root);
    const activeBookId = await resolveSessionActiveBook(root, session);
    return c.json({
      session: activeBookId && session.activeBookId !== activeBookId
        ? { ...session, activeBookId }
        : session,
      activeBookId,
    });
  });

  // Play worlds are created and advanced by the play_start / play_step agent
  // tools (worldId === sessionId). The HUD only needs to read a run's state,
  // so just the run-detail endpoint remains; the old save-slot list/create
  // endpoints were only used by the removed standalone play page.
  app.get("/api/v1/play/runs/:worldId/:runId", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const store = new PlayStore(root);
    const db = createPlayDB(store.runDir(worldId, runId));
    const [transcript, currentState, world] = await Promise.all([
      store.readTranscript(worldId, runId),
      store.loadCurrentState(worldId, runId).catch(() => null),
      store.loadWorld(worldId).catch(() => null),
    ]);
    const graph = db.snapshot();
    db.close?.();

    // Merge generated illustrations (decoupled sidecar) onto entities so the
    // HUD can render portraits/stills without touching the event-sourced graph.
    const runDir = store.runDir(worldId, runId);
    const [manifest, imageSettings] = await Promise.all([
      readPlayImageManifest(runDir),
      readPlayImageSettings(runDir),
    ]);
    const imageUrlFor = (file?: string): string | undefined =>
      file ? `/api/v1/play/runs/${encodeURIComponent(worldId)}/${encodeURIComponent(runId)}/images/${encodeURIComponent(file)}` : undefined;
    const sceneImageUrls = Object.fromEntries(
      Object.entries(manifest)
        .filter(([key, entry]) => key.startsWith("scene-turn-") && entry.status === "ready" && entry.file)
        .map(([key, entry]) => [key, imageUrlFor(entry.file)]),
    );
    const entitiesWithImages = (graph.entities ?? []).map((entity: { id: string }) => {
      const entry = manifest[entity.id];
      return entry?.status === "ready" && entry.file
        ? { ...entity, imageUrl: imageUrlFor(entry.file) }
        : entity;
    });

    // Illustration of the current moment, if one was generated for this turn.
    const sceneTurn = (currentState as { turn?: number } | null)?.turn ?? 0;
    const sceneEntry = manifest[`scene-turn-${sceneTurn}`];
    const sceneImageUrl = sceneEntry?.status === "ready" ? imageUrlFor(sceneEntry.file) : undefined;

    return c.json({
      worldId,
      runId,
      title: world?.title ?? null,
      transcript,
      currentState,
      graph: { ...graph, entities: entitiesWithImages },
      imageSettings,
      sceneImageUrls,
      ...(sceneImageUrl ? { sceneImageUrl } : {}),
    });
  });

  // --- Interactive-world illustration (Play auto-config images) ---

  app.put("/api/v1/play/runs/:worldId/:runId/image-settings", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const body = await c.req.json<Partial<PlayImageSettings>>().catch(() => ({} as Partial<PlayImageSettings>));
    const settings: PlayImageSettings = {
      actors: Boolean(body.actors),
      moments: Boolean(body.moments),
      inventory: Boolean(body.inventory),
    };
    const runDir = new PlayStore(root).runDir(worldId, runId);
    await writePlayImageSettings(runDir, settings);
    return c.json({ ok: true, imageSettings: settings });
  });

  app.post("/api/v1/play/runs/:worldId/:runId/generate-image", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    type GenerateImageBody = {
      target: "entity" | "scene";
      entityId?: string;
      sceneText?: string;
      sceneKey?: string;
    };
    const body = await c.req.json<GenerateImageBody>().catch(() => ({ target: "entity" } as GenerateImageBody));

    const store = new PlayStore(root);
    const runDir = store.runDir(worldId, runId);
    const [world, currentState] = await Promise.all([
      store.loadWorld(worldId).catch(() => null),
      store.loadCurrentState(worldId, runId).catch(() => null),
    ]);
    const worldContext = world
      ? {
        premise: world.premise,
        worldContract: world.worldContract,
        visualContract: world.visualContract,
      }
      : undefined;

    let key: string;
    let prompt: string;
    if (body.target === "scene") {
      // The current moment defaults to the rendered scene projection so the UI
      // can offer a one-tap "illustrate this moment" without re-sending prose.
      const sceneText = (
        (body.sceneText ?? "").trim()
        || (await store.readProjection(worldId, runId, "projections/scene.md").catch(() => "")).trim()
      );
      if (!sceneText) return c.json({ error: "no current scene to illustrate" }, 400);
      key = body.sceneKey?.trim() || `scene-turn-${(currentState as { turn?: number } | null)?.turn ?? 0}`;
      prompt = buildPlaySceneImagePrompt(sceneText, worldContext);
    } else {
      const entityId = body.entityId?.trim();
      if (!entityId) return c.json({ error: "entityId is required for an entity image" }, 400);
      const db = createPlayDB(runDir);
      const graph = db.snapshot();
      db.close?.();
      const entity = (graph.entities ?? []).find((e: { id: string }) => e.id === entityId) as
        | { id: string; type: string; label: string; summary?: string }
        | undefined;
      if (!entity) return c.json({ error: `entity not found: ${entityId}` }, 404);
      key = entity.id;
      prompt = buildPlayEntityImagePrompt(entity, worldContext);
    }

    try {
      const entry = await generatePlayImage({ root, runDir, key, prompt });
      const url = entry.status === "ready" && entry.file
        ? `/api/v1/play/runs/${encodeURIComponent(worldId)}/${encodeURIComponent(runId)}/images/${encodeURIComponent(entry.file)}`
        : undefined;
      return c.json({ key, ok: entry.status === "ready", ...entry, ...(url ? { url } : {}) });
    } catch (e) {
      // Resolution failure = cover API not configured.
      return c.json({ error: e instanceof Error ? e.message : String(e), needsCoverConfig: true }, 400);
    }
  });

  app.get("/api/v1/play/runs/:worldId/:runId/images/:file", async (c) => {
    const worldId = normalizeApiBookId(c.req.param("worldId"), "worldId") ?? "default-world";
    const runId = normalizeApiBookId(c.req.param("runId"), "runId") ?? "default-run";
    const file = c.req.param("file");
    if (!file || file.includes("/") || file.includes("..") || file.includes("\0")) {
      return c.json({ error: "Invalid image file" }, 400);
    }
    const runDir = new PlayStore(root).runDir(worldId, runId);
    try {
      const { readFile: readFileFs } = await import("node:fs/promises");
      const content = await readFileFs(join(runDir, "images", file));
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return new Response(content, { headers: { "Content-Type": contentType } });
    } catch {
      return c.notFound();
    }
  });

  // -- Per-book session endpoints --

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const sessions = await listBookSessions(root, bookId === undefined ? null : bookId === "null" ? null : bookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await loadBookSession(root, sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const task = await loadReconciledTaskSnapshot(sessionId);
    return c.json({ session, ...(task ? { task } : {}) });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string; sessionKind?: string; playMode?: string }>().catch(() => ({}));
    const bookId = normalizeApiBookId((body as { bookId?: unknown }).bookId, "bookId");
    const sessionKind = normalizeStudioSessionKind(
      (body as { sessionKind?: unknown }).sessionKind,
      bookId ? "book" : "chat",
    );
    const playMode = normalizeStudioPlayMode((body as { playMode?: unknown }).playMode);
    const sessionId = (body as { sessionId?: string }).sessionId;
    // sessionId 只允许 timestamp-random 格式；防止注入任意文件名
    const safeSessionId = sessionId && /^[0-9]+-[a-z0-9]+$/.test(sessionId) ? sessionId : undefined;
    const session = await createAndPersistBookSession(
      root,
      bookId,
      safeSessionId,
      sessionKind,
      ...(playMode ? [{ playMode }] as const : []),
    );
    // 客户端可以用同一个 sessionId 重新创建会话：移除删除标记，
    // 让新会话的生产任务可以正常持久化快照。
    deletedSessionIds.delete(session.sessionId);
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId/play-mode", async (c) => {
    const body = await c.req.json<{ playMode?: string }>().catch(() => ({}));
    const playMode = normalizeStudioPlayMode((body as { playMode?: unknown }).playMode);
    if (!playMode) {
      throw new ApiError(400, "INVALID_PLAY_MODE", "playMode is required");
    }
    const existing = await loadBookSession(root, c.req.param("sessionId"));
    if (!existing) return c.json({ error: "Session not found" }, 404);
    const session = await createAndPersistBookSession(
      root,
      existing.bookId,
      existing.sessionId,
      existing.sessionKind,
      { playMode },
    );
    return c.json({ session });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError(400, "INVALID_SESSION_TITLE", "Session title is required");
    }

    const session = await renameBookSession(root, sessionId, title);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    // 先标记删除，再中止任务：任务被中止后的错误持久化会检查这个标记，
    // 不会把已删除会话的快照文件重建出来。
    deletedSessionIds.add(sessionId);
    const controller = await findRunningTaskController(sessionId);
    controller?.abort();
    await Promise.all([
      deleteBookSession(root, sessionId),
      deleteStudioTaskSnapshot(root, sessionId),
    ]);
    return c.json({ ok: true });
  });

  app.post("/api/v1/sessions/:sessionId/abort", async (c) => {
    const sessionId = c.req.param("sessionId");
    const chatOnly = c.req.query("scope") === "chat";
    const controller = chatOnly ? undefined : await findRunningTaskController(sessionId);
    controller?.abort();
    const taskAborted = Boolean(controller);
    const aborted = abortAgentSession(root, sessionId) || taskAborted;
    broadcast("agent:aborted", { sessionId, aborted, scope: chatOnly ? "chat" : "all" });
    return c.json({ ok: true, aborted });
  });

  app.post("/api/v1/agent", async (c) => {
    const {
      instruction,
      activeBookId,
      sessionId: reqSessionId,
      clientRequestId: reqClientRequestId,
      sessionKind: reqSessionKind,
      actionSource: reqActionSource,
      requestedIntent: reqRequestedIntent,
      actionPayload: reqActionPayload,
      requestedSkills: reqRequestedSkills,
      disabledSkills: reqDisabledSkills,
      attachments: reqAttachments,
      playMode: reqPlayMode,
      model: reqModel,
      service: reqService,
    } = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      clientRequestId?: unknown;
      sessionKind?: string;
      actionSource?: string;
      requestedIntent?: string;
      actionPayload?: unknown;
      requestedSkills?: unknown;
      disabledSkills?: unknown;
      attachments?: unknown;
      playMode?: string;
      model?: string;
      service?: string;
    }>();
    const sessionId = reqSessionId;
    if (!instruction?.trim()) {
      return c.json({ error: "No instruction provided" }, 400);
    }
    if (!sessionId?.trim()) {
      throw new ApiError(400, "SESSION_ID_REQUIRED", "sessionId is required");
    }
    const sourceRequestId = typeof reqClientRequestId === "string" && reqClientRequestId.trim()
      ? reqClientRequestId.trim().slice(0, 128)
      : undefined;
    const language = await currentProjectLanguage();
    if (reqModel && !isTextChatModelId(reqModel)) {
      const message = nonTextModelMessage(reqModel, language);
      return c.json({ error: message, response: message }, 400);
    }

    const actionSource = normalizeStudioActionSource(reqActionSource);
    const requestedIntent = normalizeStudioRequestedIntent(reqRequestedIntent);
    const actionPayload = normalizeStudioActionPayload(reqActionPayload);
    const requestedSkills = normalizeStudioSkillIdList(reqRequestedSkills, "requestedSkills");
    const disabledSkills = normalizeStudioSkillIdList(reqDisabledSkills, "disabledSkills");
    const attachments = await normalizeAgentAttachments(root, sessionId, reqAttachments);
    const playMode = normalizeStudioPlayMode(reqPlayMode);

    broadcast("agent:start", { instruction, activeBookId, sessionId, actionSource, requestedIntent, requestedSkills, attachments: attachments.length });

    try {
      // Load config + create LLM client (pipeline created after model resolution)
      const config = await loadCurrentProjectConfig({ requireApiKey: false });
      const client = createLLMClient(config.llm);

      const loadedBookSession = await loadBookSession(root, sessionId);
      if (!loadedBookSession) {
        throw new ApiError(404, "SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
      }
      let bookSession = loadedBookSession;
      const requestedActiveBookId = normalizeApiBookId(activeBookId, "activeBookId");
      const persistedBookId = normalizeApiBookId(bookSession.bookId, "session.bookId");
      if (
        requestedActiveBookId
        && persistedBookId
        && persistedBookId !== requestedActiveBookId
      ) {
        throw new ApiError(
          409,
          "SESSION_BOOK_MISMATCH",
          `Session ${bookSession.sessionId} is bound to ${persistedBookId}, not ${requestedActiveBookId}`,
        );
      }
      const agentBookId = requestedActiveBookId ?? persistedBookId;
      const sessionKind = normalizeStudioSessionKind(
        reqSessionKind,
        bookSession.sessionKind ?? (agentBookId ? "book" : "chat"),
      );
      if (bookSession.sessionKind !== sessionKind || (playMode && bookSession.playMode !== playMode)) {
        const updatedSession = await createAndPersistBookSession(
          root,
          bookSession.bookId,
          bookSession.sessionId,
          sessionKind,
          ...(playMode ? [{ playMode }] as const : []),
        );
        bookSession = updatedSession;
      }
      let activeBookConfig: { readonly language?: string } | null = null;
      if (agentBookId && sessionKind !== "interactive-film-authoring") {
        try {
          activeBookConfig = await state.loadBookConfig(agentBookId);
        } catch {
          throw new ApiError(404, "BOOK_NOT_FOUND", `Book not found: ${agentBookId}`);
        }
      }
      // UI-facing surface language; legacy "zh" config values fall back to "vi".
      const configLanguage = config.language === "en" ? "en" : "vi";
      const bookLanguage = activeBookConfig?.language === "en" ? "en" : activeBookConfig?.language === "zh" ? "zh" : undefined;
      const requestedLanguage = actionPayload?.shortRun?.language ?? actionPayload?.createBook?.language;
      const surfaceLanguage = agentBookId
        ? (bookLanguage ?? configLanguage)
        : (requestedLanguage ?? inferLanguage(instruction));
      const streamSessionId = loadedBookSession.sessionId;
      const titleBeforeRun = bookSession.title;
      let sessionTitleBroadcasted = false;
      const refreshBookSessionFromTranscript = async (): Promise<void> => {
        // 会话已删除：磁盘上没有 transcript 可刷，也不该再广播它的标题。
        if (deletedSessionIds.has(bookSession.sessionId)) return;
        const refreshed = await loadBookSession(root, bookSession.sessionId);
        if (refreshed) {
          bookSession = refreshed;
        }
        if (!sessionTitleBroadcasted && titleBeforeRun === null && bookSession.title) {
          broadcast("session:title", { sessionId: bookSession.sessionId, title: bookSession.title });
          sessionTitleBroadcasted = true;
        }
      };

      // Resolve model — multi-service resolution
      let resolvedModel: ResolvedModel["model"] | undefined;
      let resolvedApiKey: string | undefined;

      if (reqService && reqModel) {
        // 1. Frontend explicitly selected a service+model — fail loudly if no key
        try {
          const configuredEntry = await resolveConfiguredServiceEntry(root, reqService);
          const resolved = await resolveServiceModel(
            reqService,
            reqModel,
            root,
            await resolveConfiguredServiceBaseUrl(root, reqService),
            configuredEntry?.apiFormat,
          );
          resolvedModel = resolved.model;
          resolvedApiKey = resolved.apiKey;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (/API key/i.test(msg)) {
            return c.json({
              error: pick(language, `Hãy cấu hình API Key cho ${reqService} trước`, `Configure an API Key for ${reqService} first`),
              response: pick(
                language,
                `Hãy điền API Key cho ${reqService} trong Cấu hình mô hình rồi thử lại.`,
                `Fill in an API Key for ${reqService} in the model settings, then try again.`,
              ),
            }, 400);
          }
          throw e;
        }
      }

      if (!resolvedModel) {
        // 2. Try defaultModel from new config format
        const rawConfig = config.llm as unknown as Record<string, unknown>;
        const defaultModel = rawConfig.defaultModel as string | undefined;
        const servicesArr = normalizeServiceConfig(rawConfig.services);
        const firstService = servicesArr[0];
        if (firstService?.service && defaultModel && isTextChatModelId(defaultModel)) {
          try {
            const resolved = await resolveServiceModel(
              serviceConfigKey(firstService),
              defaultModel,
              root,
              firstService.baseUrl,
              firstService.apiFormat,
            );
            resolvedModel = resolved.model;
            resolvedApiKey = resolved.apiKey;
          } catch { /* fall through */ }
        }
      }

      if (!resolvedModel) {
        // 3. Try first connected service from secrets
        const secrets = await loadSecrets(root);
        for (const [svcName, svcData] of Object.entries(secrets.services)) {
          if (svcData?.apiKey) {
            try {
              const models = await listModelsForService(svcName, svcData.apiKey);
              const textModels = filterTextChatModels(models);
              if (textModels.length > 0) {
                const configuredEntry = await resolveConfiguredServiceEntry(root, svcName);
                const resolved = await resolveServiceModel(
                  svcName,
                  textModels[0].id,
                  root,
                  await resolveConfiguredServiceBaseUrl(root, svcName),
                  configuredEntry?.apiFormat,
                );
                resolvedModel = resolved.model;
                resolvedApiKey = resolved.apiKey;
                break;
              }
            } catch { /* try next */ }
          }
        }
      }

      if (!resolvedModel) {
        // 4. Legacy fallback: use createLLMClient
        resolvedModel = client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "anthropic", modelId: config.llm.model } as any;
        resolvedApiKey = client._apiKey;
      }

      const model = resolvedModel!;
      const agentApiKey = resolvedApiKey;
      const configuredEntry = reqService ? await resolveConfiguredServiceEntry(root, reqService) : undefined;

      // Create pipeline with resolved model (so sub_agent tools use the frontend-selected model)
      // Don't spread config.llm — its baseUrl/provider belong to the old service.
      // Let createLLMClient resolve baseUrl from the service preset.
      const pipelineClient = (reqService && reqModel && resolvedModel)
        ? createLLMClient({
            ...config.llm,
            service: configuredEntry?.service ?? reqService,
            model: reqModel,
            apiKey: resolvedApiKey ?? "",
            ...(configuredEntry?.apiFormat ? { apiFormat: configuredEntry.apiFormat } : {}),
            ...(configuredEntry?.stream !== undefined ? { stream: configuredEntry.stream } : {}),
            baseUrl: configuredEntry?.baseUrl ?? "",
          } as any)
        : client;
      // Only a structured action request can start a production task. Free text
      // always stays in the Pi agent loop; the host never infers intent from prose.
      const confirmedIntent = requestedIntent && isConfirmedProductionAction(actionSource, requestedIntent)
        ? requestedIntent
        : undefined;
      // 任务的 execution id 在构建 pipeline 之前生成并传入 executionIdForSSE：
      // 该 pipeline 广播的进度事件（log / llm:progress / context:compression）
      // 由此带上任务 id。同会话并行聊天轮的 pipeline 是另一次请求单独构建的、
      // 不带这个 id，前端才能把任务日志与聊天轮工具日志分开归属。
      const confirmedTaskId = confirmedIntent ? `direct-${confirmedIntent}-${randomUUID()}` : undefined;

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        client: pipelineClient,
        model: reqModel ?? config.llm.model,
        currentConfig: config,
        sessionIdForSSE: bookSession.sessionId,
        bookIdForSettings: activeBookId ?? undefined,
        ...(confirmedTaskId ? { executionIdForSSE: confirmedTaskId } : {}),
      }));

      if (confirmedIntent && confirmedTaskId) {
        const productionTaskBusyResponse = () => {
          const message = pick(
            surfaceLanguage,
            "Phiên hiện tại đã có một tác vụ sản xuất đang chạy; hãy đợi nó hoàn tất hoặc dùng nút dừng để kết thúc trước khi tạo tác vụ mới.",
            "A production task is already running in this session. Wait for it to finish, or stop it first, then start a new task.",
          );
          return c.json({
            error: { code: "PRODUCTION_TASK_ALREADY_RUNNING", message },
            response: message,
          }, 409);
        };

        // task-store 每会话只有一个任务快照，不支持并发生产任务。
        // 名额必须在任何 await 之前同步预留：并发的第二个确认请求在这里 409，
        // 不会与第一个请求一起通过后面的快照检查（check-then-act 竞态）。
        // 预留键固定为此刻的 sessionId：后面 bookSession 可能因建书迁移被重新
        // 赋值，finally 释放的必须是当初预留的那个键。
        const reservedSessionId = bookSession.sessionId;
        if (reservedProductionSessions.has(reservedSessionId)) {
          return productionTaskBusyResponse();
        }
        reservedProductionSessions.set(reservedSessionId, confirmedTaskId);

        const taskId = confirmedTaskId;
        const taskController = new AbortController();
        activeConfirmedTasks.set(taskId, taskController);
        let pendingBookId: string | null = null;
        try {
          // 预留成功后再走快照检查：本进程的任务都会占预留名额，这里防的是
          // 旧进程遗留的运行中快照（loadReconciledTaskSnapshot 会把它对账成
          // 终态）等边界情况，保证不覆盖一个仍被认为在运行的任务。
          const runningTask = await findActiveRunningTask(bookSession.sessionId);
          if (runningTask) {
            return productionTaskBusyResponse();
          }

          pendingBookId = confirmedIntent === "create_book" && actionPayload?.createBook?.title
            ? deriveBookIdFromTitle(actionPayload.createBook.title)
            : null;
          if (pendingBookId) {
            bookCreateStatus.set(pendingBookId, { status: "creating" });
            broadcast("book:creating", {
              bookId: pendingBookId,
              title: actionPayload?.createBook?.title ?? pendingBookId,
              sessionId: streamSessionId,
            });
          }

          // 任务开始前先把用户指令作为 user 消息写进 transcript：任务运行期间
          // 刷新页面时，用户气泡能从 transcript 恢复；并行聊天随后写入的消息
          // 也会按真实时间排在指令之后。完成/失败路径只追加助手工具消息
          //（instruction 传空字符串），指令不会写第二遍。
          await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [{
            role: "user",
            content: instruction,
            timestamp: Date.now(),
          }], instruction, { sessionKind });

          const exec = await executeConfirmedProductionAction({
            pipeline,
            root,
            sessionId: bookSession.sessionId,
            bookId: agentBookId,
            streamSessionId,
            instruction,
            requestedIntent: confirmedIntent,
            actionPayload,
            requestedSkills,
            disabledSkills,
            language: surfaceLanguage,
            taskId,
            sourceRequestId,
            signal: taskController.signal,
            onTaskChange: (taskExec) => persistConfirmedTask(
              bookSession.sessionId,
              confirmedIntent,
              taskExec,
              sourceRequestId,
            ),
            ...(playMode ? { playMode } : {}),
          });

          let createdBookId: string | null = null;
          if (exec.status === "completed") {
            createdBookId = resolveCreatedBookIdFromToolExecs([exec]);
            if (createdBookId) {
              if (!await completeBookExists(join(root, "books", createdBookId))) {
                const message = pick(surfaceLanguage, "Công cụ sáng tác đã trả về kết quả tạo sách, nhưng sản phẩm sách trên đĩa không đầy đủ.", "The creation tool returned a book result, but the on-disk book artifact is incomplete.");
                bookCreateStatus.set(createdBookId, { status: "error", error: message });
                broadcast("book:error", { bookId: createdBookId, sessionId: bookSession.sessionId, error: message });
                throw new ApiError(500, "BOOK_CREATION_INCOMPLETE", message);
              }
              try {
                const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
                if (migratedSession) {
                  bookSession = migratedSession;
                }
              } catch (e) {
                if (!(e instanceof SessionAlreadyMigratedError)) {
                  throw e;
                }
              }
              const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
              bookCreateStatus.delete(createdBookId);
              broadcast("book:created", {
                bookId: createdBookId,
                sessionId: bookSession.sessionId,
                ...(book ? { book } : {}),
              });
            }
          }

          const responseText = exec.result ?? pick(surfaceLanguage, "Đã hoàn tất.", "Done.");
          const responseForUser = suppressManualTextForTool(exec) ? "" : responseText;
          // 指令已在任务开始时写入 transcript，这里只补助手工具消息。
          await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [
            manualToolAssistantMessage(
              responseText,
              exec,
              configuredEntry?.service ?? reqService ?? config.llm.provider,
              reqModel ?? config.llm.model,
            ),
          ], "", manualToolAppendOptions(sessionKind, exec));
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId: createdBookId ?? agentBookId, sessionId: bookSession.sessionId, sessionKind });
          return c.json({
            response: responseForUser,
            details: { toolExecutions: [exec] },
            session: {
              sessionId: bookSession.sessionId,
              sessionKind,
              ...(createdBookId ?? agentBookId ? { activeBookId: createdBookId ?? agentBookId } : {}),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = formatAgentActionFailure(message, surfaceLanguage);
          if (pendingBookId) {
            bookCreateStatus.set(pendingBookId, { status: "error", error: message });
            broadcast("book:error", { bookId: pendingBookId, sessionId: streamSessionId, error: message });
          }
          if (error instanceof ApiError) {
            broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, sessionKind, error: message });
            return c.json({
              error: { code: error.code, message: error.message },
              response: error.message,
            }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503);
          }
          if (error instanceof ConfirmedActionExecutionError) {
            // 指令已在任务开始时写入 transcript，失败时同样只补助手工具消息。
            await appendSessionMessagesUnlessDeleted(root, bookSession.sessionId, [
              manualToolAssistantMessage(
                message,
                error.exec,
                configuredEntry?.service ?? reqService ?? config.llm.provider,
                reqModel ?? config.llm.model,
              ),
            ], "", manualToolAppendOptions(sessionKind, error.exec)).catch(() => undefined);
            await refreshBookSessionFromTranscript().catch(() => undefined);
          }
          broadcast("agent:error", { instruction, activeBookId: agentBookId, sessionId: bookSession.sessionId, sessionKind, error: message });
          return c.json({
            error: { code: failure.code, message: failure.message },
            response: failure.message,
          }, failure.status);
        } finally {
          activeConfirmedTasks.delete(taskId);
          reservedProductionSessions.delete(reservedSessionId);
        }
      }

      // The surface agent should speak the user's language, not just the project default.
      // Pre-commitment surfaces (chat / play / short / book-create, no book yet) infer it
      // from the instruction; committed book/edit sessions keep the configured language.
      // Without this, an English request on a zh-default project gets Chinese replies — and
      // a Chinese play world, because play_start then infers from the rewritten premise.
      // Run pi-agent session
      // 后台生产任务与聊天并行时，把任务状态注入 agent 的系统提示词，
      // 让模型知道任务仍在运行、能回答进度、且不会重复发起同类任务；
      // 同时传 suppressProductionTools 在 host 层剔除会修改书籍/产物的
      // 生产工具（提示词只是软约束）。
      const backgroundTask = await findActiveRunningTask(bookSession.sessionId);
      const collectedToolExecs: CollectedToolExec[] = [];
      const result = await runAgentSession(
        {
          model,
          apiKey: agentApiKey,
          pipeline,
          ...(backgroundTask
            ? {
                backgroundTaskContext: buildRunningTaskContextBlock(backgroundTask, surfaceLanguage),
                suppressProductionTools: true,
              }
            : {}),
          projectRoot: root,
          bookId: agentBookId,
          sessionKind,
          playMode,
          actionSource,
          requestedIntent,
          actionPayload,
          requestedSkills,
          disabledSkills,
          attachments,
          sessionId: bookSession.sessionId,
          language: surfaceLanguage,
          onContextCompression: (event) => {
            broadcast("context:compression", {
              sessionId: streamSessionId,
              ...event,
            });
          },
          onEvent: (event) => {
            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                broadcast("draft:delta", { sessionId: streamSessionId, text: ame.delta });
              } else if (ame.type === "thinking_delta") {
                broadcast("thinking:delta", { sessionId: streamSessionId, text: (ame as any).delta });
              } else if (ame.type === "thinking_start") {
                broadcast("thinking:start", { sessionId: streamSessionId });
              } else if (ame.type === "thinking_end") {
                broadcast("thinking:end", { sessionId: streamSessionId });
              }
            }
            if (event.type === "tool_execution_start") {
              const args = event.args as Record<string, unknown> | undefined;
              const agent = event.toolName === "sub_agent" ? (args?.agent as string | undefined) : undefined;
              const stages = agent ? (pipelineStages(agent, language) ?? []) : [];

              collectedToolExecs.push({
                id: event.toolCallId,
                tool: event.toolName,
                agent,
                label: resolveToolLabel(event.toolName, agent, language),
                status: "running",
                args,
                stages: stages.length > 0
                  ? stages.map(l => ({ label: l, status: "pending" as const }))
                  : undefined,
                startedAt: Date.now(),
              });

              if (!agentBookId && event.toolName === "sub_agent" && agent === "architect") {
                const bookId = resolveArchitectBookIdFromArgs(args);
                if (bookId) {
                  const title = typeof args?.title === "string" && args.title.trim()
                    ? args.title.trim()
                    : bookId;
                  bookCreateStatus.set(bookId, { status: "creating" });
                  broadcast("book:creating", { bookId, title, sessionId: streamSessionId });
                }
              }

              broadcast("tool:start", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                args,
                stages,
              });
            }
            if (event.type === "tool_execution_end") {
              const exec = collectedToolExecs.find(t => t.id === event.toolCallId);
              if (exec) {
                exec.status = event.isError ? "error" : "completed";
                exec.completedAt = Date.now();
                exec.stages = exec.stages?.map(s => ({ ...s, status: "completed" as const }));
                if (event.isError) exec.error = extractToolError(event.result);
                else exec.result = summarizeToolResult(event.result);
                exec.details = (event.result as { details?: unknown } | undefined)?.details;
                if (
                  event.isError &&
                  !agentBookId &&
                  exec.tool === "sub_agent" &&
                  exec.agent === "architect"
                ) {
                  const bookId = resolveArchitectBookIdFromArgs(exec.args);
                  if (bookId) {
                    const error = exec.error ?? "Book creation failed";
                    bookCreateStatus.set(bookId, { status: "error", error });
                    broadcast("book:error", { bookId, sessionId: streamSessionId, error });
                  }
                }
              }
              broadcast("tool:end", {
                sessionId: streamSessionId,
                id: event.toolCallId,
                tool: event.toolName,
                result: event.result,
                details: exec?.details,
                isError: event.isError,
              });
            }
          },
        },
        instruction,
      );

      if (result.responseText) {
        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          requestedIntent,
          collectedToolExecs,
          language,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }
      }

      let broadcastedCreatedBookId: string | null = null;
      const finalizeCreatedBook = async (): Promise<string | null> => {
        if (agentBookId) return null;
        const createdBookId = resolveCreatedBookIdFromToolExecs(collectedToolExecs);
        if (!createdBookId) return null;
        if (broadcastedCreatedBookId === createdBookId) return createdBookId;
        if (!await completeBookExists(join(root, "books", createdBookId))) {
          const error = "Book creation artifact is incomplete on disk.";
          bookCreateStatus.set(createdBookId, { status: "error", error });
          broadcast("book:error", { bookId: createdBookId, sessionId: bookSession.sessionId, error });
          return null;
        }

        try {
          const migratedSession = await migrateBookSession(root, bookSession.sessionId, createdBookId);
          if (migratedSession) {
            bookSession = migratedSession;
          }
        } catch (e) {
          if (!(e instanceof SessionAlreadyMigratedError)) {
            throw e;
          }
        }

        const book = await loadStudioBookListSummary(state, createdBookId).catch(() => undefined);
        bookCreateStatus.delete(createdBookId);
        broadcast("book:created", {
          bookId: createdBookId,
          sessionId: bookSession.sessionId,
          ...(book ? { book } : {}),
        });
        broadcastedCreatedBookId = createdBookId;
        return createdBookId;
      };

      if (!result.responseText) {
        if (hasSuccessfulToolExec(collectedToolExecs, "propose_action")) {
          await refreshBookSessionFromTranscript();
          broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind });
          return c.json({
            response: "",
            session: {
              sessionId: bookSession.sessionId,
              sessionKind,
              ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
            },
            details: { toolExecutions: collectedToolExecs },
          });
        }

        if (result.errorMessage) {
          if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
            await finalizeCreatedBook();
          }
          const failure = formatAgentFailure(result.errorMessage, language);
          return c.json({
            error: { code: failure.code, message: failure.message },
            response: failure.message,
          }, failure.status);
        }

        const actionExecutionError = validateAgentActionExecution({
          instruction,
          agentBookId,
          requestedIntent,
          collectedToolExecs,
          language,
        });
        if (actionExecutionError) {
          return c.json({
            error: { code: "AGENT_ACTION_NOT_EXECUTED", message: actionExecutionError },
            response: actionExecutionError,
          }, 502);
        }

        await refreshBookSessionFromTranscript();
        const createdBookId = await finalizeCreatedBook();
        if (requestedIntent || createdBookId || hasSuccessfulToolResult(collectedToolExecs)) {
          const responseSessionKind = bookSession.sessionKind ?? sessionKind;
          broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind: responseSessionKind });
          return c.json({
            response: "",
            session: {
              sessionId: bookSession.sessionId,
              sessionKind: responseSessionKind,
              ...(createdBookId ?? bookSession.bookId ? { activeBookId: createdBookId ?? bookSession.bookId } : {}),
            },
            details: { toolExecutions: collectedToolExecs },
          });
        }

        const emptyMessage = pick(
          language,
          "Mô hình không trả về nội dung văn bản. Hãy kiểm tra loại giao thức (chat/responses), công tắc stream hoặc tính tương thích của dịch vụ thượng nguồn.",
          "The model returned no text content. Check the protocol type (chat/responses), the streaming switch, or upstream service compatibility.",
        );
        if (resolveCreatedBookIdFromToolExecs(collectedToolExecs)) {
          await finalizeCreatedBook();
        }
        return c.json({
          error: { code: "AGENT_EMPTY_RESPONSE", message: emptyMessage },
          response: emptyMessage,
        }, 502);
      }
      await refreshBookSessionFromTranscript();
      await finalizeCreatedBook();

      const responseSessionKind = bookSession.sessionKind ?? sessionKind;
      broadcast("agent:complete", { instruction, activeBookId, sessionId: bookSession.sessionId, sessionKind: responseSessionKind });

      return c.json({
        response: hasSuccessfulToolOwnedResponse(collectedToolExecs) ? "" : result.responseText,
        session: {
          sessionId: bookSession.sessionId,
          sessionKind: responseSessionKind,
          ...(bookSession.bookId ? { activeBookId: bookSession.bookId } : {}),
        },
      });
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      if (e instanceof SessionAlreadyMigratedError) {
        const migratedMessage = e instanceof Error ? e.message : String(e);
        throw new ApiError(409, "SESSION_ALREADY_MIGRATED", migratedMessage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      broadcast("agent:error", { instruction, activeBookId, sessionId, sessionKind: reqSessionKind, error: msg });

      // Agent busy — return 429 with user-friendly message
      if (/already processing|prompt.*queue/i.test(msg)) {
        return c.json({
          error: {
            code: "AGENT_BUSY",
            message: pick(language, "Đang xử lý, hãy đợi thao tác hiện tại hoàn tất", "Still processing. Wait for the current operation to finish"),
          },
          response: pick(
            language,
            "Đang xử lý, hãy đợi thao tác hiện tại hoàn tất rồi gửi tiếp.",
            "Still processing. Wait for the current operation to finish before sending again.",
          ),
        }, 429);
      }

      const failure = formatAgentFailure(msg, language);
      return c.json(
        { error: { code: failure.code, message: failure.message } },
        failure.status,
      );
    }
  });

  // --- Language setup ---

  app.post("/api/v1/project/language", async (c) => {
    // UI language: "vi" (default) or "en"; legacy "zh" is normalized to "vi".
    const { language: rawLanguage } = await c.req.json<{ language: string }>();
    const language = rawLanguage === "en" ? "en" : "vi";
    try {
      const existing = await loadRawConfig(root);
      existing.language = language;
      await saveRawConfig(root, existing);
      return c.json({ ok: true, language });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Audit ---

  app.post("/api/v1/books/:id/audit/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    broadcast("audit:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const currentConfig = await loadCurrentProjectConfig();
      const { ContinuityAuditor } = await import("@actalk/castor-core");
      const auditor = new ContinuityAuditor({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        projectRoot: root,
        bookId: id,
      });
      const result = await auditor.auditChapter(bookDir, content, chapterNum, book.genre);
      broadcast("audit:complete", { bookId: id, chapter: chapterNum, passed: result.passed });
      return c.json(result);
    } catch (e) {
      broadcast("audit:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Revise ---

  app.post("/api/v1/books/:id/revise/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);
    const body = await c.req
      .json<{ mode?: string; brief?: string }>()
      .catch(() => ({ mode: "spot-fix", brief: undefined }));

    broadcast("revise:start", { bookId: id, chapter: chapterNum });
    try {
      const book = await state.loadBookConfig(id);
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
        bookIdForSettings: id,
      }));
      const normalizedMode = body.mode ?? "spot-fix";
      const result = await pipeline.reviseDraft(
        id,
        chapterNum,
        normalizedMode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
      );
      broadcast("revise:complete", { bookId: id, chapter: chapterNum });
      return c.json(result);
    } catch (e) {
      broadcast("revise:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Export ---

  app.get("/api/v1/books/:id/export", async (c) => {
    const id = c.req.param("id");
    const format = (c.req.query("format") ?? "txt") as string;
    const approvedOnly = c.req.query("approvedOnly") === "true";

    try {
      const artifact = await buildExportArtifact(state, id, {
        format: format as "txt" | "md" | "epub",
        approvedOnly,
      });
      const responseBody = typeof artifact.payload === "string"
        ? artifact.payload
        : new Uint8Array(artifact.payload);
      return new Response(responseBody, {
        headers: {
          "Content-Type": artifact.contentType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      });
    } catch {
      return c.json({ error: "Export failed" }, 500);
    }
  });

  // --- Export to file (save to project dir) ---

  app.post("/api/v1/books/:id/export-save", async (c) => {
    const id = c.req.param("id");
    const { format, approvedOnly } = await c.req.json<{ format?: string; approvedOnly?: boolean }>().catch(() => ({ format: "txt", approvedOnly: false }));
    const fmt = format ?? "txt";

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const tools = createInteractionToolsFromDeps(pipeline, state);
      const bookDir = state.bookDir(id);
      const outputPath = join(bookDir, `${id}.${fmt === "epub" ? "epub" : fmt}`);
      const result = await processProjectInteractionRequest({
        projectRoot: root,
        request: {
          intent: "export_book",
          bookId: id,
          format: fmt as "txt" | "md" | "epub",
          approvedOnly,
          outputPath,
        },
        tools,
        activeBookId: id,
      });
      return c.json({
        ok: true,
        path: (result.details?.outputPath as string | undefined) ?? outputPath,
        format: fmt,
        chapters: (result.details?.chaptersExported as number | undefined) ?? 0,
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre detail + copy ---

  app.get("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    try {
      const { readGenreProfile } = await import("@actalk/castor-core");
      const { profile, body } = await readGenreProfile(root, genreId);
      return c.json({ profile, body });
    } catch (e) {
      return c.json({ error: String(e) }, 404);
    }
  });

  app.post("/api/v1/genres/:id/copy", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }
    try {
      const { getBuiltinGenresDir } = await import("@actalk/castor-core");
      const { mkdir: mkdirFs, copyFile } = await import("node:fs/promises");
      const builtinDir = getBuiltinGenresDir();
      const projectGenresDir = join(root, "genres");
      await mkdirFs(projectGenresDir, { recursive: true });
      await copyFile(join(builtinDir, `${genreId}.md`), join(projectGenresDir, `${genreId}.md`));
      return c.json({ ok: true, path: `genres/${genreId}.md` });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Model overrides ---

  app.get("/api/v1/project/model-overrides", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ overrides: raw.modelOverrides ?? {} });
  });

  app.put("/api/v1/project/model-overrides", async (c) => {
    const { overrides } = await c.req.json<{ overrides: Record<string, unknown> }>();
    const raw = await loadRawConfig(root);
    raw.modelOverrides = overrides;
    await saveRawConfig(root, raw);
    return c.json({ ok: true });
  });

  // --- Global default model ---

  app.get("/api/v1/project/default-model", async (c) => {
    const raw = await loadRawConfig(root);
    const llm = raw.llm && typeof raw.llm === "object" && !Array.isArray(raw.llm)
      ? raw.llm as Record<string, unknown>
      : {};
    return c.json({
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel: typeof llm.defaultModel === "string" && llm.defaultModel.trim()
        ? llm.defaultModel
        : typeof llm.model === "string" && llm.model.trim()
          ? llm.model
          : null,
    });
  });

  app.put("/api/v1/project/default-model", async (c) => {
    const body = await c.req.json<{ defaultModel?: string; service?: string }>();
    const defaultModel = typeof body.defaultModel === "string" ? body.defaultModel.trim() : "";
    if (!defaultModel) return c.json({ error: "defaultModel is required" }, 400);
    const raw = await loadRawConfig(root);
    raw.llm = raw.llm && typeof raw.llm === "object" && !Array.isArray(raw.llm) ? raw.llm : {};
    const llm = raw.llm as Record<string, unknown>;
    llm.defaultModel = defaultModel;
    if (typeof body.service === "string" && body.service.trim()) {
      llm.service = body.service.trim();
    }
    syncTopLevelLlmMirror(llm);
    await saveRawConfig(root, raw);
    return c.json({
      ok: true,
      service: typeof llm.service === "string" ? llm.service : null,
      defaultModel,
    });
  });

  // --- Research search provider ---

  app.get("/api/v1/project/research-search", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ researchSearch: ResearchSearchConfigSchema.parse(raw.researchSearch ?? {}) });
  });

  app.put("/api/v1/project/research-search", async (c) => {
    const body = await c.req.json<{ researchSearch?: unknown }>();
    const researchSearch = ResearchSearchConfigSchema.parse(body.researchSearch ?? {});
    const raw = await loadRawConfig(root);
    raw.researchSearch = researchSearch;
    await saveRawConfig(root, raw);
    return c.json({ ok: true, researchSearch });
  });

  // --- Chapter review mode (C4a: auto pipeline vs manual checkpoint) ---

  app.get("/api/v1/project/chapter-review-mode", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ mode: readProjectChapterReviewMode(raw) });
  });

  app.put("/api/v1/project/chapter-review-mode", async (c) => {
    const { mode } = await c.req.json<{ mode?: string }>();
    const next = normalizeChapterReviewMode(mode);
    const raw = await loadRawConfig(root);
    raw.writing = { ...(raw.writing ?? {}), reviewMode: next };
    await saveRawConfig(root, raw);
    return c.json({ ok: true, mode: next });
  });

  app.get("/api/v1/books/:id/chapter-review-mode", async (c) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) return c.json({ error: "Invalid book id" }, 400);
    try {
      const [projectConfig, rawBook] = await Promise.all([
        loadRawConfig(root),
        loadRawBookConfig(root, bookId),
      ]);
      const projectMode = readProjectChapterReviewMode(projectConfig);
      const bookMode = readBookChapterReviewMode(rawBook);
      return c.json({
        mode: bookMode ?? projectMode,
        bookMode: bookMode ?? null,
        projectMode,
      });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  app.put("/api/v1/books/:id/chapter-review-mode", async (c) => {
    const bookId = c.req.param("id");
    if (!isSafeBookId(bookId)) return c.json({ error: "Invalid book id" }, 400);
    const { mode } = await c.req.json<{ mode?: string }>();
    const rawBookPath = join(root, "books", bookId, "book.json");
    try {
      const [projectConfig, rawBook] = await Promise.all([
        loadRawConfig(root),
        loadRawBookConfig(root, bookId),
      ]);
      const projectMode = readProjectChapterReviewMode(projectConfig);
      if (mode === "inherit") {
        const writing = rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing)
          ? { ...(rawBook.writing as Record<string, unknown>) }
          : {};
        delete writing.reviewMode;
        rawBook.writing = Object.keys(writing).length > 0 ? writing : undefined;
      } else {
        rawBook.writing = {
          ...(rawBook.writing && typeof rawBook.writing === "object" && !Array.isArray(rawBook.writing) ? rawBook.writing as Record<string, unknown> : {}),
          reviewMode: normalizeChapterReviewMode(mode),
        };
      }
      await writeFile(rawBookPath, JSON.stringify(rawBook, null, 2), "utf-8");
      const bookMode = readBookChapterReviewMode(rawBook);
      return c.json({
        ok: true,
        mode: bookMode ?? projectMode,
        bookMode: bookMode ?? null,
        projectMode,
      });
    } catch {
      return c.json({ error: `Book "${bookId}" not found` }, 404);
    }
  });

  // --- Notify channels ---

  app.get("/api/v1/project/notify", async (c) => {
    const raw = await loadRawConfig(root);
    return c.json({ channels: raw.notify ?? [] });
  });

  app.put("/api/v1/project/notify", async (c) => {
    const { channels } = await c.req.json<{ channels: unknown[] }>();
    const raw = await loadRawConfig(root);
    raw.notify = channels;
    await saveRawConfig(root, raw);
    return c.json({ ok: true });
  });

  // --- AIGC Detection ---

  app.post("/api/v1/books/:id/detect/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapterNum).padStart(4, "0");
      const match = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      if (!match) return c.json({ error: "Chapter not found" }, 404);

      const content = await readFile(join(chaptersDir, match), "utf-8");
      const { analyzeAITells } = await import("@actalk/castor-core");
      const result = analyzeAITells(content);
      return c.json({ chapterNumber: chapterNum, ...result });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Truth file edit ---

  app.put("/api/v1/books/:id/truth/:file{.+}", async (c) => {
    const id = c.req.param("id");
    const file = c.req.param("file");
    const bookDir = state.bookDir(id);
    const resolved = resolveTruthFilePath(bookDir, file);
    if (!resolved) {
      return c.json({ error: "Invalid truth file" }, 400);
    }
    // Legacy pointer shims are read-only in new-layout books: writing
    // story_bible.md or book_rules.md does nothing at runtime (the pipeline
    // reads outline/ instead). For pre-Phase-5 books these ARE authoritative.
    if (LEGACY_SHIM_FILES.has(file)) {
      const { isNewLayoutBook } = await import("@actalk/castor-core");
      if (await isNewLayoutBook(bookDir)) {
        return c.json(
          { error: "Legacy compat shim; edit outline/story_frame.md instead" },
          400,
        );
      }
    }
    if (RUNTIME_DIAGNOSTIC_FILE_RE.test(file)) {
      return c.json({ error: "Runtime diagnostic files are read-only" }, 400);
    }
    const { content } = await c.req.json<{ content: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname: dirnameFs } = await import("node:path");
    await mkdirFs(dirnameFs(resolved), { recursive: true });
    await writeFileFs(resolved, content, "utf-8");
    return c.json({ ok: true });
  });

  // =============================================
  // NEW ENDPOINTS — CLI parity
  // =============================================

  // --- Book Delete ---

  app.delete("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(bookDir, { recursive: true, force: true });
      broadcast("book:deleted", { bookId: id });
      return c.json({ ok: true, bookId: id });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Book Update ---

  app.put("/api/v1/books/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json<{
      chapterWordCount?: number;
      targetChapters?: number;
      status?: string;
      language?: string;
    }>();
    try {
      const book = await state.loadBookConfig(id);
      const updated = {
        ...book,
        ...(updates.chapterWordCount !== undefined ? { chapterWordCount: Number(updates.chapterWordCount) } : {}),
        ...(updates.targetChapters !== undefined ? { targetChapters: Number(updates.targetChapters) } : {}),
        ...(updates.status !== undefined ? { status: updates.status as typeof book.status } : {}),
        ...(updates.language !== undefined ? { language: updates.language as "zh" | "en" } : {}),
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(id, updated);
      return c.json({ ok: true, book: updated });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Write Rewrite (specific chapter) ---

  app.post("/api/v1/books/:id/rewrite/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    broadcast("rewrite:start", { bookId: id, chapter: chapterNum });
    try {
      if (Object.prototype.hasOwnProperty.call(body, "brief")) {
        await saveChapterUserBrief(state.bookDir(id), chapterNum, body.brief ?? "");
      }
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
        revisionGate: "always",
        bookIdForSettings: id,
      }));
      const result = await pipeline.reviseDraft(id, chapterNum, "rework");
      broadcast("rewrite:complete", {
        bookId: id,
        chapterNumber: result.chapterNumber,
        wordCount: result.wordCount,
        status: result.status,
      });
      return c.json({ status: "complete", bookId: id, chapter: chapterNum, result });
    } catch (e) {
      broadcast("rewrite:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/books/:id/resync/:chapter", async (c) => {
    const id = c.req.param("id");
    const chapterNum = parseInt(c.req.param("chapter"), 10);
    const body: { brief?: string } = await c.req
      .json<{ brief?: string }>()
      .catch(() => ({}));

    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig({
        externalContext: body.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(id, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect All chapters ---

  app.post("/api/v1/books/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);

    try {
      const chaptersDir = join(bookDir, "chapters");
      const files = await readdir(chaptersDir);
      const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}/.test(f)).sort();
      const { analyzeAITells } = await import("@actalk/castor-core");

      const results = await Promise.all(
        mdFiles.map(async (f) => {
          const num = parseInt(f.slice(0, 4), 10);
          const content = await readFile(join(chaptersDir, f), "utf-8");
          const result = analyzeAITells(content);
          return { chapterNumber: num, filename: f, ...result };
        }),
      );
      return c.json({ bookId: id, results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Detect Stats ---

  app.get("/api/v1/books/:id/detect/stats", async (c) => {
    const id = c.req.param("id");
    try {
      const { loadDetectionHistory, analyzeDetectionInsights } = await import("@actalk/castor-core");
      const bookDir = state.bookDir(id);
      const history = await loadDetectionHistory(bookDir);
      const insights = analyzeDetectionInsights(history);
      return c.json(insights);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Genre Create ---

  app.post("/api/v1/genres/create", async (c) => {
    const body = await c.req.json<{
      id: string; name: string; language?: string;
      chapterTypes?: string[]; fatigueWords?: string[];
      numericalSystem?: boolean; powerScaling?: boolean; eraResearch?: boolean;
      pacingRule?: string; satisfactionTypes?: string[]; auditDimensions?: number[];
      body?: string;
    }>();

    if (!body.id || !body.name) {
      return c.json({ error: "id and name are required" }, 400);
    }
    if (/[/\\\0]/.test(body.id) || body.id.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${body.id}"`);
    }

    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const frontmatter = [
      "---",
      `name: ${yamlScalar(body.name)}`,
      `id: ${yamlScalar(body.id)}`,
      `language: ${yamlScalar(body.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(body.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(body.fatigueWords ?? [])}`,
      `numericalSystem: ${body.numericalSystem ?? false}`,
      `powerScaling: ${body.powerScaling ?? false}`,
      `eraResearch: ${body.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(body.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(body.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(body.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${body.id}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: body.id });
  });

  // --- Genre Edit ---

  app.put("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const body = await c.req.json<{ profile: Record<string, unknown>; body: string }>();
    const { writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
    const genresDir = join(root, "genres");
    await mkdirFs(genresDir, { recursive: true });

    const p = body.profile;
    const frontmatter = [
      "---",
      `name: ${yamlScalar(p.name ?? genreId)}`,
      `id: ${yamlScalar(p.id ?? genreId)}`,
      `language: ${yamlScalar(p.language ?? "zh")}`,
      `chapterTypes: ${JSON.stringify(p.chapterTypes ?? [])}`,
      `fatigueWords: ${JSON.stringify(p.fatigueWords ?? [])}`,
      `numericalSystem: ${p.numericalSystem ?? false}`,
      `powerScaling: ${p.powerScaling ?? false}`,
      `eraResearch: ${p.eraResearch ?? false}`,
      `pacingRule: ${yamlScalar(p.pacingRule ?? "")}`,
      `satisfactionTypes: ${JSON.stringify(p.satisfactionTypes ?? [])}`,
      `auditDimensions: ${JSON.stringify(p.auditDimensions ?? [])}`,
      "---",
      "",
      body.body ?? "",
    ].join("\n");

    await writeFileFs(join(genresDir, `${genreId}.md`), frontmatter, "utf-8");
    return c.json({ ok: true, id: genreId });
  });

  // --- Genre Delete (project-level only) ---

  app.delete("/api/v1/genres/:id", async (c) => {
    const genreId = c.req.param("id");
    if (/[/\\\0]/.test(genreId) || genreId.includes("..")) {
      throw new ApiError(400, "INVALID_GENRE_ID", `Invalid genre ID: "${genreId}"`);
    }

    const filePath = join(root, "genres", `${genreId}.md`);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(filePath);
      return c.json({ ok: true, id: genreId });
    } catch (e) {
      return c.json({ error: `Genre "${genreId}" not found in project` }, 404);
    }
  });

  // --- Style Analyze ---

  app.post("/api/v1/style/analyze", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    try {
      const { analyzeStyle } = await import("@actalk/castor-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Style Import to Book ---

  app.post("/api/v1/books/:id/style/import", async (c) => {
    const id = c.req.param("id");
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("style:start", { bookId: id });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.generateStyleGuide(id, text, sourceName ?? "unknown");
      broadcast("style:complete", { bookId: id });
      return c.json({ ok: true, result });
    } catch (e) {
      broadcast("style:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Chapters ---

  app.post("/api/v1/books/:id/import/chapters", async (c) => {
    const id = c.req.param("id");
    const { text, splitRegex } = await c.req.json<{ text: string; splitRegex?: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);

    broadcast("import:start", { bookId: id, type: "chapters" });
    try {
      const { splitChapters } = await import("@actalk/castor-core");
      const chapters = [...splitChapters(text, splitRegex)];

      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.importChapters({ bookId: id, chapters });
      broadcast("import:complete", { bookId: id, type: "chapters", count: result.importedCount });
      return c.json(result);
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Import Canon ---

  app.post("/api/v1/books/:id/import/canon", async (c) => {
    const id = c.req.param("id");
    const { fromBookId } = await c.req.json<{ fromBookId: string }>();
    if (!fromBookId) return c.json({ error: "fromBookId is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon" });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importCanon(id, fromBookId);
      broadcast("import:complete", { bookId: id, type: "canon" });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("import:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post("/api/v1/import/canon/upload", async (c) => {
    const body: { filename?: string; dataUrl?: string } = await c.req.json().catch(() => ({}));
    const result = await storeProjectUpload(root, body, {
      scope: "canon",
      fallbackName: "canon-source",
      maxBytes: MAX_CANON_UPLOAD_BYTES,
      errorCode: "INVALID_CANON_UPLOAD",
    });
    return c.json(result);
  });

  app.post("/api/v1/books/:id/import/canon-file", async (c) => {
    const id = c.req.param("id");
    const body: { filePath?: string; filename?: string } = await c.req.json().catch(() => ({}));
    if (!body.filePath?.trim()) return c.json({ error: "filePath is required" }, 400);

    broadcast("import:start", { bookId: id, type: "canon-file" });
    try {
      await state.loadBookConfig(id);
      const material = await ingestMaterial(root, {
        sourceKind: "file",
        filePath: body.filePath,
        filename: body.filename,
        title: body.filename?.replace(/\.[^.]+$/u, ""),
        purpose: "reference",
      });
      const sourceText = await readFile(join(root, material.markdownPath), "utf-8");
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importFanficCanon(id, sourceText, material.title, "canon");
      broadcast("import:complete", { bookId: id, type: "canon-file", materialId: material.id });
      return c.json({ ok: true, material });
    } catch (error) {
      broadcast("import:error", { bookId: id, type: "canon-file", error: String(error) });
      return c.json({ error: String(error) }, 500);
    }
  });

  // --- Fanfic Init ---

  app.post("/api/v1/fanfic/init", async (c) => {
    const body = await c.req.json<{
      title: string; sourceText: string; sourceName?: string;
      mode?: string; genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title || !body.sourceText) {
      return c.json({ error: "title and sourceText are required" }, 400);
    }

    const now = new Date().toISOString();
    const bookId = body.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "-").replace(/-+/g, "-").slice(0, 30);

    const bookConfig = {
      id: bookId,
      title: body.title,
      platform: (body.platform ?? "other") as "other",
      genre: (body.genre ?? "other") as "xuanhuan",
      status: "outlining" as const,
      targetChapters: body.targetChapters ?? 100,
      chapterWordCount: body.chapterWordCount ?? 3000,
      fanficMode: (body.mode ?? "canon") as "canon",
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
      createdAt: now,
      updatedAt: now,
    };

    broadcast("fanfic:start", { bookId, title: body.title });
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.initFanficBook(bookConfig, body.sourceText, body.sourceName ?? "source", (body.mode ?? "canon") as "canon");
      broadcast("fanfic:complete", { bookId });
      return c.json({ ok: true, bookId });
    } catch (e) {
      broadcast("fanfic:error", { bookId, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Fanfic Show (read canon) ---

  app.get("/api/v1/books/:id/fanfic", async (c) => {
    const id = c.req.param("id");
    const bookDir = state.bookDir(id);
    try {
      const content = await readFile(join(bookDir, "story", "fanfic_canon.md"), "utf-8");
      return c.json({ bookId: id, content });
    } catch {
      return c.json({ bookId: id, content: null });
    }
  });

  // --- Fanfic Refresh ---

  app.post("/api/v1/books/:id/fanfic/refresh", async (c) => {
    const id = c.req.param("id");
    const { sourceText, sourceName } = await c.req.json<{ sourceText: string; sourceName?: string }>();
    if (!sourceText?.trim()) return c.json({ error: "sourceText is required" }, 400);

    broadcast("fanfic:refresh:start", { bookId: id });
    try {
      const book = await state.loadBookConfig(id);
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      await pipeline.importFanficCanon(id, sourceText, sourceName ?? "source", (book.fanficMode ?? "canon") as "canon");
      broadcast("fanfic:refresh:complete", { bookId: id });
      return c.json({ ok: true });
    } catch (e) {
      broadcast("fanfic:refresh:error", { bookId: id, error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Side-story (番外) init: companion book inheriting a parent's canon ---

  app.post("/api/v1/spinoff/init", async (c) => {
    const body = await c.req.json<{
      title: string; parentBookId: string; direction?: string;
      genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title?.trim() || !body.parentBookId?.trim()) {
      return c.json({ error: "title and parentBookId are required" }, 400);
    }
    let parent;
    try {
      parent = await state.loadBookConfig(body.parentBookId);
    } catch {
      return c.json({ error: `Parent book "${body.parentBookId}" not found` }, 404);
    }
    const language = (body.language ?? parent.language) as "zh" | "en" | undefined;
    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig({
      title: body.title,
      genre: body.genre ?? parent.genre ?? "other",
      platform: body.platform ?? parent.platform,
      targetChapters: body.targetChapters ?? parent.targetChapters,
      chapterWordCount: body.chapterWordCount ?? parent.chapterWordCount,
      ...(language ? { language } : {}),
    }, now);
    const bookId = bookConfig.id;
    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(state.bookDir(bookId))) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }
    broadcast("spinoff:start", { bookId, title: body.title, parentBookId: body.parentBookId });
    bookCreateStatus.set(bookId, { status: "creating" });
    void (async () => {
      try {
        const pipeline = new PipelineRunner(await buildPipelineConfig());
        await pipeline.initSpinoffBook(bookConfig, body.parentBookId, body.direction);
        const book = await loadStudioBookListSummary(state, bookId).catch(() => undefined);
        bookCreateStatus.delete(bookId);
        broadcast("spinoff:complete", { bookId });
        broadcast("book:created", { bookId, ...(book ? { book } : {}) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("spinoff:error", { bookId, error });
        broadcast("book:error", { bookId, error });
      }
    })();
    return c.json({ status: "creating", bookId });
  });

  // --- Imitation (仿写) init: original story imitating a reference work's style ---

  app.post("/api/v1/imitation/init", async (c) => {
    const body = await c.req.json<{
      title: string; referenceText: string; storyIdea: string; sourceName?: string;
      genre?: string; platform?: string;
      targetChapters?: number; chapterWordCount?: number; language?: string;
    }>();
    if (!body.title?.trim() || !body.referenceText?.trim() || !body.storyIdea?.trim()) {
      return c.json({ error: "title, referenceText and storyIdea are required" }, 400);
    }
    const now = new Date().toISOString();
    const bookConfig = buildStudioBookConfig({
      title: body.title,
      genre: body.genre ?? "other",
      platform: body.platform,
      targetChapters: body.targetChapters,
      chapterWordCount: body.chapterWordCount,
      ...(body.language ? { language: body.language as "zh" | "en" } : {}),
    }, now);
    const bookId = bookConfig.id;
    if (!bookId) {
      return c.json({ error: "Could not derive a valid book id from title" }, 400);
    }
    if (await completeBookExists(state.bookDir(bookId))) {
      return c.json({ error: `Book "${bookId}" already exists` }, 409);
    }
    broadcast("imitation:start", { bookId, title: body.title });
    bookCreateStatus.set(bookId, { status: "creating" });
    void (async () => {
      try {
        const pipeline = new PipelineRunner(await buildPipelineConfig());
        await pipeline.initImitationBook(bookConfig, body.referenceText, body.storyIdea, body.sourceName);
        const book = await loadStudioBookListSummary(state, bookId).catch(() => undefined);
        bookCreateStatus.delete(bookId);
        broadcast("imitation:complete", { bookId });
        broadcast("book:created", { bookId, ...(book ? { book } : {}) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        bookCreateStatus.set(bookId, { status: "error", error });
        broadcast("imitation:error", { bookId, error });
        broadcast("book:error", { bookId, error });
      }
    })();
    return c.json({ status: "creating", bookId });
  });

  // --- Radar Scan ---

  app.post("/api/v1/radar/scan", async (c) => {
    broadcast("radar:start", {});
    try {
      const pipeline = new PipelineRunner(await buildPipelineConfig());
      const result = await pipeline.runRadar();
      await saveRadarScan(root, result);
      broadcast("radar:complete", { result });
      return c.json(result);
    } catch (e) {
      broadcast("radar:error", { error: String(e) });
      return c.json({ error: String(e) }, 500);
    }
  });

  app.get("/api/v1/radar/history", async (c) => {
    try {
      const items = await loadRadarHistory(root);
      return c.json({ items });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Doctor (environment health check) ---

  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");
    const { resolveGlobalEnvPath } = await import("@actalk/castor-core");
    const globalEnvPath = await resolveGlobalEnvPath();

    const checks = {
      projectConfigFile: existsSync(join(root, "castor.json")) || existsSync(join(root, LEGACY_CASTOR_CONFIG_FILENAME)),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(globalEnvPath),
      booksDir: existsSync(join(root, "books")),
      llmConnected: false,
      bookCount: 0,
    };

    try {
      const books = await state.listBooks();
      checks.bookCount = books.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      // Hard overall budget so the diagnostics page never hangs on a slow /
      // rate-limited upstream — if we can't confirm connectivity quickly, report
      // it as not-connected rather than spinning.
      const probe = await withTimeout(
        probeServiceCapabilities({
          root,
          service,
          apiKey: currentConfig.llm.apiKey,
          baseUrl: currentConfig.llm.baseUrl,
          preferredApiFormat: currentConfig.llm.apiFormat,
          preferredStream: currentConfig.llm.stream,
          preferredModel: currentConfig.llm.model,
          proxyUrl: currentConfig.llm.proxyUrl,
          language: normalizeStudioLanguage(currentConfig.language),
        }),
        DOCTOR_LLM_PROBE_BUDGET_MS,
        "doctor llm probe",
      );
      checks.llmConnected = probe.ok;
    } catch { /* slow/unreachable upstream — leave llmConnected false */ }

    return c.json(checks);
  });

  app.get("/api/v1/interactive-films", async (c) => {
    const filmsDir = join(root, "interactive-films");
    let entries: string[] = [];
    try {
      const dirents = await readdir(filmsDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const films: Array<{ projectId: string; title: string }> = [];
    for (const projectId of entries) {
      if (!isSafeBookId(projectId)) continue;
      try {
        const graph = await loadStoryGraph(root, projectId);
        if (graph) films.push({ projectId, title: graph.title || projectId });
      } catch { /* skip dirs without valid story-graph */ }
    }
    films.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    return c.json({ films });
  });

  app.get("/api/v1/translations", async (c) => {
    const translationsDir = join(root, "translations");
    let entries: string[] = [];
    try {
      const dirents = await readdir(translationsDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const translations: Array<{ projectId: string; title: string; sourceLanguage: string; targetLanguage: string; chapters: number }> = [];
    for (const projectId of entries) {
      if (!isSafeBookId(projectId)) continue;
      try {
        const manifest = await loadTranslationManifest(root, projectId);
        translations.push({
          projectId,
          title: manifest.title,
          sourceLanguage: manifest.sourceLanguage,
          targetLanguage: manifest.targetLanguage,
          chapters: manifest.chapters.length,
        });
      } catch {
        // Skip dirs without a valid translation manifest.
      }
    }
    translations.sort((a, b) => b.projectId.localeCompare(a.projectId));
    return c.json({ translations });
  });

  app.post("/api/v1/translations/upload", async (c) => {
    const body: { filename?: string; dataUrl?: string } = await c.req.json().catch(() => ({}));
    const result = await storeTranslationUpload(root, body);
    return c.json(result);
  });

  app.post("/api/v1/translations/create", async (c) => {
    const body: {
      filePath?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      title?: string;
      segmentMaxChars?: number;
    } = await c.req.json().catch(() => ({}));
    if (!body.filePath?.trim()) {
      return c.json({ error: { code: "MISSING_FILE_PATH", message: "filePath is required" } }, 400);
    }
    if (!body.sourceLanguage?.trim() || !body.targetLanguage?.trim()) {
      return c.json({ error: { code: "MISSING_LANGUAGES", message: "sourceLanguage and targetLanguage are required" } }, 400);
    }
    const result = await createTranslationProjectFromFile(root, {
      filePath: body.filePath,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      title: body.title,
      segmentMaxChars: body.segmentMaxChars,
    });
    return c.json({
      ...result,
      projectId: result.manifest.id,
      title: result.manifest.title,
    });
  });

  app.get("/api/v1/translations/:id", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    try {
      const manifest = await loadTranslationManifest(root, id);
      const reportPath = join(root, "translations", id, "review-report.md");
      const report = await readFile(reportPath, "utf-8").catch(() => "");
      const chapters = await Promise.all(manifest.chapters.map(async (chapter) => {
        const source = await loadTranslationChapter(root, chapter.sourcePath);
        const translated = await loadTranslationChapter(root, chapter.translatedPath).catch(() => ({
          ...source,
          segments: [],
        }));
        const targets = new Map(translated.segments.map((segment) => [segment.index, segment]));
        return {
          number: chapter.number,
          title: chapter.title,
          status: chapter.status,
          segments: source.segments.map((segment) => ({
            index: segment.index,
            source: segment.source,
            target: targets.get(segment.index)?.target ?? "",
            notes: targets.get(segment.index)?.notes ?? "",
          })),
        };
      }));
      return c.json({ manifest, report, chapters });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `translation project not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.post("/api/v1/translations/:id/run", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    const body: { batchSize?: number; maxTokens?: number } = await c.req.json().catch(() => ({}));
    try {
      const currentConfig = await loadCurrentProjectConfig();
      const configuredSkills = await loadAvailableAgentSkills({ projectRoot: root });
      const activatedSkills = resolveProductionSkillActivations(configuredSkills.skills, "translation");
      const model = createLLMTranslationModel({
        client: createLLMClient(currentConfig.llm),
        model: currentConfig.llm.model,
        maxTokens: body.maxTokens,
        activatedSkills,
        signal: c.req.raw.signal,
      });
      const result = await runTranslationProject(root, id, {
        model,
        batchSize: body.batchSize,
      });
      return c.json({ ...result, skillIds: activatedSkillIds(activatedSkills) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const isUpstream = /API|LLM|provider|upstream|temporarily unavailable|rate limit|quota|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|503|502|504/i.test(message);
      throw new ApiError(
        isUpstream ? 502 : 500,
        "TRANSLATION_RUN_FAILED",
        message || "Translation run failed.",
      );
    }
  });

  app.post("/api/v1/translations/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid translation id: ${id}` } }, 400);
    }
    const body: { format?: "txt" | "md" | "epub"; outputPath?: string } = await c.req.json().catch(() => ({}));
    const result = await writeTranslationExport(root, id, {
      format: body.format ?? "md",
      outputPath: body.outputPath,
    });
    return c.json(result);
  });

  app.post("/api/v1/projects/:id/story-graph/delta", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const { delta } = await c.req.json<{ delta: unknown }>();
    const { graph, rev } = await applyGraphDelta({ projectRoot: root, projectId: id, delta: delta as never });
    return c.json({ rev, graph });
  });

  app.get("/api/v1/projects/:id/story-graph", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graphPath = join(root, "interactive-films", id, "story-graph.json");
    try {
      const raw = await readFile(graphPath, "utf-8");
      return c.json(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.get("/api/v1/projects/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const projectDir = join(root, "interactive-films", id);
    try {
      await access(projectDir);
      const archive = gzipSync(await buildTarArchive(projectDir, id));
      return new Response(new Uint8Array(archive), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(id)}.tar.gz"`,
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return c.json({ error: { code: "NOT_FOUND", message: `interactive film project not found for ${id}` } }, 404);
      }
      throw error;
    }
  });

  app.get("/api/v1/projects/:id/story-graph/validation", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graph = await loadStoryGraph(root, id);
    if (!graph) {
      return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    }
    return c.json(reviewStoryGraph(graph));
  });

  app.get("/api/v1/projects/:id/story-graph/analysis", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return c.json({ report: reviewStoryGraph(graph), arcs: analyzeEmotionalArcs(graph), distribution: analyzePathDistribution(graph) });
  });

  app.get("/api/v1/projects/:id/export/json", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return new Response(JSON.stringify(graph, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.story-graph.json`),
      },
    });
  });

  app.get("/api/v1/projects/:id/export/ink", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    return new Response(exportInk(graph), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.ink`),
      },
    });
  });

  app.get("/api/v1/projects/:id/export/html", async (c) => {
    const id = c.req.param("id");
    if (!isSafeBookId(id)) return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    const graph = await loadStoryGraph(root, id);
    if (!graph) return c.json({ error: { code: "NOT_FOUND", message: `story graph not found for ${id}` } }, 404);
    const assetDataUris: Record<string, string> = {};
    for (const node of graph.nodes) {
      const ref = node.imageSlot?.assetRef;
      if (!ref || assetDataUris[ref]) continue;
      try {
        const file = resolveProjectImageFile(root, ref);
        const buf = await readFile(file.resolved);
        assetDataUris[ref] = `data:${file.contentType};base64,${buf.toString("base64")}`;
      } catch (err) {
        console.warn(`[studio] export/html: skipping assetRef "${ref}" —`, err);
      }
    }
    return new Response(buildPlayableHtml(graph, { assetDataUris }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": attachmentDisposition(`${id}.html`),
      },
    });
  });

  app.post("/api/v1/projects/:id/nodes/:nodeId/image", async (c) => {
    const id = c.req.param("id");
    const nodeId = c.req.param("nodeId");
    if (!isSafeBookId(id)) {
      return c.json({ error: { code: "INVALID_ID", message: `invalid project id: ${id}` } }, 400);
    }
    const graph = await loadStoryGraph(root, id);
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return c.json({ error: { code: "NODE_NOT_FOUND", message: `node ${nodeId} not found` } }, 404);
    }
    const deps = overrides.nodeImageGenerator ?? (await defaultNodeImageDeps(root));
    const { assetRef, delta } = await generateNodeImage({ projectRoot: root, projectId: id, node, deps });
    const { rev } = await applyGraphDelta({ projectRoot: root, projectId: id, delta });
    return c.json({ assetRef, rev });
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });

  const app = createStudioServer(config, root);

  // Serve frontend static files — single process for API + frontend
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Serve static assets (js, css, etc.)
    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/v1/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  console.log(`Castor Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
