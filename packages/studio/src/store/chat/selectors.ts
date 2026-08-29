import type { ChatState } from "./types";

const EMPTY_MESSAGES: readonly [] = [];

export const chatSelectors = {
  activeSession: (s: ChatState) => (s.activeSessionId ? s.sessions[s.activeSessionId] ?? null : null),
  activeMessages: (s: ChatState) =>
    (s.activeSessionId ? s.sessions[s.activeSessionId]?.messages : undefined) ?? EMPTY_MESSAGES,
  isActiveSessionStreaming: (s: ChatState) => Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.isStreaming),
  // Bản thân lượt chat có đang stream hay không; là false khi tác vụ nền đang chạy (lúc đó vẫn có thể gửi tin nhắn tiếp).
  isActiveSessionChatStreaming: (s: ChatState) =>
    Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.isChatStreaming),
  // Bản ghi lượt gửi chat thất bại gần nhất; khi tồn tại và không stream chat, UI hiển thị nút "Thử lại".
  activeSessionLastFailedSend: (s: ChatState) =>
    (s.activeSessionId ? s.sessions[s.activeSessionId]?.lastFailedSend : undefined) ?? null,
  isEmpty: (s: ChatState) =>
    ((s.activeSessionId ? s.sessions[s.activeSessionId]?.messages.length : 0) ?? 0) === 0
    && !Boolean(s.activeSessionId && s.sessions[s.activeSessionId]?.isStreaming),
};
