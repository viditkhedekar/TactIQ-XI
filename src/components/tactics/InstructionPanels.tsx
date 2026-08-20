"use client";

/**
 * The instruction controls, shared by the tactics screen and the mid-match
 * drawer.
 *
 * Everything a manager can set before kick off can also be changed during the
 * match, so these are written once and mounted in both places. Keeping them in
 * one file is what stops the two screens drifting apart, which is the usual way
 * a half time panel ends up offering three of the twelve things it should.
 */

import {
  TACTICAL_STYLES,
  TACTICAL_STYLE_NAMES,
  matchingStyle,
  type TacticalStyleName,
  type TeamTactics,
} from "@/engine";

export type InstructionKey =
  | "mentality"
  | "pressing"
  | "tempo"
  | "width"
  | "directness"
  | "defensiveLine"
  | "closingDown"
  | "tackling";

export const SLIDERS: {
  key: InstructionKey;
  label: string;
  labels: [string, string, string, string, string];
  hint: string;
}[] = [
  {
    key: "mentality",
    label: "Mentality",
    labels: ["Very defensive", "Defensive", "Balanced", "Positive", "Attacking"],
    hint: "How much risk you take going forward, and hand over in return.",
  },
  {
    key: "defensiveLine",
    label: "Defensive line",
    labels: ["Very deep", "Deep", "Standard", "High", "Very high"],
    hint: "Squeezing up compresses the pitch. It also leaves grass in behind.",
  },
  {
    key: "pressing",
    label: "Pressing",
    labels: ["Stand off", "Low", "Medium", "High", "Relentless"],
    hint: "How hard you hunt the ball. Wins it back, costs legs and fouls.",
  },
  {
    key: "closingDown",
    label: "Closing down",
    labels: ["Hold shape", "Contain", "Balanced", "Engage", "Everywhere"],
    hint: "Whether you leave your shape to go to the man. Holding invites shots from range.",
  },
  {
    key: "tackling",
    label: "Tackling",
    labels: ["Stay on feet", "Careful", "Normal", "Firm", "Get stuck in"],
    hint: "Wins more of the ball, and collects a great many more cards.",
  },
  {
    key: "tempo",
    label: "Tempo",
    labels: ["Very slow", "Slow", "Standard", "Fast", "Very fast"],
    hint: "How quickly the ball is moved on.",
  },
  {
    key: "width",
    label: "Width",
    labels: ["Very narrow", "Narrow", "Standard", "Wide", "Very wide"],
    hint: "Stretching the pitch pushes play into crossing positions.",
  },
  {
    key: "directness",
    label: "Passing style",
    labels: ["Short", "Patient", "Mixed", "Direct", "Long ball"],
    hint: "Patient build-up against balls played early into space.",
  },
];

export const CHOICES: {
  key: "finalThird" | "passingFocus" | "keeperDistribution";
  label: string;
  hint: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "finalThird",
    label: "Final third",
    hint: "Work an opening for fewer, better chances, or shoot on sight for more, worse ones.",
    options: [
      { value: "work_ball", label: "Work ball into box" },
      { value: "mixed", label: "Mixed" },
      { value: "shoot_early", label: "Shoot on sight" },
    ],
  },
  {
    key: "passingFocus",
    label: "Passing focus",
    hint: "Committing to a channel amplifies whichever side of your attack is stronger.",
    options: [
      { value: "left", label: "Down the left" },
      { value: "centre", label: "Through the middle" },
      { value: "right", label: "Down the right" },
      { value: "mixed", label: "No preference" },
    ],
  },
  {
    key: "keeperDistribution",
    label: "Keeper distribution",
    hint: "Playing out keeps the ball and invites the press. Going long skips the midfield.",
    options: [
      { value: "short", label: "Play out short" },
      { value: "mixed", label: "Mixed" },
      { value: "long", label: "Launch it long" },
    ],
  },
];

/* --------------------------------------------------------------- components */

