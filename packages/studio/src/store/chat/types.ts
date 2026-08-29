import type { ActionPayload, ActionSource, PlayMode, RequestedIntent, SessionKind } from "@actalk/castor-core";

// -- Data types --

export interface ToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface PipelineStage {
  label: string;
  status: "pending" | "active" | "completed";
  progress?: {
    status?: string;          // "thinking" | "streaming" | ...
    elapsedMs: number;
    totalChars: number;
    chineseChars: number;
  };
}

export interface ToolExecution {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "processing" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: PipelineStage[];
  logs?: string[];
  startedAt: number;
  completedAt?: number;
  // Thẻ công cụ của tác vụ sản xuất nền (từ tool:start có cờ background hoặc khôi phục snapshot tác vụ).
  // Định tuyến dự phòng cho sự kiện không có executionId dựa vào đây để bỏ qua thẻ tác vụ, chỉ gắn thẻ công cụ của lượt chat.
  background?: boolean;
}

// -- Message parts (chronologically ordered for rendering) --

export type MessagePart =
  | { type: "thinking"; content: string; streaming: boolean }
  | { type: "text"; content: string }
  | { type: "tool"; execution: ToolExecution };

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly thinking?: string;
  readonly thinkingStreaming?: boolean;
  readonly timestamp: number;
  readonly toolCall?: ToolCall;
  readonly toolExecutions?: ToolExecution[];
  readonly parts?: MessagePart[];              // chronological parts for interleaved rendering
}

export interface SessionMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly thinking?: string;
  readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  readonly timestamp: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly sessionKind?: ChatSessionKind;
  readonly playMode?: PlayMode;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentResponse {
  readonly response?: string;
  readonly error?: string | { code?: string; message?: string };
  readonly details?: {
    readonly draftRaw?: string;
    readonly toolCall?: ToolCall;
    readonly toolExecutions?: ReadonlyArray<ToolExecution>;
  };
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
    readonly sessionKind?: ChatSessionKind;
    readonly playMode?: PlayMode;
    readonly title?: string | null;
    readonly activeBookId?: string;
    readonly creationDraft?: unknown;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly request?: unknown;
}

export interface SessionResponse {
  readonly session?: {
    readonly sessionId?: string;
    readonly bookId?: string | null;
    readonly sessionKind?: ChatSessionKind;
    readonly playMode?: PlayMode;
    readonly title?: string | null;
    readonly activeBookId?: string;
    readonly messages?: ReadonlyArray<SessionMessage>;
  };
  readonly activeBookId?: string;
  readonly task?: StudioTaskSnapshot;
}

export interface StudioTaskSnapshot {
  readonly version: 1;
  readonly sessionId: string;
  readonly sourceRequestId?: string;
  readonly requestedIntent: RequestedIntent;
  readonly execution: ToolExecution;
  readonly updatedAt: number;
}

// -- State interfaces --

export interface BookSummary {
  world: string;
  protagonist: string;
  cast: string;
}

export type ChatSessionKind = SessionKind;
export type ChatActionSource = ActionSource;
export type ChatRequestedIntent = RequestedIntent;
export type ChatActionPayload = ActionPayload;

export interface SendMessageOptions {
  readonly activeBookId?: string;
  readonly sessionKind?: ChatSessionKind;
  readonly actionSource?: ChatActionSource;
  readonly requestedIntent?: ChatRequestedIntent;
  readonly actionPayload?: ChatActionPayload;
  readonly requestedSkills?: ReadonlyArray<string>;
  readonly disabledSkills?: ReadonlyArray<string>;
  readonly attachments?: ReadonlyArray<ChatAttachmentPayload>;
  readonly playMode?: PlayMode;
}

// Tham số nguyên vẹn của lượt gửi chat thất bại (text và options của sendMessage),
// để nút "Thử lại" gửi lại chỉ với một cú nhấp.
export interface FailedSendRecord {
  readonly text: string;
  readonly options?: SendMessageOptions;
}

export interface ChatAttachmentPayload {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly size: number;
  readonly dataUrl: string;
}

