import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";
import { tr } from "../lib/app-language";

type ConfigSource = "env" | "studio";
type EnvScope = "project" | "global" | null;

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface ServiceConfigPayload {
  services: Array<Record<string, unknown>>;
  defaultModel: string | null;
  configSource: ConfigSource;
  storedConfigSource?: ConfigSource;
  envConfig: {
    project: EnvConfigSummary;
    global: EnvConfigSummary;
    effectiveSource: EnvScope;
    runtimeUsesEnv: boolean;
  };
}

export function ServiceConfigSourceCard({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<ServiceConfigPayload | null>(null);
  const [saving, setSaving] = useState<ConfigSource | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const payload = await fetchJson<ServiceConfigPayload>("/services/config");
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Đọc nguồn cấu hình thất bại", "Failed to load config source"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const switchSource = async (configSource: ConfigSource) => {
    setSaving(configSource);
    try {
      await fetchJson("/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configSource }),
      });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Chuyển nguồn cấu hình thất bại", "Failed to switch config source"));
    } finally {
      setSaving(null);
    }
  };

  const importEnvConfig = async () => {
    setImporting(true);
    try {
      await fetchJson("/services/config/import-env", {
        method: "POST",
      });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Nhập cấu hình biến môi trường thất bại", "Failed to import env config"));
    } finally {
      setImporting(false);
    }
  };

  if (!data && !error) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/70 p-4 text-sm text-muted-foreground/70">
        {tr("Đang đọc nguồn cấu hình…", "Loading config source…")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 text-sm text-amber-600">
        {error ?? tr("Đọc nguồn cấu hình thất bại", "Failed to load config source")}
      </div>
    );
  }

  const { configSource, envConfig } = data;
  const storedConfigSource = data.storedConfigSource ?? configSource;
  const activeEnvSummary = envConfig.effectiveSource === "project" ? envConfig.project : envConfig.global;
  const envLabel = envConfig.effectiveSource === "project"
    ? tr(".env của dự án", "Project .env")
    : envConfig.effectiveSource === "global"
      ? tr("~/.castor/.env toàn cục", "Global ~/.castor/.env")
      : null;
  const envDetected = envConfig.project.detected || envConfig.global.detected;

  return (
    <div className="rounded-xl border border-border/40 bg-card/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr("Nguồn cấu hình LLM", "LLM config source")}</div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            {tr("Runtime Studio: ", "Studio runtime:")}
            <span className="text-foreground"> {tr("dùng cấu hình trang dịch vụ và khóa Studio", "uses service page config and Studio keys")}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void switchSource("studio")}
            disabled={saving !== null || importing || configSource === "studio"}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            {saving === "studio" ? tr("Đang chuyển…", "Switching…") : tr("Dùng cấu hình Studio", "Use Studio config")}
          </button>
          {envDetected && activeEnvSummary.hasApiKey ? (
            <button
              type="button"
              onClick={() => void importEnvConfig()}
              disabled={saving !== null || importing}
              className="rounded-lg border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary/70 disabled:opacity-50"
            >
              {importing ? tr("Đang nhập…", "Importing…") : tr("Nhập cấu hình đã phát hiện", "Import detected config")}
            </button>
          ) : null}
        </div>
      </div>

      {storedConfigSource === "env" ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80">
          {tr(
            "Phát hiện cờ cấu hình cũ ưu tiên `.env`. Runtime Studio sẽ không dùng nó; CLI, daemon và môi trường triển khai vẫn có thể dùng như lớp ghi đè env.",
            "A legacy setting marks `.env` as preferred. The Studio runtime ignores it; CLI, daemon, and deployment environments may still use the env override layer.",
          )}
        </div>
      ) : null}

      {envDetected ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80 space-y-1.5">
          <div className="text-foreground">
            {tr("Phát hiện ghi đè biến môi trường LLM: ", "Detected LLM environment variable override:")}
            <span className="font-medium"> {envLabel ?? tr("đã phát hiện nhưng chưa rõ nguồn", "detected but source not located")}</span>
          </div>
          {activeEnvSummary.baseUrl ? <div>Base URL: <span className="font-mono text-foreground">{activeEnvSummary.baseUrl}</span></div> : null}
          {activeEnvSummary.model ? <div>Model: <span className="font-mono text-foreground">{activeEnvSummary.model}</span></div> : null}
          {activeEnvSummary.provider ? <div>Provider: <span className="font-mono text-foreground">{activeEnvSummary.provider}</span></div> : null}
          <div>API Key: <span className="text-foreground">{activeEnvSummary.hasApiKey ? tr("đã đặt", "set") : tr("chưa đặt", "not set")}</span></div>
          <div className="text-muted-foreground/70 pt-1">
            {tr(
              "Hiện đã phát hiện .env, nhưng yêu cầu của Studio và Agent không dùng trực tiếp các ghi đè này; sau khi nhấp “Nhập cấu hình đã phát hiện”, nó sẽ được lưu thành cấu hình dịch vụ Studio.",
              "A .env override was detected, but Studio and agent requests do not use it directly. Click “Import detected config” to save it as Studio service config.",
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground/75">
          {tr(
            "Không phát hiện biến ghi đè LLM trong thư mục hoặc `.env` toàn cục. Hiện đang dùng trực tiếp cấu hình dự án và cấu hình dịch vụ Studio.",
            "No LLM override variables detected in the project or global `.env`. Project config and Studio service config are used directly.",
          )}
        </div>
      )}

      {error ? (
        <div className="text-xs text-rose-500">{error}</div>
      ) : null}
    </div>
  );
}
