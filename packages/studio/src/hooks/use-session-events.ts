import type { SSEMessage } from "./use-sse";
import { useNewSSEMessages } from "./use-sse";
import type { HashRoute } from "./use-hash-route";
import { useChatStore } from "../store/chat";
import { bookKey, mergeSessionIds, updateSession } from "../store/chat/slices/message/runtime";
import { clearBookCreateSessionId, getBookCreateSessionId } from "../pages/chat-page-state";

/**
 * Lắng nghe hai loại thông báo liên quan đến session trong sự kiện SSE toàn cục:
 * - session:title — đẩy sau khi AI tự tạo tiêu đề, cập nhật hiển thị thanh bên
 * - book:created  — đẩy sau khi tạo sách thành công, chuyển session từ null sang sách mới, xóa localStorage, điều hướng
 *
 * Cursor-based consumption matters because React may batch multiple SSE state
 * updates into one render; looking only at messages.at(-1) drops middle events.
 */
export function useSessionEvents(
  sse: { messages: ReadonlyArray<SSEMessage> },
  route: HashRoute,
  setRoute: (route: HashRoute) => void,
): void {
  useNewSSEMessages(sse.messages, (recent) => {
    if (recent.event === "session:title") {
      const data = recent.data as { sessionId?: string; title?: string } | null;
      if (!data?.sessionId || !data.title) return;
      const { sessionId, title } = data;
      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ title })),
        };
      });
      return;
    }

    if (recent.event === "book:created") {
      const data = recent.data as { sessionId?: string; bookId?: string } | null;
      if (!data?.sessionId || !data.bookId) return;
      const { sessionId, bookId } = data;

      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        const previousKey = bookKey(session.bookId);
        const nextKey = bookKey(bookId);
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ bookId })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [previousKey]: (state.sessionIdsByBook[previousKey] ?? []).filter((id) => id !== sessionId),
            [nextKey]: mergeSessionIds(state.sessionIdsByBook[nextKey], [sessionId]),
          },
        };
      });

      if (getBookCreateSessionId() === sessionId) {
        clearBookCreateSessionId();
        if (route.page === "book-create") {
          setRoute({ page: "book", bookId });
        }
      }
    }
  });
}
