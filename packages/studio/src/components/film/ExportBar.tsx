import { buildApiUrl } from "../../hooks/use-api";
import { useColors } from "../../hooks/use-colors";
import type { Theme } from "../../hooks/use-theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportBarProps {
  projectId: string;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// ExportBar
// ---------------------------------------------------------------------------

/**
 * Renders three download anchors for the three export formats:
 *   - JSON  → /api/v1/projects/:id/export/json
 *   - Ink   → /api/v1/projects/:id/export/ink
 *   - HTML  → /api/v1/projects/:id/export/html (self-contained playable page)
 *
 * Each anchor uses the native `download` attribute so the browser triggers a
 * file-save dialog rather than navigating. The server responds with
 * `Content-Disposition: attachment`, so the download works on same-origin
 * requests without any JS blob machinery.
 */
export function ExportBar({ projectId, theme }: ExportBarProps) {
  const c = useColors(theme);

  const encodedProjectId = encodeURIComponent(projectId);
  const jsonUrl = buildApiUrl(`/projects/${encodedProjectId}/export/json`) ?? "#";
  const inkUrl = buildApiUrl(`/projects/${encodedProjectId}/export/ink`) ?? "#";
  const htmlUrl = buildApiUrl(`/projects/${encodedProjectId}/export/html`) ?? "#";

  return (
    <div className="border border-border bg-card rounded p-3" data-testid="export-bar">
      <div className={`text-sm font-medium mb-2 ${c.muted}`}>Xuất / Bàn giao</div>
      <div className="flex flex-wrap gap-2">
        <a
          href={jsonUrl}
          download
          data-testid="export-json"
          className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium no-underline ${c.btnSecondary}`}
        >
          Xuất JSON
        </a>
        <a
          href={inkUrl}
          download
          data-testid="export-ink"
          className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium no-underline ${c.btnSecondary}`}
        >
          Xuất Ink
        </a>
        <a
          href={htmlUrl}
          download
          data-testid="export-html"
          className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium no-underline ${c.btnSecondary}`}
        >
          Xuất trang web chơi được (HTML)
        </a>
      </div>
    </div>
  );
}
