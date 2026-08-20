"use client";

import { useMemo, useState } from "react";

export type DevelopmentSeries = {
  playerId: number;
  name: string;
  age: number;
  /** One point per completed season, plus where he stands now. */
  points: { season: number; overall: number; age: number }[];
};

/**
 * How the squad has developed, as a line per player.
 *
 * Hand-drawn SVG rather than a charting library: the whole chart is a polyline
 * per player over a shared scale, and a dependency would be more code than the
 * thirty lines it takes to do properly.
 *
 * Lines are dimmed until hovered or selected, because twenty overlapping
 * series are unreadable otherwise and the useful question is almost always
 * about one player at a time.
 */
export function DevelopmentChart({ series }: { series: DevelopmentSeries[] }) {
  const [active, setActive] = useState<number | null>(null);

  const { width, height, pad, seasons, minOverall, maxOverall } = useMemo(() => {
    const allSeasons = series.flatMap((s) => s.points.map((p) => p.season));
    const allOveralls = series.flatMap((s) => s.points.map((p) => p.overall));

    return {
      width: 720,
      height: 300,
      pad: { top: 16, right: 16, bottom: 28, left: 32 },
      seasons: {
        min: Math.min(...allSeasons, 1),
        max: Math.max(...allSeasons, 2),
      },
      // A little breathing room, and never a scale so tight that a one-point
      // move looks like a collapse.
      minOverall: Math.max(30, Math.min(...allOveralls) - 3),
      maxOverall: Math.min(99, Math.max(...allOveralls) + 3),
    };
  }, [series]);

  if (series.length === 0) return null;

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const x = (season: number) =>
    pad.left +
    (seasons.max === seasons.min
      ? plotWidth / 2
      : ((season - seasons.min) / (seasons.max - seasons.min)) * plotWidth);

  const y = (overall: number) =>
    pad.top + (1 - (overall - minOverall) / (maxOverall - minOverall)) * plotHeight;

  const seasonTicks = Array.from(
    { length: seasons.max - seasons.min + 1 },
    (_, i) => seasons.min + i,
  );

  // Four horizontal guides, on round numbers.
  const overallTicks = [0, 1, 2, 3].map((i) =>
    Math.round(minOverall + ((maxOverall - minOverall) * i) / 3),
  );

  return (
    <div className="space-y-3 p-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[520px]"
          role="img"
          aria-label="Player ratings across the seasons of this save"
        >
          {overallTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={pad.left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-dim)"
              >
                {tick}
              </text>
            </g>
          ))}

          {seasonTicks.map((season) => (
            <text
              key={season}
              x={x(season)}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-dim)"
            >
              S{season}
            </text>
          ))}

          {series.map((player) => {
            const isActive = active === player.playerId;
            const path = player.points
              .map((p) => `${x(p.season)},${y(p.overall)}`)
              .join(" ");

            return (
              <g key={player.playerId}>
                <polyline
                  points={path}
                  fill="none"
                  stroke={isActive ? "var(--accent)" : "var(--text-dim)"}
                  strokeWidth={isActive ? 2.5 : 1}
                  strokeOpacity={active === null ? 0.45 : isActive ? 1 : 0.12}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {isActive &&
                  player.points.map((p) => (
                    <circle
                      key={p.season}
                      cx={x(p.season)}
                      cy={y(p.overall)}
                      r={3}
                      fill="var(--accent)"
                    />
                  ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* The legend doubles as the control: hovering a name lights its line. */}
      <div className="flex flex-wrap gap-1.5">
        {series.map((player) => {
          const first = player.points[0];
          const last = player.points[player.points.length - 1];
          const change = last.overall - first.overall;

          return (
            <button
              key={player.playerId}
              type="button"
              onMouseEnter={() => setActive(player.playerId)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(player.playerId)}
              onBlur={() => setActive(null)}
              onClick={() =>
                setActive(active === player.playerId ? null : player.playerId)
              }
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                active === player.playerId
                  ? "border-[var(--accent)] bg-[var(--bg-hover)]"
                  : "border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span>{player.name}</span>
              <span
                className="numeric"
                style={{
                  color:
                    change > 0
                      ? "var(--good)"
                      : change < 0
                        ? "var(--bad)"
                        : "var(--text-dim)",
                }}
              >
                {change > 0 ? "+" : ""}
                {change}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
