import { describe, expect, it } from "vitest";
import { isConfirmedProductionSend, shouldRefreshSidebarForTool } from "./message-policy";

describe("shouldRefreshSidebarForTool", () => {
  it("does not refresh for read-only tools", () => {
    expect(shouldRefreshSidebarForTool("read")).toBe(false);
    expect(shouldRefreshSidebarForTool("grep")).toBe(false);
    expect(shouldRefreshSidebarForTool("ls")).toBe(false);
  });

  it("refreshes for mutating and unknown tools", () => {
    expect(shouldRefreshSidebarForTool("edit")).toBe(true);
    expect(shouldRefreshSidebarForTool("sub_agent")).toBe(true);
    expect(shouldRefreshSidebarForTool("some_future_tool")).toBe(true);
  });
});

describe("isConfirmedProductionSend", () => {
  it("treats confirmed production intents from button/slash as production sends", () => {
    expect(isConfirmedProductionSend("button", "create_book")).toBe(true);
    expect(isConfirmedProductionSend("slash", "short_run")).toBe(true);
    expect(isConfirmedProductionSend("button", "fanfic_init")).toBe(true);
    expect(isConfirmedProductionSend("button", "continuation_import")).toBe(true);
    expect(isConfirmedProductionSend("button", "spinoff_create")).toBe(true);
    expect(isConfirmedProductionSend("button", "style_imitation")).toBe(true);
  });

  it("treats quick-action write-next as a production send", () => {
    // mock_val（actionSource=quick-action），mock_val
    // mock_val；mock_val，mock_val。
    expect(isConfirmedProductionSend("quick-action", "write_next")).toBe(true);
    expect(isConfirmedProductionSend("button", "write_next")).toBe(true);
  });

  it("does not treat other sources or non-production intents as production sends", () => {
    expect(isConfirmedProductionSend("free-text", "write_next")).toBe(false);
    expect(isConfirmedProductionSend("quick-action", "create_book")).toBe(false);
    expect(isConfirmedProductionSend("button", "edit_artifact")).toBe(false);
    expect(isConfirmedProductionSend("button", undefined)).toBe(false);
  });
});
