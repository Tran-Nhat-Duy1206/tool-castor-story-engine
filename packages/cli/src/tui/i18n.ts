import type { ChatDepth } from "./chat-depth.js";
import { castorEnv } from "../utils.js";

export type TuiLocale = "vi-VN" | "en";

export interface TuiCopy {
  readonly locale: TuiLocale;
  readonly labels: {
    readonly project: string;
    readonly book: string;
    readonly depth: string;
    readonly session: string;
    readonly messageCount: (count: number) => string;
    readonly stage: string;
    readonly mode: string;
    readonly model: string;
    readonly error: string;
    readonly recent: string;
    readonly pending: string;
    readonly draft: string;
    readonly ready: string;
    readonly none: string;
    readonly notConfigured: string;
    readonly unknown: string;
  };
  readonly modeLabels: Record<string, string>;
  readonly composer: {
    readonly placeholder: string;
    readonly emptyConversation: string;
    readonly helper: string;
    readonly submitting: string;
    readonly failed: string;
    readonly ready: string;
  };
  readonly notes: {
    readonly help: string;
    readonly status: (stage: string, mode: string) => string;
    readonly config: string;
    readonly depthSet: (depthLabel: string) => string;
    readonly modelCurrent: (modelLabel: string) => string;
    readonly modelSet: (model: string) => string;
    readonly newBookGuide: string;
    readonly noLlmConfig: string;
    readonly setupProvider: string;
  };
  readonly roles: {
    readonly user: string;
    readonly assistant: string;
    readonly system: string;
  };
  readonly activity: Record<"thinking" | "checking" | "writing" | "reviewing" | "updating", string>;
  readonly stageLabels: {
    readonly completed: string;
    readonly failed: string;
    readonly blocked: string;
    readonly waitingHuman: string;
    readonly pausedByUser: string;
    readonly readyToContinue: string;
  };
  readonly depthLabels: Record<ChatDepth, string>;
}

const VI_VN: TuiCopy = {
  locale: "vi-VN",
  labels: {
    project: "Dự án",
    book: "Tác phẩm",
    depth: "Độ sâu",
    session: "Phiên",
    messageCount: (count) => `${count} tin nhắn`,
    stage: "Giai đoạn",
    mode: "Chế độ",
    model: "Model",
    error: "Lỗi",
    recent: "Gần đây",
    pending: "Chờ xác nhận",
    draft: "Bản nháp",
    ready: "Sẵn sàng",
    none: "Không",
    notConfigured: "chưa cấu hình",
    unknown: "không rõ",
  },
  modeLabels: {
    auto: "tự động",
    semi: "bán tự động",
    manual: "thủ công",
  },
  composer: {
    placeholder: "Nói cho Castor biết cần viết gì, sửa gì hoặc giải thích gì…",
    emptyConversation: "Hãy bắt đầu bằng việc nói cho Castor biết bạn muốn làm gì.",
    helper: "Enter để gửi • /new • /short • /play • /cover • /write • /confirm • /model • /depth • /help",
    submitting: "Đang xử lý…",
    failed: "Lần yêu cầu trước thất bại",
    ready: "Sẵn sàng",
  },
  notes: {
    help: "Lệnh khả dụng: /new (tạo sách), /short (truyện ngắn), /play (thế giới tương tác), /cover (bìa), /write (viết chương kế), /confirm, /cancel, /model [tên model], /status, /clear, /depth, /quit. Các yêu cầu thảo luận và sáng tạo khác dùng ngôn ngữ tự nhiên.",
    status: (stage, mode) => `Trạng thái hiện tại: ${stage} (${mode}).`,
    config: "Bảng điều khiển Ink chưa hỗ trợ /config tương tác. Hãy dùng castor config set-global.",
    depthSet: (depthLabel) => `Đã đổi độ sâu suy luận thành ${depthLabel}.`,
    modelCurrent: (modelLabel) => `Model hiện tại: ${modelLabel}.`,
    modelSet: (model) => `Model của phiên TUI hiện tại đã đổi thành ${model}.`,
    newBookGuide: "Bắt đầu phác thảo sách mới. Hãy mô tả ý tưởng của bạn — thể loại, thế giới quan, nhân vật chính, xung đột cốt lõi đều được. AI sẽ hướng dẫn từng bước và tự gọi năng lực tạo sách khi thông tin đã đủ.",
    noLlmConfig: "Chưa tìm thấy cấu hình LLM.",
    setupProvider: "Hãy cấu hình nhà cung cấp API trước.",
  },
  roles: {
    user: "Bạn",
    assistant: "Castor",
    system: "Hệ thống",
  },
  activity: {
    thinking: "đang suy nghĩ",
    checking: "đang kiểm tra",
    writing: "đang viết",
    reviewing: "đang duyệt",
    updating: "đang cập nhật",
  },
  stageLabels: {
    completed: "hoàn thành",
    failed: "thất bại",
    blocked: "bị chặn",
    waitingHuman: "chờ bạn quyết định",
    pausedByUser: "bị tạm dừng bởi người dùng",
    readyToContinue: "có thể tiếp tục",
  },
  depthLabels: {
    light: "nhẹ",
    normal: "tiêu chuẩn",
    deep: "sâu",
  },
};

