import { describe, it, expect } from "vitest";
import { latestPlayChoiceSet, latestPlayChoices } from "../play-choices";

describe("latestPlayChoices", () => {
  it("returns suggestedActions from the most recent play tool execution", () => {
    const messages = [
      { role: "assistant", parts: [{ type: "tool", execution: { tool: "play_start", status: "completed", details: { kind: "play_world_started", suggestedActions: ["mock_val", "mock_val"] } } }] },
      { role: "assistant", parts: [{ type: "tool", execution: { tool: "play_step", status: "completed", details: { kind: "play_turn_advanced", suggestedActions: ["mock_val", "mock_val"] } } }] },
    ] as any;
    expect(latestPlayChoices(messages)).toEqual(["mock_val", "mock_val"]);
  });

  it("returns a stable source key for the latest choice set", () => {
    const messages = [
      { role: "assistant", parts: [{ type: "tool", execution: { id: "tool-old", tool: "play_start", status: "completed", details: { kind: "play_world_started", suggestedActions: ["mock_val"] } } }] },
      { role: "assistant", parts: [{ type: "tool", execution: { id: "tool-new", tool: "play_step", status: "completed", details: { kind: "play_turn_advanced", suggestedActions: ["mock_val", "mock_val"] } } }] },
    ] as any;

    expect(latestPlayChoiceSet(messages)).toEqual({
      key: "tool-new",
      choices: ["mock_val", "mock_val"],
    });
  });

  it("also reads direct tool executions before they are rehydrated into parts", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        toolExecutions: [
          {
            tool: "play_start",
            status: "completed",
            details: {
              kind: "play_world_started",
              suggestedActions: ["mock_val", "mock_val"],
            },
          },
        ],
      },
    ] as any;

    expect(latestPlayChoiceSet(messages)).toEqual({
      key: "message-0-execution-0",
      choices: ["mock_val", "mock_val"],
    });
  });

  it("does not revive choices from an older turn when the latest Play result has none", () => {
    const messages = [
      { role: "assistant", parts: [{ type: "tool", execution: { id: "turn-1", tool: "play_step", status: "completed", details: { suggestedActions: ["mock_val", "mock_val"] } } }] },
      { role: "assistant", parts: [{ type: "tool", execution: { id: "turn-2", tool: "play_step", status: "completed", details: { suggestedActions: [] } } }] },
    ] as any;

    expect(latestPlayChoiceSet(messages)).toBeNull();
  });

  it("hides choices from the previous turn while a new Play turn is running", () => {
    const messages = [
      { role: "assistant", parts: [{ type: "tool", execution: { id: "turn-1", tool: "play_step", status: "completed", details: { suggestedActions: ["mock_val", "mock_val"] } } }] },
      { role: "assistant", parts: [{ type: "tool", execution: { id: "turn-2", tool: "play_step", status: "running" } }] },
    ] as any;

    expect(latestPlayChoiceSet(messages)).toBeNull();
  });

  it("returns [] when there is no play execution", () => {
    expect(latestPlayChoices([{ role: "user", content: "hi" }] as any)).toEqual([]);
  });
});
