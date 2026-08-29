import { useEffect, useMemo, useState } from "react";
import type { BookCreationDraft } from "@actalk/castor-core";
import { BookPlus, CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  clearBookCreateSessionId,
  getBookCreateSessionId,
  setBookCreateSessionId,
} from "./chat-page-state";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

export interface BookCreateFormState {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly targetChapters: string;
  readonly chapterWordCount: string;
  readonly brief: string;
}

export interface BookCreatePayload {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly language: "zh" | "en";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly blurb: string;
}

export interface DraftSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface DraftSummaryStage {
  readonly key: string;
  readonly label: string;
  readonly status: "complete" | "partial" | "missing";
  readonly rows: ReadonlyArray<DraftSummaryRow>;
  readonly missing: ReadonlyArray<string>;
}

interface InteractionSessionResponse {
  readonly session?: {
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
  readonly activeBookId?: string;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly activeBookId?: string;
    readonly creationDraft?: BookCreationDraft;
  };
}

interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
  };
}

interface PlatformCopy {
  readonly idleTitle: string;
  readonly idleBody: string;
  readonly formHeading: string;
  readonly formHint: string;
  readonly titleLabel: string;
  readonly titlePlaceholder: string;
  readonly genreLabel: string;
  readonly genrePlaceholder: string;
  readonly platformLabel: string;
  readonly targetChaptersLabel: string;
  readonly chapterWordCountLabel: string;
  readonly briefLabel: string;
  readonly briefPlaceholder: string;
  readonly createBook: string;
  readonly creatingBook: string;
  readonly creationStatus: string;
  readonly creationSteps: ReadonlyArray<string>;
  readonly assistantHeading: string;
  readonly assistantHint: string;
  readonly applyDraft: string;
  readonly promptLabel: string;
  readonly promptPlaceholder: string;
  readonly promptPlaceholderFollowup: string;
  readonly submit: string;
  readonly submitting: string;
  readonly create: string;
  readonly creating: string;
  readonly discard: string;
  readonly draftHeading: string;
  readonly missingHeading: string;
  readonly missingHint: string;
  readonly syncedHint: string;
  readonly helperTitle: string;
  readonly helperBody: string;
}

