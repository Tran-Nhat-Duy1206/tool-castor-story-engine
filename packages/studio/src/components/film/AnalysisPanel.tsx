import { useApi } from "../../hooks/use-api";
import { useColors } from "../../hooks/use-colors";
import { tr } from "../../lib/app-language";
import type { Theme } from "../../hooks/use-theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
  code: string;
  level: "error" | "warning" | "info";
  message: string;
  nodeIds: string[];
}

interface AnalysisReport {
  ok: boolean;
  issues: Issue[];
}

interface ArcPoint {
  nodeId: string;
  score: number;
}

interface Arc {
  endingId: string | null;
  points: ArcPoint[];
}

interface EmotionArcs {
  arcs: Arc[];
  truncated: boolean;
}

interface PathDistribution {
  total: number;
  truncated: boolean;
  byEnding: Record<string, number>;
  lengthHistogram: Record<number, number>;
}

interface AnalysisData {
  report: AnalysisReport;
  arcs: EmotionArcs;
  distribution: PathDistribution;
}

type Colors = ReturnType<typeof useColors>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARC_DISPLAY = 8;

// A small tasteful palette for data-viz arc polylines (SVG stroke attributes
// require actual color values, not Tailwind class names).
const ARC_STROKE_COLORS = [
  "hsl(220 70% 55%)",
  "hsl(160 60% 45%)",
  "hsl(330 65% 55%)",
  "hsl(45 80% 50%)",
  "hsl(270 60% 60%)",
  "hsl(195 70% 45%)",
  "hsl(15 75% 55%)",
  "hsl(120 45% 45%)",
] as const;

const SVG_W = 480;
const SVG_H = 160;
const SVG_PAD_X = 20;
const SVG_PAD_Y = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelClass(level: "error" | "warning" | "info"): string {
  if (level === "error") return "text-destructive";
  if (level === "warning") return "text-amber-500";
  return "text-muted-foreground";
}

