import { useState, useMemo, useEffect, useCallback } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useNewSSEMessages } from "../hooks/use-sse";
import { useColors } from "../hooks/use-colors";
import { tr } from "../lib/app-language";
import { useApi } from "../hooks/use-api";
import { AnalysisPanel } from "../components/film/AnalysisPanel";
import { ExportBar } from "../components/film/ExportBar";
import {
  WIZARD_PHASES,
  computePhaseProgress,
  computeStaleFlags,
} from "../lib/film-wizard-progress";
import type { Phase, PhaseStatus } from "../lib/film-wizard-progress";
import type { StoryGraph } from "@actalk/castor-core/interactive-film/graph-schema";
import { ChatPage } from "./ChatPage";
import { StoryGraphTree } from "./StoryGraphTree";
import { StoryPlayer } from "./StoryPlayer";
import FlowView from "./FlowView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Superset of all sub-component Nav interfaces.
interface Nav {
  toDashboard: () => void;
  toPlay: (id: string) => void;
  toFlow: (id: string) => void;
  toFilmAuthor: (id: string) => void;
  toFilm: (projectId: string) => void;
  toFilmStudio: (projectId: string) => void;
  toBook: (id: string) => void;
  toServices: () => void;
  toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => void;
  toStyle: () => void;
}