export interface SessionRuntime {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly sessionKind?: ChatSessionKind;
  readonly playMode?: PlayMode;
  readonly title: string | null;
  readonly messages: ReadonlyArray<Message>;
  readonly stream: EventSource | null;
  // isStreaming = đang stream lượt chat HOẶC tác vụ sản xuất nền đang chạy (cho người đọc "phiên có bận không").
  readonly isStreaming: boolean;
  // isChatStreaming chỉ báo lượt chat đang stream; khi tác vụ nền chạy nó là false,
  // người dùng vẫn có thể gửi tin nhắn tiếp.
  readonly isChatStreaming: boolean;
  readonly lastError: string | null;
  // Bản ghi lượt gửi chat thất bại gần nhất: ghi khi yêu cầu thất bại (fetch bị từ chối, /agent trả về error, v.v.),
  // xóa khi một lượt gửi mới bắt đầu. Việc người dùng chủ động dừng và thất bại của lượt tác vụ nền không được ghi
  // (thẻ tác vụ có hiển thị thất bại riêng). Khi tồn tại và không stream chat, UI hiển thị nút "Thử lại".
  readonly lastFailedSend?: FailedSendRecord;
  // Phiên nháp chỉ tồn tại ở frontend, chưa được lưu xuống đĩa. Chỉ khi gửi tin nhắn đầu tiên mới gọi POST /sessions để lưu xuống.
  readonly isDraft: boolean;
}

export interface MessageState {
  sessions: Record<string, SessionRuntime>;
  sessionIdsByBook: Record<string, ReadonlyArray<string>>;
  activeSessionId: string | null;
  input: string;
  selectedModel: string | null;
  selectedService: string | null;
}

export interface CreateState {
  bookDataVersion: number;
  sidebarView: "panel" | "artifact";
  artifactFile: string | null;         // foundation file name, e.g. "story_bible.md"
  artifactChapter: number | null;      // chapter number, e.g. 1
  projectArtifactPath: string | null;  // generated project artifact, e.g. "interactive-films/demo/script.md"
  bookSummary: BookSummary | null;
  // Proposed-action cards (propose_action) are one-shot: once confirmed or
  // rejected, the card locks so the user can't re-fire the production action.
  // Keyed by the proposal's ToolExecution id.
  resolvedProposals: Record<string, "confirmed" | "rejected">;
}

export type ChatState = MessageState & CreateState;

// -- Action interfaces --

export interface MessageActions {
  activateSession: (sessionId: string | null) => void;
  setInput: (text: string) => void;
  addUserMessage: (sessionId: string, content: string) => void;
  appendStreamChunk: (sessionId: string, text: string, streamTs: number) => void;
  finalizeStream: (sessionId: string, streamTs: number, content: string, toolCall?: ToolCall) => void;
  replaceStreamWithError: (sessionId: string, streamTs: number, errorMsg: string) => void;
  addErrorMessage: (sessionId: string, errorMsg: string) => void;
  loadSessionMessages: (sessionId: string, msgs: ReadonlyArray<SessionMessage>) => void;
  loadSessionList: (bookId: string | null) => Promise<ReadonlyArray<SessionSummary>>;
  createSession: (bookId: string | null, sessionKind?: ChatSessionKind, playMode?: PlayMode) => Promise<string>;
  createDraftSession: (bookId: string | null, sessionKind?: ChatSessionKind, playMode?: PlayMode) => string;
  setSessionPlayMode: (sessionId: string, playMode: PlayMode) => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string, options?: SendMessageOptions) => Promise<void>;
  // Gửi lại tin nhắn thất bại gần nhất bằng tham số nguyên vẹn trong lastFailedSend; không làm gì nếu không có bản ghi hoặc đang stream chat.
  retryLastSend: (sessionId: string) => Promise<void>;
  // User stop aborts the complete workflow; navigation uses chat scope so a
  // background production task can keep running after its Pi turn is cancelled.
  abortSession: (sessionId: string, scope?: "all" | "chat") => Promise<void>;
  setSelectedModel: (model: string, service: string) => void;
}

export interface CreateActions {
  bumpBookDataVersion: () => void;
  openArtifact: (file: string) => void;
  openChapterArtifact: (chapterNum: number) => void;
  closeArtifact: () => void;
  openProjectArtifact: (path: string) => void;
  closeProjectArtifact: () => void;
  setBookSummary: (summary: BookSummary | null) => void;
  markProposalResolved: (execId: string, resolution: "confirmed" | "rejected") => void;
}

// -- Composed store type --

export type ChatStore = ChatState & MessageActions & CreateActions;