const PLATFORMS_VI: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "Tomato Novel" },
  { value: "qidian", label: "Qidian" },
  { value: "feilu", label: "Feilu" },
  { value: "other", label: "Khác" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

const PAGE_COPY: Record<"vi" | "en", PlatformCopy> = {
  vi: {
    idleTitle: "Bắt đầu từ một ý tưởng còn mơ hồ",
    idleBody: "Hãy điền rõ tên sách, thể loại và cốt lõi câu chuyện trước; hệ thống sẽ tạo nền tảng và mở bàn làm việc cho sách mới.",
    formHeading: "Thông tin cơ bản của sách",
    formHint: "Các trường này đi thẳng vào quy trình tạo sách. Tóm tắt càng cụ thể thì nền tảng tạo ra càng vững.",
    titleLabel: "Tên sách",
    titlePlaceholder: "Ví dụ: Sổ cái cảng đêm",
    genreLabel: "Thể loại / Kiểu",
    genrePlaceholder: "Ví dụ: trinh thám đô thị, huyền huyễn, khoa học viễn tưởng, ngôn tình",
    platformLabel: "Nền tảng đích",
    targetChaptersLabel: "Số chương mục tiêu",
    chapterWordCountLabel: "Số chữ mỗi chương",
    briefLabel: "Tóm tắt truyện / Cài đặt cốt lõi",
    briefPlaceholder: "Nêu rõ thế giới quan, nhân vật chính, mục tiêu, xung đột cốt lõi và hướng giai đoạn đầu. Ví dụ: thành phố cảng tương lai gần, nhân vật chính là kế toán hàng lậu muốn rửa trắng nhưng bị những món nợ cũ kéo trở lại vụ án cổ ở cảng.",
    createBook: "Tạo sách",
    creatingBook: "Đang tạo…",
    creationStatus: "Đang tạo sách; bàn làm việc sẽ tự mở khi hoàn tất.",
    creationSteps: ["Ghi cấu hình sách", "Tạo nền tảng", "Chuẩn bị bàn làm việc"],
    assistantHeading: "Muốn AI giúp hoàn thiện cài đặt trước?",
    assistantHint: "Đây là bản nháp hỗ trợ, không bắt buộc. Nếu đã có bản nháp, có thể áp dụng vào biểu mẫu bên trái chỉ với một cú nhấp.",
    applyDraft: "Áp dụng bản nháp",
    promptLabel: "Tiếp tục trau chuốt cuốn sách này",
    promptPlaceholder: "Ví dụ: tôi muốn viết truyện trinh thám thương trường phong cách cảng biển, nhân vật chính làm nghề chợ đen rồi rửa trắng.",
    promptPlaceholderFollowup: "Ví dụ: đổi thế giới quan thành thành phố cảng tương lai gần; nữ chính xuất hiện muộn hơn; tập một đi điều tra sổ sách trước rồi mới ra tay.",
    submit: "Cập nhật bản nháp",
    submitting: "Đang xử lý…",
    create: "Tạo sách theo bản nháp hiện tại",
    creating: "Đang tạo…",
    discard: "Bỏ bản nháp",
    draftHeading: "Bản nháp nền tảng hiện tại",
    missingHeading: "Còn thiếu các thông tin quan trọng sau",
    missingHint: "Không cần điền đủ mọi trường ngay, nhưng thiếu quá nhiều thì đừng vội tạo sách.",
    syncedHint: "Bản nháp này được chia sẻ với TUI / Studio Chat.",
    helperTitle: "Gợi ý cách tiến hành",
    helperBody: "Chốt thế giới quan và nhân vật chính trước, rồi đến xung đột cốt lõi, tóm tắt và hướng tập một. Muốn xem bản nháp hiện tại, dùng /draft trong TUI.",
  },
  en: {
    idleTitle: "Start from a rough idea",
    idleBody: "Fill in the title, genre, and story core first. Castor will generate the foundation and open the new workspace.",
    formHeading: "Book basics",
    formHint: "These fields go straight into creation. A concrete brief gives the foundation generator better material.",
    titleLabel: "Title",
    titlePlaceholder: "Example: Ledger of the Night Port",
    genreLabel: "Genre",
    genrePlaceholder: "Example: mystery, urban fantasy, sci-fi, romance",
    platformLabel: "Target platform",
    targetChaptersLabel: "Target chapters",
    chapterWordCountLabel: "Words per chapter",
    briefLabel: "Story brief / core premise",
    briefPlaceholder: "Include the world, protagonist, goal, core conflict, and first arc direction.",
    createBook: "Create book",
    creatingBook: "Creating…",
    creationStatus: "Creating the book. The workspace will open automatically when it is ready.",
    creationSteps: ["Saving config", "Generating foundation", "Preparing workspace"],
    assistantHeading: "Want AI to shape the idea first?",
    assistantHint: "This draft area is optional. If a draft looks useful, apply it to the form.",
    applyDraft: "Apply draft",
    promptLabel: "Refine this book",
    promptPlaceholder: "Example: I want a harbor-noir business thriller about a fixer trying to go legit.",
    promptPlaceholderFollowup: "Example: move the world to a near-future port city; delay the heroine; make volume one about chasing ledgers first.",
    submit: "Update draft",
    submitting: "Working…",
    create: "Create book from draft",
    creating: "Creating…",
    discard: "Discard draft",
    draftHeading: "Current foundation draft",
    missingHeading: "Still missing",
    missingHint: "You do not need every field immediately, but do not create the book while the foundation is still vague.",
    syncedHint: "This draft is shared with TUI and Studio Chat.",
    helperTitle: "Recommended flow",
    helperBody: "Lock the world and protagonist first, then settle the conflict, blurb, and volume-one direction. In TUI, use /draft to inspect the same draft.",
  },
};

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: "vi" | "en"): string {
  return language === "en" ? "2000" : "3000";
}