function arcToPolylinePoints(arc: Arc): string {
  const pts = arc.points;
  if (pts.length === 0) return "";
  const usableW = SVG_W - 2 * SVG_PAD_X;
  const usableH = SVG_H - 2 * SVG_PAD_Y;
  const xStep = pts.length === 1 ? 0 : usableW / (pts.length - 1);
  return pts
    .map((p, i) => {
      const x = SVG_PAD_X + i * xStep;
      // Map score from [-1,1] to [SVG_H - SVG_PAD_Y, SVG_PAD_Y]: positive = higher up
      const y = SVG_PAD_Y + ((1 - p.score) / 2) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IssuesList({ report, c }: { report: AnalysisReport; c: Colors }) {
  return (
    <div className="border border-border rounded p-3" data-testid="validation-panel">
      <div className={`text-sm font-medium ${c.muted}`}>
        {tr("Xác thực", "Validation")}{report.ok ? "" : tr(" (có vấn đề chặn)", " (blocking issues)")}
      </div>
      {report.issues.length === 0 ? (
        <div className={`text-sm mt-1 ${c.muted}`}>{tr("Không có vấn đề", "No issues")}</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {report.issues.map((issue, i) => (
            <li
              key={i}
              data-testid={`validation-issue-${issue.code}`}
              className="text-xs flex gap-2"
            >
              <span className={levelClass(issue.level)}>[{issue.level}]</span>
              <span className="text-foreground">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmotionArcChart({ arcs, c }: { arcs: EmotionArcs; c: Colors }) {
  const displayArcs = arcs.arcs.slice(0, MAX_ARC_DISPLAY);
  const overLimit = arcs.arcs.length > MAX_ARC_DISPLAY;
  const baselineY = SVG_PAD_Y + (SVG_H - 2 * SVG_PAD_Y) / 2;

  return (
    <div data-testid="emotion-arc" className="border border-border rounded p-3">
      <div className={`text-sm font-medium mb-2 ${c.muted}`}>{tr("Cung cảm xúc", "Emotion arcs")}</div>
      {displayArcs.length === 0 ? (
        <div className={`text-sm ${c.muted}`}>{tr("Không có đường đi để phân tích", "No paths to analyze")}</div>
      ) : (
        <>
          <svg
            width="100%"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            aria-label={tr("Biểu đồ cung cảm xúc", "Emotion arc chart")}
            className="rounded bg-muted/10"
            style={{ maxHeight: SVG_H }}
          >
            {/* Neutral baseline at score=0 */}
            <line
              x1={SVG_PAD_X}
              y1={baselineY}
              x2={SVG_W - SVG_PAD_X}
              y2={baselineY}
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            {displayArcs.map((arc, idx) => {
              const points = arcToPolylinePoints(arc);
              if (!points) return null;
              return (
                <polyline
                  key={idx}
                  points={points}
                  fill="none"
                  stroke={ARC_STROKE_COLORS[idx % ARC_STROKE_COLORS.length]}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              );
            })}
          </svg>
          <div className="mt-2 flex flex-wrap gap-3">
            {displayArcs.map((arc, idx) => (
              <span key={idx} className="text-xs flex items-center gap-1.5">
                <span
                  className="inline-block w-4 h-0.5 rounded-full"
                  style={{ background: ARC_STROKE_COLORS[idx % ARC_STROKE_COLORS.length] }}
                />
                <span className={c.muted}>{arc.endingId ?? tr("Không có kết", "No ending")}</span>
              </span>
            ))}
          </div>
          {(overLimit || arcs.truncated) && (
            <div className={`text-xs mt-1 ${c.muted}`}>
              {overLimit && tr(`Chỉ hiển thị ${MAX_ARC_DISPLAY} đường đi đầu`, `Showing first ${MAX_ARC_DISPLAY} paths only`)}
              {arcs.truncated && tr(" (tổng số đường đi vượt giới hạn liệt kê)", " (total paths exceed the enumeration limit)")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PathDistributionPanel({
  distribution,
  c,
}: {
  distribution: PathDistribution;
  c: Colors;
}) {
  const endingEntries = Object.entries(distribution.byEnding);
  const histEntries = Object.entries(distribution.lengthHistogram)
    .map(([len, count]) => ({ len: Number(len), count }))
    .sort((a, b) => a.len - b.len);
  const maxHistCount = Math.max(...histEntries.map((e) => e.count), 1);

  return (
    <div data-testid="path-distribution" className="border border-border rounded p-3">
      <div className={`text-sm font-medium mb-2 ${c.muted}`}>{tr("Phân bố đường đi", "Path distribution")}</div>

      {distribution.truncated && (
        <div className={`text-xs mb-2 ${c.muted}`}>
          {tr(`Quá nhiều đường đi; chỉ tính ${distribution.total} đường đầu`, `Too many paths; only the first ${distribution.total} are counted`)}
        </div>
      )}

      {endingEntries.length === 0 ? (
        <div className={`text-sm ${c.muted}`}>{tr("Chưa có dữ liệu đường đi", "No path data")}</div>
      ) : (
        <div className="space-y-1.5 mb-4">
          {endingEntries.map(([endingId, count]) => {
            const pct = distribution.total > 0 ? (count / distribution.total) * 100 : 0;
            return (
              <div key={endingId} className="flex items-center gap-2 text-xs">
                <span
                  className={`shrink-0 w-28 truncate ${c.muted}`}
                  title={endingId}
                >
                  {endingId}
                </span>
                <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-primary/70"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
                <span className="shrink-0 text-foreground w-8 text-right tabular-nums">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {histEntries.length > 0 && (
        <div>
          <div className={`text-xs font-medium mb-2 ${c.muted}`}>{tr("Phân bố độ dài đường đi", "Path length distribution")}</div>
          <div className="flex items-end gap-1 h-12">
            {histEntries.map(({ len, count }) => {
              const heightPct = (count / maxHistCount) * 100;
              return (
                <div
                  key={len}
                  className="flex flex-col items-center gap-0.5 flex-1 min-w-0"
                >
                  <div
                    className="w-full bg-primary/50 rounded-t"
                    style={{ height: `${heightPct}%` }}
                    title={tr(`Độ dài ${len}: ${count} đường`, `Length ${len}: ${count} paths`)}
                  />
                  <span className={`text-xs leading-none ${c.muted}`}>{len}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalysisPanel (public)
// ---------------------------------------------------------------------------

export function AnalysisPanel({
  projectId,
  theme,
}: {
  projectId: string;
  theme: Theme;
}) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<AnalysisData>(
    `/projects/${projectId}/story-graph/analysis`,
  );

  if (loading) {
    return <div className={`p-4 text-sm ${c.muted}`}>{tr("Đang tải kết quả phân tích…", "Loading analysis…")}</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">{tr("Tải thất bại: ", "Load failed: ")}{error}</div>;
  }

  if (!data) {
    return <div className={`p-4 text-sm ${c.muted}`}>{tr("Chưa có dữ liệu phân tích", "No analysis data")}</div>;
  }

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <IssuesList report={data.report} c={c} />
      <EmotionArcChart arcs={data.arcs} c={c} />
      <PathDistributionPanel distribution={data.distribution} c={c} />
    </div>
  );
}
