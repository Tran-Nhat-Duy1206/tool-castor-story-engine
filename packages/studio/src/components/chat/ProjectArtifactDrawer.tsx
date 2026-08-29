import { useEffect, useMemo, useState } from "react";
import { cjk } from "@streamdown/cjk";
import { AlertCircle, Loader2, Pencil, Save, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { fetchJson } from "../../hooks/use-api";
import { tr } from "../../lib/app-language";
import { useChatStore } from "../../store/chat";

interface ProjectArtifactPayload {
  readonly path: string;
  readonly content: string;
  readonly contentType: string;
  readonly size: number;
}

const streamdownPlugins = { cjk };

function encodeArtifactPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function displayName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function isJsonArtifact(path: string, contentType: string): boolean {
  return path.endsWith(".json") || contentType.includes("application/json");
}

export function ProjectArtifactDrawer() {
  const path = useChatStore((s) => s.projectArtifactPath);
  const close = useChatStore((s) => s.closeProjectArtifact);
  const [payload, setPayload] = useState<ProjectArtifactPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setEditing(false);
    void fetchJson<ProjectArtifactPayload>(`/project/artifacts/${encodeArtifactPath(path)}`)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setDraft(data.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const previewContent = useMemo(() => {
    if (!payload) return "";
    return isJsonArtifact(payload.path, payload.contentType) ? formatJson(payload.content) : payload.content;
  }, [payload]);

  if (!path) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await fetchJson<{ ok: boolean; size: number }>(`/project/artifacts/${encodeArtifactPath(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      setPayload({
        path,
        content: draft,
        contentType: payload?.contentType ?? "text/markdown; charset=utf-8",
        size: result.size,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-background/35 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label={tr("Đóng xem trước sản phẩm", "Close artifact preview")}
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <aside className="relative flex h-full w-[min(760px,calc(100vw-24px))] flex-col border-l border-border/55 bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/45 px-6 py-5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium uppercase tracking-[0.18em] text-muted-foreground/65">
              {tr("Sản phẩm", "Artifact")}
            </div>
            <h2 className="mt-1 truncate text-[22px] font-semibold text-foreground">
              {displayName(path)}
            </h2>
            <p className="mt-1 break-all text-[13px] leading-5 text-muted-foreground/70">
              {path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {payload && !editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(payload.content);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/35 px-3 py-2 text-[14px] font-medium text-foreground transition hover:border-primary/45 hover:bg-primary/10"
              >
                <Pencil size={15} />
                {tr("Chỉnh sửa", "Edit")}
              </button>
            )}
            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(payload?.content ?? "");
                    setEditing(false);
                  }}
                  disabled={saving}
                  className="rounded-lg border border-border/60 px-3 py-2 text-[14px] font-medium text-muted-foreground transition hover:bg-secondary/50 disabled:opacity-60"
                >
                  {tr("Hủy", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[14px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {tr("Lưu", "Save")}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-border/50 p-2 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
              aria-label={tr("Đóng", "Close")}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-6 mt-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[14px] leading-6 text-destructive">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 size={22} className="mr-2 animate-spin" />
              {tr("Đang đọc sản phẩm...", "Loading artifact...")}
            </div>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-full w-full resize-none rounded-xl border border-border/55 bg-secondary/20 px-4 py-4 font-mono text-[15px] leading-7 text-foreground outline-none transition focus:border-primary/50 focus:bg-background"
            />
          ) : payload ? (
            isJsonArtifact(payload.path, payload.contentType) ? (
              <pre className="whitespace-pre-wrap break-words rounded-xl border border-border/45 bg-secondary/25 px-4 py-4 font-mono text-[14px] leading-6 text-foreground">
                {previewContent}
              </pre>
            ) : (
              <article className="prose prose-neutral dark:prose-invert max-w-none text-[16px] leading-8 prose-headings:font-semibold prose-h1:text-[26px] prose-h2:text-[22px] prose-h3:text-[19px] prose-p:my-4 prose-li:my-1 prose-pre:whitespace-pre-wrap">
                <Streamdown plugins={streamdownPlugins} mode="static">
                  {previewContent}
                </Streamdown>
              </article>
            )
          ) : (
            <div className="rounded-xl border border-dashed border-border/55 px-4 py-8 text-center text-[14px] text-muted-foreground">
              {tr("Không có nội dung để xem trước.", "Nothing to preview.")}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
