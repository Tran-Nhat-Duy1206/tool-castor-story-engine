import { describe, expect, it } from "vitest";
import { classifyLocalTuiCommand, parseDepthCommand, parseModelCommand } from "../tui/local-commands.js";

describe("tui local commands", () => {
  it("recognizes help aliases", () => {
    expect(classifyLocalTuiCommand("/help")).toBe("help");
    expect(classifyLocalTuiCommand("help")).toBe("help");
    expect(classifyLocalTuiCommand("test_mock")).toBe("help");
  });

  it("recognizes status aliases", () => {
    expect(classifyLocalTuiCommand("/status")).toBe("status");
    expect(classifyLocalTuiCommand("status")).toBe("status");
    expect(classifyLocalTuiCommand("test_mock")).toBe("status");
  });

  it("recognizes quit aliases", () => {
    expect(classifyLocalTuiCommand("/quit")).toBe("quit");
    expect(classifyLocalTuiCommand("/exit")).toBe("quit");
    expect(classifyLocalTuiCommand("quit")).toBe("quit");
    expect(classifyLocalTuiCommand("exit")).toBe("quit");
    expect(classifyLocalTuiCommand("bye")).toBe("quit");
    expect(classifyLocalTuiCommand("test_mock")).toBe("quit");
  });

  it("recognizes config and clear aliases", () => {
    expect(classifyLocalTuiCommand("/config")).toBe("config");
    expect(classifyLocalTuiCommand("test_mock")).toBe("config");
    expect(classifyLocalTuiCommand("/clear")).toBe("clear");
    expect(classifyLocalTuiCommand("test_mock")).toBe("clear");
  });

  it("returns undefined for normal chat input", () => {
    expect(classifyLocalTuiCommand("hi")).toBeUndefined();
    expect(classifyLocalTuiCommand("continue current book")).toBeUndefined();
  });

  it("parses depth commands", () => {
    expect(parseDepthCommand("/depth deep")).toBe("deep");
    expect(parseDepthCommand("depth light")).toBe("light");
    expect(parseDepthCommand("/depth normal")).toBe("normal");
    expect(parseDepthCommand("test_mock test_mock")).toBe("light");
    expect(parseDepthCommand("/test_mock test_mock")).toBe("normal");
    expect(parseDepthCommand("test_mock test_mock")).toBe("deep");
    expect(parseDepthCommand("/depth weird")).toBeUndefined();
  });

  it("parses model commands without treating ordinary model discussion as a command", () => {
    expect(parseModelCommand("/model")).toEqual({ kind: "show" });
    expect(parseModelCommand("/model deepseek-v4-pro")).toEqual({ kind: "set", model: "deepseek-v4-pro" });
    expect(parseModelCommand("model gemini-3.1-pro-preview")).toBeUndefined();
    expect(parseModelCommand("test_mock")).toBeUndefined();
  });
});
