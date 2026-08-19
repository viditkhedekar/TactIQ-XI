/**
 * The manager in the other dugout.
 *
 * Every club that is not the player's needs someone picking a shape, naming a
 * side and reacting during the match. The same functions also fill in the
 * player's own lineup when they have not set one, and drive the nine other
 * fixtures simulated each round.
 *
 * Nothing here is clever. It is meant to be defensible: play your best
 * available eleven in a shape your squad suits, attack when you are behind,
 * shut up shop when you are ahead, and take off players who are spent.
 */

import { MATCH } from "./constants";
import { applySubstitution, type Emitter } from "./match";
import { effectiveness, positionFit, squadStrength } from "./ratings";
import { FORMATIONS } from "./tactics";
import type {
  EnginePlayer,
  FormationName,
  Instruction,
  LineupPlayer,
  MatchSide,
  MatchState,
  Slot,
  TeamTactics,
} from "./types";

/** Formations the AI will consider, in preference order for a tie. */
const CANDIDATE_FORMATIONS: FormationName[] = [
  "4-3-3",
  "4-2-3-1",
  "4-4-2",
  "4-1-4-1",
  "3-5-2",
  "5-4-1",
];

/**
 * How well a squad can fill a formation: the total quality of the best
 * available player for each slot. A squad with two good strikers scores well
 * on 4-4-2; one with no third centre-back scores badly on 3-5-2.
 */
function formationScore(players: EnginePlayer[], formation: FormationName): number {
  const slots = FORMATIONS[formation];
  const taken = new Set<number>();
  let total = 0;

  // Fill the most demanding slots first so a specialist is not wasted early.
  const ordered = [...slots].sort((a, b) => slotScarcity(b) - slotScarcity(a));

  for (const slot of ordered) {
    let best: EnginePlayer | null = null;
    let bestScore = -1;

    for (const p of players) {
      if (taken.has(p.id)) continue;
      const score = p.overall * positionFit(p, slot);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (best) {
      taken.add(best.id);
      total += bestScore;
    }
  }

  return total / slots.length;
}

/** Slots that fewer players can cover well should be assigned first. */
function slotScarcity(slot: Slot): number {
  if (slot === "GK") return 10;
  if (slot.includes("CB")) return 6;
  if (slot.includes("WB")) return 5;
  if (slot === "ST" || slot === "LST" || slot === "RST") return 4;
  if (slot === "LW" || slot === "RW" || slot === "LM" || slot === "RM") return 3;
  return 2;
}

/** Picks the formation this squad is actually built for. */
export function chooseFormation(players: EnginePlayer[]): FormationName {
  let best: FormationName = "4-3-3";
  let bestScore = -1;

  for (const formation of CANDIDATE_FORMATIONS) {
    const score = formationScore(players, formation);
    if (score > bestScore) {
      bestScore = score;
      best = formation;
    }
  }

  return best;
}

export type Availability = {
  /** Players who cannot be picked: injured, suspended, or not in the squad. */
  unavailableIds: Set<number>;
};

/**
 * Names a starting eleven. Players are scored on quality, how well they suit
 * the slot, and how fresh they are, so a tired star loses his place to a
 * rested squad player during a congested run.
 */
export function selectLineup(
  players: EnginePlayer[],
  formation: FormationName,
  availability: Availability = { unavailableIds: new Set() },
): { lineup: { playerId: number; slot: Slot }[]; benchIds: number[] } {
  const available = players.filter((p) => !availability.unavailableIds.has(p.id));
  const slots = FORMATIONS[formation];
  const taken = new Set<number>();
  const lineup: { playerId: number; slot: Slot }[] = [];

  const ordered = [...slots].sort((a, b) => slotScarcity(b) - slotScarcity(a));

  for (const slot of ordered) {
    let best: EnginePlayer | null = null;
    let bestScore = -1;

    for (const p of available) {
      if (taken.has(p.id)) continue;
      const score = playerScore(p, slot);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (best) {
      taken.add(best.id);
      lineup.push({ playerId: best.id, slot });
    }
  }

  // Restore the formation's own slot order so the pitch view reads correctly.
  lineup.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));

  // Bench: the best of the rest, with a spare keeper guaranteed.
  const remaining = available.filter((p) => !taken.has(p.id));
  const keepers = remaining.filter((p) => p.isGk).sort(byScore);
  const outfield = remaining.filter((p) => !p.isGk).sort(byScore);

  const benchIds: number[] = [];
  if (keepers.length > 0) benchIds.push(keepers[0].id);
  for (const p of outfield) {
    if (benchIds.length >= 9) break;
    benchIds.push(p.id);
  }

  return { lineup, benchIds };
}

function playerScore(p: EnginePlayer, slot: Slot): number {
  const fitnessFactor = 0.75 + (p.fitness / 100) * 0.25;
  const formFactor = 0.96 + ((p.form - 6.5) / 4) * 0.08;
  return p.overall * positionFit(p, slot) * fitnessFactor * formFactor;
}

function byScore(a: EnginePlayer, b: EnginePlayer): number {
  const scoreA = a.overall * (0.8 + (a.fitness / 100) * 0.2);
  const scoreB = b.overall * (0.8 + (b.fitness / 100) * 0.2);
  return scoreB - scoreA;
}

