import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchNotification } from "../notify/dispatcher.js";
import { stripMarkdownMarks } from "../notify/format.js";
import { NotifyChannelSchema } from "../models/project.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true });
});

function lastRequestBody(): Record<string, unknown> {
  const [, opts] = mockFetch.mock.calls[0]!;
  return JSON.parse(opts.body);
}

const message = {
  title: "mock_text Chương 4",
  body: "**Chương mock_text** | 3000 từ\n- [major] mock_text",
};

describe("NotifyChannelSchema format field", () => {
  it("defaults format to markdown for backward compatibility", () => {
    const telegram = NotifyChannelSchema.parse({
      type: "telegram",
      botToken: "123:ABC",
      chatId: "-100123",
    });
    expect(telegram.format).toBe("markdown");

    const webhook = NotifyChannelSchema.parse({
      type: "webhook",
      url: "https://example.com/hook",
    });
    expect(webhook.format).toBe("markdown");
  });

  it("accepts text format on every channel type", () => {
    const feishu = NotifyChannelSchema.parse({
      type: "feishu",
      webhookUrl: "https://open.feishu.cn/webhook/xxx",
      format: "text",
    });
    expect(feishu.format).toBe("text");

    const wechatWork = NotifyChannelSchema.parse({
      type: "wechat-work",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
      format: "text",
    });
    expect(wechatWork.format).toBe("text");
  });

  it("rejects unknown format values", () => {
    expect(() =>
      NotifyChannelSchema.parse({
        type: "telegram",
        botToken: "123:ABC",
        chatId: "-100123",
        format: "html",
      }),
    ).toThrow();
  });
});

describe("stripMarkdownMarks", () => {
  it("strips bold, inline code and code fences", () => {
    expect(stripMarkdownMarks("**bold** and `code`")).toBe("bold and code");
    expect(stripMarkdownMarks("```ts\nconst a = 1;\n```")).toBe("const a = 1;\n");
  });
});

describe("dispatchNotification telegram formats", () => {
  it("markdown format keeps parse_mode and bold title", async () => {
    await dispatchNotification(
      [{ type: "telegram", botToken: "123:ABC", chatId: "-100", format: "markdown" }],
      message,
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = lastRequestBody();
    expect(body.parse_mode).toBe("Markdown");
    expect(body.text).toBe("**mock_text Chương 4**\n\n**Chương mock_text** | 3000 từ\n- [major] mock_text");
  });

  it("text format omits parse_mode and strips markdown marks", async () => {
    await dispatchNotification(
      [{ type: "telegram", botToken: "123:ABC", chatId: "-100", format: "text" }],
      message,
    );

    const body = lastRequestBody();
    expect(body).not.toHaveProperty("parse_mode");
    expect(body.text).toBe("mock_text Chương 4\n\nChương mock_text | 3000 từ\n- [major] mock_text");
  });
});

describe("dispatchNotification wechat-work formats", () => {
  it("markdown format keeps msgtype markdown", async () => {
    await dispatchNotification(
      [{ type: "wechat-work", webhookUrl: "https://qyapi.weixin.qq.com/hook", format: "markdown" }],
      message,
    );

    const body = lastRequestBody();
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown).toEqual({
      content: "**mock_text Chương 4**\n\n**Chương mock_text** | 3000 từ\n- [major] mock_text",
    });
  });

  it("text format sends msgtype text with plain content", async () => {
    await dispatchNotification(
      [{ type: "wechat-work", webhookUrl: "https://qyapi.weixin.qq.com/hook", format: "text" }],
      message,
    );

    const body = lastRequestBody();
    expect(body.msgtype).toBe("text");
    expect(body.text).toEqual({
      content: "mock_text Chương 4\n\nChương mock_text | 3000 từ\n- [major] mock_text",
    });
    expect(body).not.toHaveProperty("markdown");
  });
});

describe("dispatchNotification feishu formats", () => {
  it("markdown format keeps the interactive card", async () => {
    await dispatchNotification(
      [{ type: "feishu", webhookUrl: "https://open.feishu.cn/hook", format: "markdown" }],
      message,
    );

    const body = lastRequestBody();
    expect(body.msg_type).toBe("interactive");
    const card = body.card as {
      header: { title: { content: string } };
      elements: Array<{ tag: string; content: string }>;
    };
    expect(card.header.title.content).toBe("mock_text Chương 4");
    expect(card.elements[0]).toEqual({ tag: "markdown", content: message.body });
  });

  it("text format sends msg_type text with title and plain body combined", async () => {
    await dispatchNotification(
      [{ type: "feishu", webhookUrl: "https://open.feishu.cn/hook", format: "text" }],
      message,
    );

    const body = lastRequestBody();
    expect(body.msg_type).toBe("text");
    expect(body.content).toEqual({
      text: "mock_text Chương 4\n\nChương mock_text | 3000 từ\n- [major] mock_text",
    });
    expect(body).not.toHaveProperty("card");
  });
});

describe("dispatchNotification webhook format", () => {
  it("includes the channel format in the JSON payload data", async () => {
    await dispatchNotification(
      [{ type: "webhook", url: "https://example.com/hook", events: [], format: "text" }],
      message,
    );

    const body = lastRequestBody();
    expect(body.event).toBe("pipeline-complete");
    expect(body.data).toEqual({
      title: message.title,
      body: message.body,
      format: "text",
    });
  });
});