interface FilmWizardProps {
  projectId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

type Colors = ReturnType<typeof useColors>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Labels are resolved via tr() at render time; they must not be frozen to a
// single language string at module load, so vi/en pairs are stored here.
const PHASE_LABELS: Record<Phase, { vi: string; en: string }> = {
  world: { vi: "Thế giới", en: "World" },
  scale: { vi: "Quy mô", en: "Scale" },
  structure: { vi: "Cấu trúc", en: "Structure" },
  workshop: { vi: "Từng nút", en: "Nodes" },
  validate: { vi: "Xác thực", en: "Validate" },
};


const DEFAULT_SUBVIEW: Record<Phase, string> = {
  world: "chat",
  scale: "scale",
  structure: "flow",
  workshop: "tree",
  validate: "validate",
};

const PHASE_SUBVIEWS: Record<Phase, ReadonlyArray<{ key: string; vi: string; en: string }>> = {
  world: [
    { key: "chat", vi: "Hội thoại", en: "Chat" },
    { key: "anchor", vi: "Mỏ neo thế giới", en: "World anchor" },
  ],
  scale: [],
  structure: [
    { key: "flow", vi: "Sơ đồ luồng", en: "Flow" },
    { key: "tree", vi: "Cây", en: "Tree" },
  ],
  workshop: [
    { key: "tree", vi: "Cây", en: "Tree" },
    { key: "chat", vi: "Hội thoại", en: "Chat" },
  ],
  validate: [],
};

const EMPTY_PROGRESS: Record<Phase, PhaseStatus> = {
  world: "empty",
  scale: "empty",
  structure: "empty",
  workshop: "empty",
  validate: "empty",
};

const EMPTY_STALE: Record<Phase, boolean> = {
  world: false,
  scale: false,
  structure: false,
  workshop: false,
  validate: false,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WorldAnchorView({
  graph,
  c,
}: {
  graph: StoryGraph | null;
  c: Colors;
}) {
  if (!graph?.worldAnchor) {
    return (
      <div className={`p-6 text-sm ${c.muted}`}>
        {tr(
          "Chưa có mỏ neo thế giới. Hãy chuyển sang \"Hội thoại\" và nhờ AI thiết lập thế giới quan cùng nhân vật cho bạn.",
          "No world anchor yet. Switch to “Chat” and ask the AI to set up the world and characters.",
        )}
      </div>
    );
  }

  const { worldAnchor } = graph;
  return (
    <div className="p-4 space-y-3 text-sm" data-testid="film-world">
      <div>
        <div className={`text-xs font-medium mb-1 ${c.muted}`}>{tr("Cốt lõi câu chuyện", "Story core")}</div>
        <div className="text-foreground">{worldAnchor.storyCore || "—"}</div>
      </div>
      <div className="flex gap-6">
        <div>
          <div className={`text-xs font-medium mb-1 ${c.muted}`}>{tr("Chủ đề", "Theme")}</div>
          <div>{worldAnchor.theme || "—"}</div>
        </div>
        <div>
          <div className={`text-xs font-medium mb-1 ${c.muted}`}>{tr("Thể loại", "Genre")}</div>
          <div>{worldAnchor.genre || "—"}</div>
        </div>
        {worldAnchor.durationMinutes > 0 && (
          <div>
            <div className={`text-xs font-medium mb-1 ${c.muted}`}>{tr("Thời lượng", "Duration")}</div>
            <div>{worldAnchor.durationMinutes} {tr("phút", "min")}</div>
          </div>
        )}
      </div>
      {worldAnchor.worldRules && (
        <div>
          <div className={`text-xs font-medium mb-1 ${c.muted}`}>{tr("Quy tắc thế giới", "World rules")}</div>
          <div className="whitespace-pre-wrap">{worldAnchor.worldRules}</div>
        </div>
      )}
      {graph.characters.length > 0 && (
        <div>
          <div className={`text-xs font-medium mb-2 ${c.muted}`}>{tr("Nhân vật chính", "Main characters")}</div>
          <ul className="space-y-2">
            {graph.characters.map((ch) => (
              <li key={ch.id} className="flex items-start gap-2">
                <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded border border-border ${c.muted}`}>
                  {ch.role}
                </span>
                <span>
                  <span className="font-medium text-foreground">{ch.name}</span>
                  {ch.motivation && (
                    <span className={` ml-2 ${c.muted}`}>{ch.motivation}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScalePlaceholderView({ c }: { c: Colors }) {
  return (
    <div className={`p-6 text-sm ${c.muted}`} data-testid="film-scale-placeholder">
      {tr(
        "Cài đặt quy mô (tính năng P2) — thiết lập số nút mục tiêu, độ sâu nhánh, số kết nhiều nhánh và các tham số khác tại đây.",
        "Scale settings (P2) — set node count targets, branch depth, number of endings, and other parameters here.",
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export default function FilmWizard({
  projectId,
  nav,
  theme,
  t,
  sse,
}: FilmWizardProps) {
  const c = useColors(theme);
  const [phase, setPhase] = useState<Phase>("world");
  const [subViews, setSubViews] = useState<Record<Phase, string>>({ ...DEFAULT_SUBVIEW });
  const [showPreview, setShowPreview] = useState(false);

  const { data: graph, refetch: refetchGraph } = useApi<StoryGraph>(`/projects/${projectId}/story-graph`);

  useEffect(() => {
    void refetchGraph();
  }, [phase, refetchGraph]);

  const handleSseMessage = useCallback((msg: SSEMessage) => {
    if (msg.event !== "agent:complete") return;
    const data = msg.data as { activeBookId?: string } | null;
    if (data?.activeBookId !== projectId) return;
    void refetchGraph();
  }, [projectId, refetchGraph]);

  useNewSSEMessages(sse.messages, handleSseMessage);

  const progress = useMemo<Record<Phase, PhaseStatus>>(
    () => (graph ? computePhaseProgress(graph) : EMPTY_PROGRESS),
    [graph],
  );

  const stale = useMemo<Record<Phase, boolean>>(
    () => (graph ? computeStaleFlags(graph, undefined, 0) : EMPTY_STALE),
    [graph],
  );

  const currentSubView = subViews[phase];
  const subviews = PHASE_SUBVIEWS[phase];

  function handlePhaseClick(p: Phase) {
    setShowPreview(false);
    setPhase(p);
  }

  function handleSubViewClick(key: string) {
    setSubViews({ ...subViews, [phase]: key });
  }

  function handlePreviewToggle() {
    setShowPreview((v) => !v);
  }

  return (
    <div data-testid="film-wizard" className="flex flex-col h-screen bg-background text-foreground">

      {/* ── Phase stepper top bar ── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="wizard-exit"
            onClick={nav.toDashboard}
            className={c.link}
          >
            ← {tr("Phim tương tác", "Interactive films")}
          </button>
          <div className="flex items-center gap-1 flex-wrap">
          {WIZARD_PHASES.map((p, i) => {
            const isActive = phase === p && !showPreview;
            const status = progress[p];
            return (
              <button
                key={p}
                type="button"
                data-testid={`wizard-step-${p}`}
                onClick={() => handlePhaseClick(p)}
                className={[
                  "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  isActive ? c.btnPrimary : c.btnSecondary,
                ].join(" ")}
              >
                {stale[p] && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
                )}
                <span
                  className={[
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                    status === "done"
                      ? "border-current bg-current/25"
                      : status === "partial"
                        ? "border-current/80"
                        : "border-current/40 opacity-70",
                  ].join(" ")}
                >
                  {i + 1}
                </span>
                <span>{tr(PHASE_LABELS[p].vi, PHASE_LABELS[p].en)}</span>
              </button>
            );
          })}
          </div>
        </div>

        <button
          type="button"
          data-testid="wizard-preview"
          onClick={handlePreviewToggle}
          className={[
            "shrink-0 flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium",
            showPreview ? c.btnPrimary : c.btnSecondary,
          ].join(" ")}
        >
          {tr("Chơi thử", "Play")}
        </button>
      </div>

      {/* ── Sub-view switch bar ── */}
      {!showPreview && subviews.length > 0 && (
        <div className="flex items-center gap-1 border-b border-border px-4 py-1.5 shrink-0">
          {subviews.map((sv) => (
            <button
              key={sv.key}
              type="button"
              data-testid={`wizard-subview-${sv.key}`}
              onClick={() => handleSubViewClick(sv.key)}
              className={[
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                currentSubView === sv.key ? c.btnPrimary : c.btnSecondary,
              ].join(" ")}
            >
              {tr(sv.vi, sv.en)}
            </button>
          ))}
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <MainArea
          showPreview={showPreview}
          phase={phase}
          subView={currentSubView}
          projectId={projectId}
          nav={nav}
          theme={theme}
          t={t}
          sse={sse}
          graph={graph}
          c={c}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main area switcher (extracted to keep FilmWizard clean)
// ---------------------------------------------------------------------------

interface MainAreaProps {
  showPreview: boolean;
  phase: Phase;
  subView: string;
  projectId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  graph: StoryGraph | null;
  c: Colors;
}

function MainArea({
  showPreview,
  phase,
  subView,
  projectId,
  nav,
  theme,
  t,
  sse,
  graph,
  c,
}: MainAreaProps) {
  // Content-type views need the same comfortable padding the standalone routes
  // get from App's page wrapper; the wizard's main area is full-bleed, so embed
  // them in a centered, padded column. Canvas (flow) and full-bleed (chat) opt out.
  const contentWrap = "mx-auto w-full max-w-4xl px-6 py-6";

  if (showPreview) {
    return (
      <div className={contentWrap}>
        <StoryPlayer projectId={projectId} nav={nav} theme={theme} t={t} embedded />
      </div>
    );
  }

  if (phase === "world" && subView === "chat") {
    return (
      <div className="h-full relative overflow-hidden">
        <ChatPage
          activeBookId={projectId}
          mode="interactive-film-authoring"
          nav={nav}
          theme={theme}
          t={t}
          sse={sse}
        />
      </div>
    );
  }

  if (phase === "world" && subView === "anchor") {
    return <WorldAnchorView graph={graph} c={c} />;
  }

  if (phase === "scale") {
    return <ScalePlaceholderView c={c} />;
  }

  if (phase === "structure" && subView === "flow") {
    return <FlowView projectId={projectId} nav={nav} theme={theme} t={t} embedded />;
  }

  if (
    (phase === "structure" && subView === "tree") ||
    (phase === "workshop" && subView === "tree")
  ) {
    return (
      <div className={contentWrap}>
        <StoryGraphTree projectId={projectId} nav={nav} theme={theme} t={t} embedded />
      </div>
    );
  }

  if (phase === "workshop" && subView === "chat") {
    return (
      <div className="h-full relative overflow-hidden">
        <ChatPage
          activeBookId={projectId}
          mode="interactive-film-authoring"
          nav={nav}
          theme={theme}
          t={t}
          sse={sse}
        />
      </div>
    );
  }

  if (phase === "validate") {
    return (
      <div className={`${contentWrap} space-y-4`}>
        <AnalysisPanel projectId={projectId} theme={theme} />
        <ExportBar projectId={projectId} theme={theme} />
      </div>
    );
  }

  return null;
}
