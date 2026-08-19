# Touchline

A browser-based football management game. Take charge of a Premier League club
for a full season: pick your side, set your tactics, and follow every match
minute by minute, pausing whenever you want to change something.

## What it does

- **A full season.** 20 real Premier League clubs, 38 rounds, 380 fixtures.
- **Real players.** 547 squad members imported from an EA FC 26 export, with
  the full attribute set behind every decision the simulation makes.
- **Matches you can watch.** Minute-by-minute commentary with named players,
  live statistics, and the ability to pause at any point to make substitutions
  or change instructions.
- **Tactics that matter.** Formation, mentality, pressing, tempo, width and
  passing directness all feed the simulation directly. A wide, direct side
  really does create different chances from a narrow, patient one.
- **A season that accumulates.** Fitness drains and recovers, injuries and
  suspensions cost you players, form rises and falls, and the table fills in.
- **Independent careers.** Enter a name, pick a club, and you get your own
  save. Several people can play their own seasons off the same installation.

## Running it

You need Node 20 or later and a Postgres database.

```bash
npm install
```

Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your database.
For local development that is typically:

```bash
createdb footballmanager
```

with `DATABASE_URL="postgresql://YOUR_USER@localhost:5432/footballmanager"`.

Then create the tables and load the player data:

```bash
npm run db:migrate
```

```bash
npm run db:import
```

```bash
npm run dev
```

Open http://localhost:3000, enter a name, and pick a club.

## How it is put together

```
src/engine/     the simulation, as pure TypeScript with no framework imports
src/db/         schema and connection
src/lib/        the layer between the two, plus validation and session handling
src/app/        pages and API routes
src/components/ the interface
scripts/        data import and the calibration harness
```

The **simulation engine** is deliberately isolated. It takes plain objects in
and returns events and a new state out, imports nothing from Next or the
database, and can be exercised entirely from the command line. That is what
makes it testable, and it is why the calibration work below was possible before
any interface existed.

The **database** separates global reference data from career state. `clubs` and
`players` are imported once and never written to during play; everything that
changes belongs to a career. Future features like transfers and player
development attach as per-career tables layered over the reference rows rather
than as edits to shared data.

### Watching a match, and pausing it

The interesting problem in the whole project. The browser's ticker deliberately
runs behind the server, which simulates in chunks so playback never stalls
waiting on the network. But the manager can pause at any minute and make a
change, and that minute is in the server's past.

The engine's entire state, including the random number generator, is one
serializable object. So the server keeps a snapshot from the start of the
current chunk, and when a change arrives for minute M it rewinds to that
snapshot, replays to M (regenerating exactly the events the manager already
watched, because the generator state came along for the ride), applies the
change, and carries on with a newly diverged stream. Nothing the manager has
seen is ever contradicted.

The snapshot only moves forward once the ticker has caught up to it, so the
rewind can always reach the minute being watched.

## Testing

```bash
npm test
```

Unit tests cover the engine: seeded determinism, the rewind guarantee, fixture
generation, substitution legality, fatigue, ratings and validation.

```bash
npm run test:sanity
```

Realism checks across twelve simulated seasons, asserting that the output looks
like football rather than merely running without crashing.

```bash
npm run sim:season -- 20
```

The calibration harness. Simulates whole seasons from the player data with no
database involved and reports the aggregate rates. Current output over 7,600
matches, against real Premier League figures:

| Measure            | Simulated | Real  |
| ------------------ | --------- | ----- |
| Goals per match    | 2.74      | ~2.80 |
| Shots per team     | 12.70     | ~12.5 |
| On target per team | 4.32      | ~4.3  |
| Home wins          | 45.6%     | ~44%  |
| Draws              | 22.2%     | ~23%  |
| Yellows per match  | 4.07      | ~4.0  |
| Reds per match     | 0.16      | ~0.15 |

Every tunable number lives in `src/engine/constants.ts`. If a distribution
drifts, that is the only file that should need changing.

## Player data

`data/pl-players.csv` holds the 547 Premier League players, sliced from a
larger EA FC 26 export. To regenerate it from the full file:

```bash
npm run data:extract -- /path/to/export.csv
```

The filter is an explicit club id whitelist rather than a league name match,
because the source export groups two Ukrainian clubs under "Premier League".

## A note on accounts

There is no authentication. A career is identified by the name you type, and
anyone who knows that name can pick it up. That is a deliberate choice for a
game played among friends, and it should not be mistaken for a security
boundary.

## Not built yet

Transfers, player development, cups, European competition, finances, youth
academies, and more than one league. The schema and the engine were shaped with
these in mind: fixtures already carry a competition column, values and wages are
already imported, and the engine is career-scoped and deterministic throughout.