export function defaultBookCreateForm(language: "vi" | "en"): BookCreateFormState {
  return {
    title: "",
    genre: "",
    platform: platformOptionsForLanguage(language)[0]?.value ?? "other",
    targetChapters: "200",
    chapterWordCount: defaultChapterWordsForLanguage(language),
    brief: "",
  };
}

export function platformOptionsForLanguage(language: "vi" | "en"): ReadonlyArray<PlatformOption> {
  return language === "en" ? PLATFORMS_EN : PLATFORMS_VI;
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isBookCreateFormReady(form: BookCreateFormState): boolean {
  return Boolean(
    form.title.trim()
      && form.genre.trim()
      && form.brief.trim()
      && parsePositiveInteger(form.targetChapters)
      && parsePositiveInteger(form.chapterWordCount),
  );
}

export function buildBookCreatePayload(
  form: BookCreateFormState,
  language: "zh" | "en",
): BookCreatePayload {
  const targetChapters = parsePositiveInteger(form.targetChapters);
  const chapterWordCount = parsePositiveInteger(form.chapterWordCount);
  if (!targetChapters || !chapterWordCount || !isBookCreateFormReady(form)) {
    throw new Error("Vui lòng hoàn tất biểu mẫu tạo sách trước.");
  }
  return {
    title: form.title.trim(),
    genre: form.genre.trim(),
    platform: form.platform,
    language,
    targetChapters,
    chapterWordCount,
    blurb: form.brief.trim(),
  };
}

export function resolveDraftInstruction(input: string, _hasDraft: boolean): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed;
}

// The story core that must be present to create. Length
// (targetChapters/chapterWordCount) is a run parameter with editable defaults,
// so it never gates creation — it's only shown in the basics stage. Mirrors
// missingCoreDraftFields in core/interaction/project-tools.ts.
export function canCreateFromDraft(draft?: BookCreationDraft): boolean {
  if (!draft) {
    return false;
  }
  return Boolean(
    draft.title?.trim()
      && draft.genre?.trim()
      && draft.platform?.trim()
      && draft.worldPremise?.trim()
      && draft.protagonist?.trim()
      && draft.conflictCore?.trim(),
  );
}

const DRAFT_STAGE_LABELS: Record<"vi" | "en", Record<string, string>> = {
  vi: {
    basic: "Thông tin cơ bản",
    world: "Thế giới quan & quy tắc",
    characters: "Nhân vật chính & dàn nhân vật",
    conflict: "Xung đột & phần thưởng",
    structure: "Cấu trúc & ràng buộc viết",
    title: "Tên sách",
    genre: "Thể loại",
    platform: "Nền tảng",
    language: "Ngôn ngữ",
    targetChapters: "Số chương mục tiêu",
    chapterWordCount: "Số chữ mỗi chương",
    worldPremise: "Thế giới quan",
    settingNotes: "Ghi chú cài đặt",
    protagonist: "Nhân vật chính",
    supportingCast: "Nhân vật phụ",
    conflictCore: "Xung đột cốt lõi",
    blurb: "Tóm tắt",
    authorIntent: "Ý định của tác giả",
    volumeOutline: "Hướng dàn ý tập",
    currentFocus: "Trọng tâm hiện tại",
    constraints: "Ràng buộc viết",
  },
  en: {
    basic: "Basics",
    world: "World & Rules",
    characters: "Protagonist & Cast",
    conflict: "Conflict & Payoff",
    structure: "Structure & Constraints",
    title: "Title",
    genre: "Genre",
    platform: "Platform",
    language: "Language",
    targetChapters: "Target Chapters",
    chapterWordCount: "Words per Chapter",
    worldPremise: "World",
    settingNotes: "Setting Notes",
    protagonist: "Protagonist",
    supportingCast: "Supporting Cast",
    conflictCore: "Core Conflict",
    blurb: "Blurb",
    authorIntent: "Author Intent",
    volumeOutline: "Volume Direction",
    currentFocus: "Current Focus",
    constraints: "Constraints",
  },
};

