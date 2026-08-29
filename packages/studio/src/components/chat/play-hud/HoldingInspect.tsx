import { ChevronLeft } from "lucide-react";
import type { HoldingRow } from "./types";
import { KIND_LABEL_VI, KIND_LABEL_EN, LADDER_LABEL_VI, LADDER_LABEL_EN } from "./types";
import { RelationWeb } from "./RelationWeb";

export function HoldingInspect(props: {
  readonly row: HoldingRow;
  readonly isVi: boolean;
  readonly generating?: boolean;
  readonly onBack: () => void;
}) {
  const { row, isVi, generating, onBack } = props;
  const { lifecycle } = row;
  const kind = (isVi ? KIND_LABEL_VI : KIND_LABEL_EN)[row.kind] ?? row.kind;
  const ladderLabel = isVi ? LADDER_LABEL_VI : LADDER_LABEL_EN;
  return (
    <div className="min-w-0 space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[14px] leading-6 text-muted-foreground hover:text-foreground">
        <ChevronLeft size={14} /> {isVi ? "Quay lại" : "Back"}
      </button>

      <div className="min-w-0 overflow-hidden rounded-xl border border-border/40 bg-secondary/30">
        <div className="flex min-h-[180px] items-center justify-center bg-gradient-to-b from-secondary/60 to-transparent text-4xl">
          {row.imageUrl ? <img src={row.imageUrl} alt="" aria-hidden="true" className="max-h-[320px] w-full object-contain" /> : <span>{generating ? "⏳" : row.glyph}</span>}
        </div>

        <div className="min-w-0 space-y-3 px-3 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 flex-1 break-words text-[17px] leading-6 font-bold text-foreground">{row.label}</span>
              <span className="shrink-0 pt-0.5 text-[13px] text-muted-foreground">{kind}</span>
            </div>
            {row.summary ? <p className="mt-1 break-words text-[14px] leading-6 text-muted-foreground">{row.summary}</p> : null}
          </div>

          {lifecycle ? (
            <div>
              <div className="flex gap-1">
                {lifecycle.stages.map((stage) => (
                  <span
                    key={stage}
                    className={`flex-1 rounded px-1 py-1 text-center text-[11px] leading-4 ${
                      stage === lifecycle.current ? "bg-primary/20 font-bold text-primary" : "bg-secondary/40 text-muted-foreground/50"
                    }`}
                  >
                    {ladderLabel[stage] ?? stage}
                  </span>
                ))}
              </div>
              {lifecycle.reason ? <p className="mt-1.5 break-words text-[13px] leading-5 text-emerald-300">▲ {lifecycle.reason}</p> : null}
            </div>
          ) : row.statusPill ? (
            <div>
              <span className="inline-block rounded-full bg-secondary/60 px-2.5 py-1 text-[14px] leading-5 font-medium text-foreground">{row.statusPill}</span>
              {row.isFresh ? (
                <p className="mt-1.5 text-[13px] leading-5 text-emerald-300">▲ {isVi ? "Vừa thu được" : "Just acquired"}</p>
              ) : row.changeReason ? (
                <p className="mt-1.5 break-words text-[13px] leading-5 text-emerald-300">▲ {row.changeReason}</p>
              ) : null}
            </div>
          ) : null}

          {row.meters.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-[13px] leading-5 uppercase tracking-wider text-muted-foreground/60">{isVi ? "Thuộc tính" : "Stats"}</h4>
              {row.meters.map((m) => (
                <div key={m.id} className="flex min-w-0 items-center gap-2 text-[14px] leading-6">
                  <span className="w-12 shrink-0 break-words text-muted-foreground">{m.label}</span>
                  {m.ratio != null ? (
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
                      <span className="block h-full bg-primary" style={{ width: `${Math.round(m.ratio * 100)}%` }} />
                    </span>
                  ) : null}
                  <span className="ml-auto min-w-0 break-words font-semibold text-primary">{m.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {row.relations.length > 0 ? (
            <div className="min-w-0">
              <h4 className="mb-1 text-[13px] leading-5 uppercase tracking-wider text-muted-foreground/60">{isVi ? "Kết nối" : "Connections"}</h4>
              <RelationWeb centerLabel={row.label} relations={row.relations} isVi={isVi} />
            </div>
          ) : null}

          {row.provenanceTurn != null ? (
            <p className="break-words border-t border-border/30 pt-2 text-[13px] leading-5 text-muted-foreground/70">
              {isVi ? `Thu được ở hồi ${row.provenanceTurn}` : `Acquired · Turn ${row.provenanceTurn}`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