const EN: TuiCopy = {
  locale: "en",
  labels: {
    project: "Project",
    book: "Book",
    depth: "Depth",
    session: "Session",
    messageCount: (count) => `${count} msgs`,
    stage: "Stage",
    mode: "Mode",
    model: "Model",
    error: "Error",
    recent: "Recent",
    pending: "Pending",
    draft: "Draft",
    ready: "Ready",
    none: "none",
    notConfigured: "not configured",
    unknown: "unknown",
  },
  modeLabels: {
    auto: "auto",
    semi: "semi",
    manual: "manual",
  },
  composer: {
    placeholder: "Ask Castor to write, revise, or explain…",
    emptyConversation: "Start by asking Castor what to do.",
    helper: "Enter to send • /new • /short • /play • /cover • /write • /confirm • /model • /depth • /help",
    submitting: "Submitting…",
    failed: "Last request failed",
    ready: "Ready",
  },
  notes: {
    help: "Commands: /new (book), /short, /play, /cover, /write, /confirm, /cancel, /model [model], /status, /clear, /depth, /quit. Use natural language for other discussion and creation requests.",
    status: (stage, mode) => `Status: ${stage} (${mode}).`,
    config: "Interactive /config is not available inside the Ink dashboard yet. Use castor config set-global.",
    depthSet: (depthLabel) => `Thinking depth set to ${depthLabel}.`,
    modelCurrent: (modelLabel) => `Current model: ${modelLabel}.`,
    modelSet: (model) => `Current TUI session model set to ${model}.`,
    newBookGuide: "Starting a new book. Describe your idea — genre, world, protagonist, core conflict, anything. The AI will guide you and call the book-creation capability when enough information is available.",
    noLlmConfig: "No LLM configuration found.",
    setupProvider: "Let's set up your API provider first.",
  },
  roles: {
    user: "You",
    assistant: "Castor",
    system: "System",
  },
  activity: {
    thinking: "thinking",
    checking: "checking",
    writing: "writing",
    reviewing: "reviewing",
    updating: "updating",
  },
  stageLabels: {
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
    waitingHuman: "waiting for your decision",
    pausedByUser: "paused by user",
    readyToContinue: "ready to continue",
  },
  depthLabels: {
    light: "light",
    normal: "normal",
    deep: "deep",
  },
};

export function resolveTuiLocale(
  env: NodeJS.ProcessEnv = process.env,
  preferredLanguage?: string,
): TuiLocale {
  const requested = normalizeLocale(castorEnv("CASTOR_TUI_LOCALE", env) ?? castorEnv("CASTOR_LOCALE", env));
  if (requested) {
    return requested;
  }

  const preferred = normalizeLocale(preferredLanguage);
  if (preferred) {
    return preferred;
  }

  const detected = normalizeLocale(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG);
  return detected ?? "vi-VN";
}

export function getTuiCopy(locale: TuiLocale): TuiCopy {
  return locale === "en" ? EN : VI_VN;
}

export function normalizeStageLabel(label: string, copy: TuiCopy): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return label;
  }

  const replacements: Array<[RegExp, string]> = [
    [/^thinking\b/i, copy.activity.thinking],
    [/^checking\b/i, copy.activity.checking],
    [/^writing\b/i, copy.activity.writing],
    [/^reviewing\b/i, copy.activity.reviewing],
    [/^updating\b/i, copy.activity.updating],
    [/^completed\b/i, copy.stageLabels.completed],
    [/^failed\b/i, copy.stageLabels.failed],
    [/^blocked\b/i, copy.stageLabels.blocked],
    [/^waiting_human\b/i, copy.stageLabels.waitingHuman],
    [/^paused by user\b/i, copy.stageLabels.pausedByUser],
    [/^ready to continue\b/i, copy.stageLabels.readyToContinue],
  ];

  for (const [pattern, value] of replacements) {
    if (pattern.test(label)) {
      // For English, keep the original label (already in English);
      // for other locales, use the translated value
      return copy.locale === "en" ? label : value;
    }
  }

  if (normalized === "idle") {
    return copy.labels.ready;
  }

  return label;
}

export function formatModeLabel(mode: string, copy: TuiCopy): string {
  return copy.modeLabels[mode] ?? mode;
}

function normalizeLocale(value: string | undefined): TuiLocale | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return undefined;
  }

  // Legacy product locale "zh" falls back to the Vietnamese default (spec §21.5).
  if (normalized.startsWith("vi")) {
    return "vi-VN";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return undefined;
}