/**
 * Chooses instructions from the gap between the two squads. A clear favourite
 * at home attacks; a clear underdog away sits deep and plays direct.
 */
export function chooseTactics(
  ownPlayers: EnginePlayer[],
  opponentPlayers: EnginePlayer[],
  isHome: boolean,
  formation?: FormationName,
): TeamTactics {
  const own = squadStrength(ownPlayers);
  const opponent = squadStrength(opponentPlayers);
  const edge = own - opponent + (isHome ? 2.5 : -2.5);

  const mentality: Instruction =
    edge > 9 ? 5 : edge > 2.5 ? 4 : edge > -2.5 ? 3 : edge > -9 ? 2 : 1;

  // Pressing hard is only worth it if the legs are there to sustain it.
  const avgStamina =
    ownPlayers.length > 0
      ? ownPlayers.reduce((sum, p) => sum + p.stamina, 0) / ownPlayers.length
      : 65;
  const pressing: Instruction = avgStamina > 74 ? (edge > 0 ? 4 : 3) : edge > 4 ? 3 : 2;

  // Underdogs go direct and narrow; favourites keep it and stretch the pitch.
  const directness: Instruction = edge < -8 ? 5 : edge < -2 ? 4 : edge > 4 ? 2 : 3;
  const tempo: Instruction = edge < -4 ? 4 : 3;
  const width: Instruction = edge > 4 ? 4 : edge < -4 ? 2 : 3;

  return {
    formation: formation ?? chooseFormation(ownPlayers),
    mentality,
    pressing,
    tempo,
    width,
    directness,
  };
}

/** Minutes at which an AI manager reconsiders, beyond forced changes. */
const DECISION_MINUTES = [46, 60, 70, 80];

function shouldConsider(minute: number): boolean {
  return DECISION_MINUTES.includes(minute);
}

/** Best available replacement on the bench for a given slot. */
function bestReplacement(side: MatchSide, slot: Slot, needsKeeper: boolean): LineupPlayer | null {
  // A player already substituted off sits on the bench too, and cannot return.
  const candidates = side.bench.filter(
    (lp) => lp.player.isGk === needsKeeper && lp.offAtMinute === null && lp.minutesPlayed === 0,
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((best, lp) =>
    playerScore(lp.player, slot) > playerScore(best.player, slot) ? lp : best,
  );
}

/**
 * Runs the AI's in-match decisions for one side at one minute. Returns true if
 * anything changed, so the caller knows to recompute team ratings.
 */
export function runAiDecisions(
  state: MatchState,
  side: MatchSide,
  emit: Emitter,
): boolean {
  if (side.subsUsed >= MATCH.maxSubs) return false;

  let changed = false;
  const isHome = side === state.home;
  const goalDiff = isHome
    ? state.homeGoals - state.awayGoals
    : state.awayGoals - state.homeGoals;

  // Forced changes first: an injured player has to come off whatever the plan.
  for (const lp of side.onPitch) {
    if (!lp.injured || lp.sentOff) continue;
    const replacement = bestReplacement(side, lp.slot, lp.player.isGk);
    if (!replacement) continue;
    if (applySubstitution(state, side, { off: lp.player.id, on: replacement.player.id }, emit)) {
      changed = true;
      // Clear the flag so the same player is not substituted twice.
      lp.injured = false;
    }
    if (side.subsUsed >= MATCH.maxSubs) return changed;
  }

  if (!shouldConsider(state.minute)) return changed;

  // Anyone running on empty comes off.
  const exhausted = side.onPitch
    .filter((lp) => !lp.sentOff && !lp.player.isGk && lp.fitness < 52)
    .sort((a, b) => a.fitness - b.fitness);

  for (const lp of exhausted.slice(0, 2)) {
    const replacement = bestReplacement(side, lp.slot, false);
    if (!replacement) continue;
    // Only worth doing if the substitute is actually fresher and not much worse.
    if (effectiveness(replacement) <= effectiveness(lp)) continue;
    if (applySubstitution(state, side, { off: lp.player.id, on: replacement.player.id }, emit)) {
      changed = true;
    }
    if (side.subsUsed >= MATCH.maxSubs) return changed;
  }

  // Chase the game, or see it out.
  if (state.minute >= 60 && goalDiff < 0 && side.tactics.mentality < 5) {
    side.tactics = { ...side.tactics, mentality: (side.tactics.mentality + 1) as Instruction };
    changed = true;
  } else if (state.minute >= 75 && goalDiff > 0 && side.tactics.mentality > 1) {
    side.tactics = { ...side.tactics, mentality: (side.tactics.mentality - 1) as Instruction };
    changed = true;
  }

  return changed;
}

/**
 * Convenience wrapper: drives whichever sides are not managed by the player.
 * Pass to `simulateSegment` as its `onMinute` callback.
 */
export function aiMinuteHook(state: MatchState, emit: Emitter): boolean {
  let changed = false;
  if (!state.home.isUser) changed = runAiDecisions(state, state.home, emit) || changed;
  if (!state.away.isUser) changed = runAiDecisions(state, state.away, emit) || changed;
  return changed;
}
