import { describe, expect, it } from "vitest";
import {
  buildDetectionConfig,
  buildNotifyChannel,
  detectionDraftFromConfig,
  notifyDraftFromChannel,
} from "./project-settings-model";

describe("project settings form model", () => {
  it("preserves webhook event filters when round-tripping notification channels", () => {
    const draft = notifyDraftFromChannel({
      type: "webhook",
      url: "https://hooks.example.com/castor",
      secret: "s1",
      events: ["chapter-complete", "pipeline-error"],
    });

    expect(buildNotifyChannel(draft)).toEqual({
      type: "webhook",
      url: "https://hooks.example.com/castor",
      secret: "s1",
      events: ["chapter-complete", "pipeline-error"],
    });
  });

  it("honors detection.enabled=false instead of re-enabling the detector", () => {
    const draft = detectionDraftFromConfig({
      enabled: false,
      provider: "custom",
      apiUrl: "https://detector.example.com/api",
      apiKeyEnv: "DETECT_KEY",
      threshold: 0.7,
      autoRewrite: true,
      maxRetries: 4,
    });

    expect(draft.enabled).toBe(false);
    expect(buildDetectionConfig(draft)).toBeNull();
  });
});
