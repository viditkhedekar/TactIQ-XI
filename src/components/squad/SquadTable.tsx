"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Attr,
  AvailabilityIcon,
  FitnessBar,
  FormBadge,
  Panel,
} from "@/components/ui/primitives";

export type SquadRow = {
  id: number;
  name: string;
  positions: string;
  isGk: boolean;
  age: number;
  overall: number;
  nationality: string | null;
  jersey: number | null;
  fitness: number;
  form: number;
  unavailable: "injured" | "suspended" | null;
  injuredUntilRound: number | null;
  suspendedUntilRound: number | null;
  apps: number;
  goals: number;
  assists: number;
  avgRating: number | null;
  pace: number;
  passing: number;
  shooting: number;
  defending: number;
  physical: number;
  stamina: number;
};

type SortKey = keyof SquadRow;

const COLUMNS: { key: SortKey; label: string; title?: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "positions", label: "Pos" },
  { key: "age", label: "Age", numeric: true },
  { key: "overall", label: "OVR", title: "Overall rating", numeric: true },
  { key: "pace", label: "Pac", title: "Pace", numeric: true },
  { key: "shooting", label: "Sho", title: "Finishing, or reflexes for a keeper", numeric: true },
  { key: "passing", label: "Pas", title: "Short passing", numeric: true },
  { key: "defending", label: "Def", title: "Tackling, or handling for a keeper", numeric: true },
  { key: "physical", label: "Phy", title: "Strength", numeric: true },
  { key: "stamina", label: "Sta", title: "Stamina", numeric: true },
  { key: "fitness", label: "Condition", numeric: true },
  { key: "form", label: "Form", numeric: true },
  { key: "apps", label: "Apps", numeric: true },
  { key: "goals", label: "Gls", numeric: true },
  { key: "assists", label: "Ast", numeric: true },
  { key: "avgRating", label: "Avg", title: "Average match rating", numeric: true },
];

export function SquadTable({
  rows,
  currentRound,
}: {
  rows: SquadRow[];
  currentRound: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [ascending, setAscending] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];

      // Players who have not featured sort last whichever way the column goes,
      // rather than pretending a missing rating is a zero.
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;

      if (typeof x === "number" && typeof y === "number") {
        return ascending ? x - y : y - x;
      }
      return ascending
        ? String(x).localeCompare(String(y))
        : String(y).localeCompare(String(x));
    });
    return copy;
  }, [rows, sortKey, ascending]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setAscending((prev) => !prev);
    } else {
      setSortKey(key);
      // Names read naturally A to Z; numbers read best highest first.
      setAscending(key === "name" || key === "positions");
    }
  }

  return (
    <Panel bodyClassName="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {COLUMNS.map((column) => (
              <th
                key={String(column.key)}
                title={column.title}
                onClick={() => toggle(column.key)}
                className={`cursor-pointer select-none px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text)] ${
                  column.numeric ? "text-right" : "text-left"
                } ${sortKey === column.key ? "text-[var(--text)]" : ""}`}
              >
                {column.label}
                {sortKey === column.key && (
                  <span className="ml-0.5 text-[9px]">{ascending ? "▲" : "▼"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)]"
            >
              <td className="px-2 py-1">
                <span className="flex items-center gap-1.5">
                  {row.jersey !== null && (
                    <span className="numeric w-5 text-right text-[11px] text-[var(--text-dim)]">
                      {row.jersey}
                    </span>
                  )}
                  <Link
                    href={`/career/player/${row.id}`}
                    className="font-medium hover:text-[var(--accent)] hover:underline"
                  >
                    {row.name}
                  </Link>
                  <AvailabilityIcon reason={row.unavailable} />
                </span>
              </td>
              <td className="px-2 py-1 text-[11px] text-[var(--text-muted)]">{row.positions}</td>
              <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">{row.age}</td>
              <td className="px-2 py-1 text-right">
                <Attr value={row.overall} />
              </td>
              <td className="px-2 py-1 text-right"><Attr value={row.pace} /></td>
              <td className="px-2 py-1 text-right"><Attr value={row.shooting} /></td>
              <td className="px-2 py-1 text-right"><Attr value={row.passing} /></td>
              <td className="px-2 py-1 text-right"><Attr value={row.defending} /></td>
              <td className="px-2 py-1 text-right"><Attr value={row.physical} /></td>
              <td className="px-2 py-1 text-right"><Attr value={row.stamina} /></td>
              <td className="px-2 py-1">
                <span className="flex justify-end">
                  <FitnessBar value={row.fitness} />
                </span>
              </td>
              <td className="px-2 py-1 text-right">
                <FormBadge value={row.apps > 0 ? row.form : null} />
              </td>
              <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">{row.apps}</td>
              <td className="numeric px-2 py-1 text-right font-medium">
                {row.goals > 0 ? row.goals : <span className="text-[var(--text-dim)]">-</span>}
              </td>
              <td className="numeric px-2 py-1 text-right text-[var(--text-muted)]">
                {row.assists > 0 ? row.assists : <span className="text-[var(--text-dim)]">-</span>}
              </td>
              <td className="px-2 py-1 text-right">
                <FormBadge value={row.avgRating} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <UnavailableNote rows={rows} currentRound={currentRound} />
    </Panel>
  );
}

/** Spells out who is missing and for how long, under the table. */
function UnavailableNote({
  rows,
  currentRound,
}: {
  rows: SquadRow[];
  currentRound: number;
}) {
  const out = rows.filter((r) => r.unavailable);
  if (out.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
      {out.map((row) => {
        const until =
          row.unavailable === "injured" ? row.injuredUntilRound : row.suspendedUntilRound;
        const rounds = until === null ? 0 : until - currentRound + 1;
        return (
          <span key={row.id} className="mr-4 inline-block">
            <span className="font-medium text-[var(--text)]">{row.name}</span>{" "}
            {row.unavailable} for {rounds} {rounds === 1 ? "match" : "matches"}
          </span>
        );
      })}
    </div>
  );
}
