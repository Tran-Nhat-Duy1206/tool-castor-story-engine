import type { HoldingRelation } from "./types";

export interface WebNode {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly type: string;
  readonly strength?: number;
}

// Place up to 6 relation targets on an ellipse around the center node.
// Pure + deterministic so it can be unit-tested without rendering.
export function layoutRelations(
  relations: ReadonlyArray<HoldingRelation>,
  w: number,
  h: number,
): { nodes: ReadonlyArray<WebNode>; overflow: number } {
  const shown = relations.slice(0, 6);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.32;
  const ry = h * 0.3;
  const nodes = shown.map((r, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / shown.length;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), label: r.targetLabel, type: r.type, strength: r.strength };
  });
  return { nodes, overflow: Math.max(0, relations.length - shown.length) };
}

function truncate(s: string, n = 6): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function RelationWeb(props: {
  readonly centerLabel: string;
  readonly relations: ReadonlyArray<HoldingRelation>;
  readonly isVi: boolean;
}) {
  const W = 300;
  const H = 150;
  const cx = W / 2;
  const cy = H / 2;
  const { nodes, overflow } = layoutRelations(props.relations, W, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-0" role="img" aria-label={props.isVi ? "Lưới quan hệ" : "Relations"}>
      {nodes.map((n, i) => (
        <line key={`l${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className="stroke-border" strokeWidth={1.5} />
      ))}
      <ellipse cx={cx} cy={cy} rx={46} ry={19} className="fill-secondary stroke-primary" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-foreground">
        {truncate(props.centerLabel)}
      </text>
      {nodes.map((n, i) => (
        <g key={`n${i}`}>
          <ellipse cx={n.x} cy={n.y} rx={38} ry={15} className="fill-card stroke-border" />
          <text x={n.x} y={n.y + 3} textAnchor="middle" fontSize={9} className="fill-foreground">
            {truncate(n.label)}
          </text>
          <text x={(cx + n.x) / 2} y={(cy + n.y) / 2 - 2} textAnchor="middle" fontSize={8} className="fill-muted-foreground">
            {n.type}{n.strength != null ? ` ${n.strength}` : ""}
          </text>
        </g>
      ))}
      {overflow > 0 ? (
        <text x={W - 6} y={H - 6} textAnchor="end" fontSize={9} className="fill-muted-foreground">+{overflow}</text>
      ) : null}
    </svg>
  );
}
