import type { HudRow } from "./types";

// Renders a world-level state slot as a game-style gauge, picking the form from
// the data: numeric current/max → progress bar; a pressure slot → caution pill;
// everything else → glyph + value. The "why it changed" cause (if any) shows as
// a subtle line below, keeping numbers explainable (metrics move with drama but stay explainable).
export function StateGauge({ row }: { readonly row: HudRow }) {
  const cause = row.details[0]?.text;
  const isPressurePill = row.kind === "pressure" && row.ratio == null;
  return (
    <div>
      <div className="flex items-center gap-2 text-[15px] leading-6">
        <span className="shrink-0 text-[15px]">{row.glyph}</span>
        <span className="text-muted-foreground">{row.label}</span>
        {row.ratio != null ? (
          <span className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
            <span className="block h-full bg-primary" style={{ width: `${Math.round(row.ratio * 100)}%` }} />
          </span>
        ) : null}
        {isPressurePill ? (
          <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[14px] leading-5 font-semibold text-amber-300">⚠ {row.value}</span>
        ) : row.value ? (
          <span className="ml-auto text-[15px] leading-6 font-semibold text-primary">{row.value}</span>
        ) : null}
      </div>
      {cause ? <p className="mt-0.5 pl-6 text-[14px] leading-6 text-muted-foreground/70">{cause}</p> : null}
    </div>
  );
}