const DRAFT_STAGE_FIELDS: ReadonlyArray<{
  readonly key: string;
  readonly fields: ReadonlyArray<keyof BookCreationDraft>;
}> = [
  { key: "basic", fields: ["title", "genre", "platform", "targetChapters", "chapterWordCount", "language"] },
  { key: "world", fields: ["worldPremise", "settingNotes"] },
  { key: "characters", fields: ["protagonist", "supportingCast"] },
  { key: "conflict", fields: ["conflictCore", "blurb", "authorIntent"] },
  { key: "structure", fields: ["volumeOutline", "currentFocus", "constraints"] },
];

function draftValueAsText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function buildCreationDraftStages(
  draft: BookCreationDraft,
  language: "vi" | "en",
): ReadonlyArray<DraftSummaryStage> {
  const labels = DRAFT_STAGE_LABELS[language];
  const missingSet = new Set(draft.missingFields ?? []);

  return DRAFT_STAGE_FIELDS.map((stage) => {
    const rows: DraftSummaryRow[] = [];
    for (const field of stage.fields) {
      const value = draftValueAsText(draft[field]);
      if (value) {
        rows.push({ key: String(field), label: labels[field] ?? String(field), value });
      }
    }
    const missing = stage.fields
      .filter((field) => missingSet.has(field))
      .map((field) => labels[field] ?? String(field));
    const status = rows.length === 0
      ? "missing"
      : missing.length > 0
        ? "partial"
        : "complete";

    return {
      key: stage.key,
      label: labels[stage.key] ?? stage.key,
      status,
      rows,
      missing,
    };
  });
}

export function buildCreationDraftSummary(
  draft: BookCreationDraft,
  language: "vi" | "en",
): ReadonlyArray<DraftSummaryRow> {
  const rows = language === "en"
    ? [
        draft.title ? { key: "title", label: "Title", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "World", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "Protagonist", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "Core Conflict", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "Volume Direction", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "Blurb", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "Next", value: draft.nextQuestion } : undefined,
      ]
    : [
        draft.title ? { key: "title", label: "Tên sách", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "Thế giới quan", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "Nhân vật chính", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "Xung đột cốt lõi", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "Hướng dàn ý tập", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "Tóm tắt", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "Bước tiếp theo", value: draft.nextQuestion } : undefined,
      ];

  return rows.filter((row): row is DraftSummaryRow => Boolean(row));
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;
const CREATION_DRAFT_SYNC_INTERVAL_MS = 2500;

interface BookCreateSessionOptions {
  readonly fetchSession?: (sessionId: string) => Promise<SessionResponse>;
  readonly createSession?: () => Promise<SessionResponse>;
  readonly getStoredSessionId?: () => string | null;
  readonly setStoredSessionId?: (sessionId: string) => void;
  readonly clearStoredSessionId?: () => void;
}

let pendingDefaultBookCreateSessionId: Promise<string> | null = null;

function readSessionId(response: SessionResponse): string | null {
  const sessionId = response.session?.sessionId?.trim();
  return sessionId || null;
}

export function buildBookCreateAgentRequest(
  instruction: string,
  sessionId: string,
): {
  instruction: string;
  sessionId: string;
  sessionKind: "book-create";
  actionSource: "free-text" | "slash";
  requestedIntent?: "create_book";
} {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    throw new Error("Book create session is not ready.");
  }
  const trimmedInstruction = instruction.trim();
  return {
    instruction,
    sessionId: trimmedSessionId,
    sessionKind: "book-create",
    actionSource: trimmedInstruction.startsWith("/") ? "slash" : "free-text",
    ...(trimmedInstruction === "/create" ? { requestedIntent: "create_book" as const } : {}),
  };
}