export function StylePicker({
  tactics,
  onApply,
  compact = false,
}: {
  tactics: TeamTactics;
  onApply: (style: TacticalStyleName) => void;
  compact?: boolean;
}) {
  const current = matchingStyle(tactics);

  return (
    <div className="p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Style
        </span>
        <span className="text-[11px] text-[var(--text-dim)]">
          {current ? TACTICAL_STYLES[current].label : "Custom"}
        </span>
      </div>

      <div className={`grid gap-1.5 ${compact ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {TACTICAL_STYLE_NAMES.map((name) => {
          const style = TACTICAL_STYLES[name];
          const active = current === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onApply(name)}
              aria-pressed={active}
              title={style.blurb}
              className={`rounded border px-2 py-1.5 text-left transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[rgba(47,129,247,0.12)] text-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span className="block text-[12px] font-medium">{style.label}</span>
              {!compact && (
                <span className="mt-0.5 block text-[10px] leading-snug text-[var(--text-dim)]">
                  {style.blurb}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] text-[var(--text-dim)]">
        A style just fills in the instructions below. Change any of them afterwards and it
        becomes Custom.
      </p>
    </div>
  );
}

export function InstructionSliders({
  tactics,
  onChange,
}: {
  tactics: TeamTactics;
  onChange: (patch: Partial<TeamTactics>) => void;
}) {
  return (
    <div className="space-y-2.5 p-3">
      {SLIDERS.map((slider) => {
        const value = tactics[slider.key];
        return (
          <div key={slider.key}>
            <div className="flex items-baseline justify-between text-[11px]">
              <label htmlFor={`slider-${slider.key}`} className="text-[var(--text-muted)]">
                {slider.label}
              </label>
              <span className="font-medium">{slider.labels[value - 1]}</span>
            </div>
            <input
              id={`slider-${slider.key}`}
              type="range"
              min={1}
              max={5}
              step={1}
              value={value}
              title={slider.hint}
              onChange={(e) =>
                onChange({ [slider.key]: Number(e.target.value) } as Partial<TeamTactics>)
              }
              className="mt-0.5 w-full accent-[var(--accent)]"
            />
          </div>
        );
      })}
    </div>
  );
}

export function InstructionChoices({
  tactics,
  onChange,
}: {
  tactics: TeamTactics;
  onChange: (patch: Partial<TeamTactics>) => void;
}) {
  return (
    <div className="space-y-2.5 p-3">
      {CHOICES.map((choice) => (
        <div key={choice.key}>
          <label
            htmlFor={`choice-${choice.key}`}
            className="block text-[11px] text-[var(--text-muted)]"
          >
            {choice.label}
          </label>
          <select
            id={`choice-${choice.key}`}
            value={tactics[choice.key]}
            title={choice.hint}
            onChange={(e) => onChange({ [choice.key]: e.target.value } as Partial<TeamTactics>)}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
          >
            {choice.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <label className="flex cursor-pointer items-start gap-2 pt-0.5">
        <input
          type="checkbox"
          checked={tactics.offsideTrap}
          onChange={(e) => onChange({ offsideTrap: e.target.checked })}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-[12px]">Offside trap</span>
          <span className="block text-[10px] leading-snug text-[var(--text-dim)]">
            Step up to catch runners. Worth having with a high line, and it puts a man clean
            through when it fails.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Set piece takers and how corners are delivered. */
export function SetPiecePanel({
  tactics,
  squad,
  onChange,
}: {
  tactics: TeamTactics;
  squad: { id: number; name: string }[];
  onChange: (patch: Partial<TeamTactics>) => void;
}) {
  const takers: { key: keyof TeamTactics["setPieces"]; label: string }[] = [
    { key: "penalties", label: "Penalties" },
    { key: "freeKicks", label: "Free kicks" },
    { key: "corners", label: "Corners" },
    { key: "throwIns", label: "Long throws" },
  ];

  function setTaker(key: string, value: string) {
    onChange({
      setPieces: { ...tactics.setPieces, [key]: value === "" ? null : Number(value) },
    });
  }

  return (
    <div className="space-y-2.5 p-3">
      {takers.map((taker) => (
        <div key={taker.key}>
          <label
            htmlFor={`taker-${taker.key}`}
            className="block text-[11px] text-[var(--text-muted)]"
          >
            {taker.label}
          </label>
          <select
            id={`taker-${taker.key}`}
            value={(tactics.setPieces[taker.key] as number | null) ?? ""}
            onChange={(e) => setTaker(taker.key, e.target.value)}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
          >
            <option value="">Best available</option>
            {squad.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </div>
      ))}

      <div>
        <label
          htmlFor="corner-delivery"
          className="block text-[11px] text-[var(--text-muted)]"
        >
          Corner delivery
        </label>
        <select
          id="corner-delivery"
          value={tactics.setPieces.cornerDelivery}
          onChange={(e) =>
            onChange({
              setPieces: {
                ...tactics.setPieces,
                cornerDelivery: e.target.value as TeamTactics["setPieces"]["cornerDelivery"],
              },
            })
          }
          className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
        >
          <option value="whipped">Whipped in</option>
          <option value="near_post">Near post</option>
          <option value="far_post">Far post</option>
          <option value="short">Short</option>
        </select>
        <p className="mt-1 text-[10px] leading-snug text-[var(--text-dim)]">
          A ball to the back post is worth having if you have someone to head it, and worth
          nothing if you do not. A short corner is the other way round.
        </p>
      </div>
    </div>
  );
}