export async function ensureBookCreateSessionId(
  options: BookCreateSessionOptions = {},
): Promise<string> {
  const usesDefaultDeps = Object.keys(options).length === 0;
  if (usesDefaultDeps && pendingDefaultBookCreateSessionId) {
    return pendingDefaultBookCreateSessionId;
  }

  const fetchSession = options.fetchSession
    ?? ((sessionId: string) => fetchJson<SessionResponse>(`/sessions/${encodeURIComponent(sessionId)}`));
  const createSession = options.createSession
    ?? (() => fetchJson<SessionResponse>("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: null, sessionKind: "book-create" }),
    }));
  const getStoredSessionId = options.getStoredSessionId ?? getBookCreateSessionId;
  const setStoredSessionId = options.setStoredSessionId ?? setBookCreateSessionId;
  const clearStoredSessionId = options.clearStoredSessionId ?? clearBookCreateSessionId;

  const resolveSessionId = async (): Promise<string> => {
    const storedSessionId = getStoredSessionId()?.trim();
    if (storedSessionId) {
      try {
        const existing = await fetchSession(storedSessionId);
        if (existing.session?.bookId === null) {
          return storedSessionId;
        }
      } catch {
        // Stale localStorage entry; fall through and create a fresh orphan session.
      }
      clearStoredSessionId();
    }

    const createdSessionId = readSessionId(await createSession());
    if (!createdSessionId) {
      throw new Error("Failed to create book session");
    }
    setStoredSessionId(createdSessionId);
    return createdSessionId;
  };

  if (!usesDefaultDeps) {
    return resolveSessionId();
  }

  pendingDefaultBookCreateSessionId = resolveSessionId().finally(() => {
    pendingDefaultBookCreateSessionId = null;
  });
  return pendingDefaultBookCreateSessionId;
}

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        if (status.status === "error") {
          throw new Error(status.error ?? `Book "${bookId}" failed to create`);
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(`Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(`Book "${bookId}" was not ready`);
}

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: project } = useApi<{ language: string }>("/project");
  // Legacy "zh" project language falls back to the Vietnamese default.
  const projectLang = (project?.language === "en" ? "en" : "vi") as "vi" | "en";
  const copy = PAGE_COPY[projectLang];
  const platformChoices = platformOptionsForLanguage(projectLang);

  const [draft, setDraft] = useState<BookCreationDraft | undefined>();
  const [form, setForm] = useState<BookCreateFormState>(() => defaultBookCreateForm(projectLang));
  const [input, setInput] = useState("");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bookCreateSessionId, setBookCreateSessionIdState] = useState<string | null>(null);

  const summaryStages = useMemo(
    () => (draft ? buildCreationDraftStages(draft, projectLang) : []),
    [draft, projectLang],
  );
  const canSubmitForm = isBookCreateFormReady(form);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      platform: pickValidValue(
        current.platform,
        platformOptionsForLanguage(projectLang).map((option) => option.value),
      ),
      chapterWordCount: current.chapterWordCount || defaultChapterWordsForLanguage(projectLang),
      targetChapters: current.targetChapters || "200",
    }));
  }, [projectLang]);

  const updateForm = (patch: Partial<BookCreateFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const applyDraftToForm = () => {
    if (!draft) {
      return;
    }
    const draftBrief = [
      draft.blurb,
      draft.worldPremise,
      draft.protagonist,
      draft.conflictCore,
      draft.volumeOutline,
    ].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
    const platformValues = platformChoices.map((option) => option.value);
    setForm((current) => ({
      title: draft.title?.trim() || current.title,
      genre: draft.genre?.trim() || current.genre,
      platform: pickValidValue(draft.platform ?? current.platform, platformValues),
      targetChapters: draft.targetChapters ? String(draft.targetChapters) : current.targetChapters,
      chapterWordCount: draft.chapterWordCount ? String(draft.chapterWordCount) : current.chapterWordCount,
      brief: draftBrief || current.brief,
    }));
  };

  const refreshDraft = async (): Promise<BookCreationDraft | undefined> => {
    const data = await fetchJson<InteractionSessionResponse>("/interaction/session");
    const nextDraft = data.session?.creationDraft;
    setDraft(nextDraft);
    return nextDraft;
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingDraft(true);
    void Promise.all([
      ensureBookCreateSessionId(),
      refreshDraft(),
    ])
      .then(([sessionId]) => {
        if (!cancelled) {
          setBookCreateSessionIdState(sessionId);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDraft(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (submitting || creating) {
      return;
    }

    const timer = setInterval(() => {
      void refreshDraft().catch(() => undefined);
    }, CREATION_DRAFT_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [submitting, creating]);

  const runAgentInstruction = async (instruction: string): Promise<AgentResponse> => {
    const sessionId = bookCreateSessionId ?? await ensureBookCreateSessionId();
    if (!bookCreateSessionId) {
      setBookCreateSessionIdState(sessionId);
    }
    return fetchJson<AgentResponse>("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBookCreateAgentRequest(instruction, sessionId)),
    });
  };

  const handleDraftSubmit = async () => {
    const instruction = resolveDraftInstruction(input, Boolean(draft));
    if (!instruction) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await runAgentInstruction(instruction);
      const createdBookId = data.session?.activeBookId;
      if (createdBookId) {
        setStatus(data.response ?? null);
        setDraft(undefined);
        await waitForBookReady(createdBookId);
        nav.toBook(createdBookId);
        return;
      }
      setInput("");
      setStatus(data.response ?? null);
      setDraft(data.session?.creationDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormCreate = async () => {
    if (!canSubmitForm) {
      return;
    }

    setCreating(true);
    setError(null);
    setStatus(copy.creationStatus);
    try {
      // Book language stays "zh" | "en"; Vietnamese UI defaults to a zh book.
      const payload = buildBookCreatePayload(form, projectLang === "en" ? "en" : "zh");
      const data = await fetchJson<{ status?: string; bookId?: string }>("/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data.bookId) {
        throw new Error(projectLang === "vi" ? "Yêu cầu tạo sách không trả về ID sách." : "Create request did not return a book id.");
      }
      await waitForBookReady(data.bookId);
      nav.toBook(data.bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus(null);
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!canCreateFromDraft(draft)) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/create");
      const bookId = data.session?.activeBookId;
      if (!bookId) {
        throw new Error(projectLang === "vi" ? "Đã tạo xong nhưng không trả về ID sách." : "Create succeeded but no book id was returned.");
      }
      setStatus(data.response ?? null);
      setDraft(undefined);
      await waitForBookReady(bookId);
      nav.toBook(bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const handleDiscard = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await runAgentInstruction("/discard");
      setStatus(data.response ?? null);
      setDraft(undefined);
      setInput("");
      await refreshDraft().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      <div className="space-y-3">
        <h1 className="font-serif text-4xl">{t("create.title")}</h1>
        <p className="text-sm text-muted-foreground leading-7 max-w-2xl">{copy.idleBody}</p>
      </div>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3`}>
          {error}
        </div>
      )}

      {status && (
        <div className="border border-primary/20 bg-primary/5 rounded-md px-4 py-3 text-sm text-primary">
          {status}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-5">
          <div className="space-y-1">
            <div className="text-[11px] uppercase text-muted-foreground font-bold">
              {copy.formHeading}
            </div>
            <p className="text-xs text-muted-foreground leading-6">{copy.formHint}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
                placeholder={copy.titlePlaceholder}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.genreLabel}</span>
              <input
                value={form.genre}
                onChange={(event) => updateForm({ genre: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
                placeholder={copy.genrePlaceholder}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.platformLabel}</span>
              <select
                value={form.platform}
                onChange={(event) => updateForm({ platform: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm bg-background`}
              >
                {platformChoices.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.targetChaptersLabel}</span>
              <input
                type="number"
                min={1}
                value={form.targetChapters}
                onChange={(event) => updateForm({ targetChapters: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{copy.chapterWordCountLabel}</span>
              <input
                type="number"
                min={1000}
                value={form.chapterWordCount}
                onChange={(event) => updateForm({ chapterWordCount: event.target.value })}
                className={`w-full ${c.input} rounded-md px-3 py-2.5 focus:outline-none text-sm`}
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs font-medium text-muted-foreground">{copy.briefLabel}</span>
            <textarea
              value={form.brief}
              onChange={(event) => updateForm({ brief: event.target.value })}
              rows={9}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={copy.briefPlaceholder}
            />
          </label>

          {creating && (
            <div className="grid gap-2 sm:grid-cols-3">
              {copy.creationSteps.map((step) => (
                <div key={step} className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <CheckCircle2 size={14} />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleFormCreate}
            disabled={!canSubmitForm || creating || submitting}
            className={`inline-flex items-center gap-2 px-5 py-3 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
          >
            <BookPlus size={16} />
            {creating ? copy.creatingBook : copy.createBook}
          </button>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.assistantHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.assistantHint}</p>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={7}
              className={`w-full ${c.input} rounded-md px-3 py-3 focus:outline-none text-sm leading-7 resize-y`}
              placeholder={draft ? copy.promptPlaceholderFollowup : copy.promptPlaceholder}
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDraftSubmit}
                disabled={submitting || creating || !input.trim()}
                className={`inline-flex items-center gap-2 px-3 py-2 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-xs`}
              >
                <Sparkles size={14} />
                {submitting ? copy.submitting : copy.submit}
              </button>
              <button
                onClick={handleDiscard}
                disabled={!draft || submitting || creating}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
              >
                <RotateCcw size={14} />
                {copy.discard}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/80 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground font-bold">
                {copy.draftHeading}
              </div>
              <p className="text-xs text-muted-foreground leading-6">{copy.syncedHint}</p>
            </div>

            {loadingDraft ? (
              <div className="text-sm text-muted-foreground">{projectLang === "vi" ? "Đang tải bản nháp…" : "Loading draft…"}</div>
            ) : draft ? (
              <div className="space-y-4">
                {summaryStages.some((stage) => stage.rows.length > 0) ? (
                  <div className="space-y-3">
                    {summaryStages.map((stage) => (
                      <div key={stage.key} className="rounded-md border border-border/50 bg-background/70 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[10px] uppercase text-muted-foreground font-semibold">{stage.label}</div>
                          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {stage.status === "complete"
                              ? (projectLang === "vi" ? "Đã đủ" : "Ready")
                              : stage.status === "partial"
                                ? (projectLang === "vi" ? "Cần bổ sung" : "Partial")
                                : (projectLang === "vi" ? "Chưa bắt đầu" : "Missing")}
                          </span>
                        </div>
                        {stage.rows.length > 0 ? (
                          <div className="mt-2 space-y-2">
                            {stage.rows.map((row) => (
                              <div key={row.key}>
                                <div className="text-[10px] uppercase text-muted-foreground">{row.label}</div>
                                <div className="mt-0.5 text-sm leading-6 whitespace-pre-wrap">{row.value}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {stage.missing.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {stage.missing.map((field) => (
                              <span key={field} className="rounded-md bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                                {field}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {draft.missingFields.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">{copy.missingHeading}</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.missingFields.map((field) => (
                        <span
                          key={field}
                          className="rounded-md border border-border/70 bg-secondary/50 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground leading-6">{copy.missingHint}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={applyDraftToForm}
                    className="px-3 py-2 rounded-md border border-border bg-secondary text-secondary-foreground font-medium text-xs"
                  >
                    {copy.applyDraft}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!canCreateFromDraft(draft) || creating || submitting}
                    className="px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-50 font-medium text-xs"
                  >
                    {creating ? copy.creating : copy.create}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-4 py-5">
                <div className="font-medium">{copy.idleTitle}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-7">
                  {copy.helperBody}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
