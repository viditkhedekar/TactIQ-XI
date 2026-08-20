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
  or change instructions. Around a hundred lines a match, mixing incident with
  crowd noise, a summariser's asides and touchline reactions.
- **A verdict at full time.** Every player rated, a man of the match, and the
  performance broken into nine areas scored against Premier League par, each
  carrying the numbers behind it. It ends with what to train, in one click.
- **Training that changes players.** A weekly focus and intensity that really
  move attributes, gated by age and by how far a player is from his ceiling.
  Push too hard and they turn up tired, or do not turn up at all.
- **A live transfer market.** Two windows, bids that take rounds to answer,
  counter offers, wage demands, and rival clubs bidding for your players and
  against you for theirs.
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
changes belongs to a career.

Transfers and training are both built on that split rather than around it. A
transfer writes `career_player_state.club_id` and leaves the shared player row
alone, so squad queries read
`COALESCE(career_player_state.club_id, players.club_id)`. Training accumulates
fractional `attribute_deltas` on the same row, applied over the reference
attributes when a squad is loaded. One manager selling a striker or drilling his
finishing therefore cannot touch anybody else's save.

### Colour in the commentary, and why it is free

The ticker carries a lot of text that describes nothing: crowd noise, a
throw-in, a co-commentator's aside. All of it is drawn from a **separate random
number generator**, seeded from the fixture, the half and the minute, and never
from the match RNG.

That separation is load-bearing rather than tidy. The engine is calibrated
against real Premier League rates by a harness that plays thousands of matches,
and that calibration is only valid while the sequence of draws from the match
generator stays fixed. One extra `pick` inside a commentary function shifts
every roll after it, and a season quietly stops looking like a season while
every unit test still passes. `src/engine/__tests__/colour.test.ts` pins the
outcomes of six seeded matches to the figures the engine produced before any
colour existed; if commentary work moves them, it has reached the simulation and
needs the season harness run against it.

The two cases that look like exceptions are not. A shot that hits the woodwork
or is cleared off the line is an ordinary miss or block that has been relabelled
after the outcome was settled, so it still counts once in the statistics.

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
| Goals per match    | 2.70      | ~2.80 |
| Shots per team     | 12.50     | ~12.5 |
| On target per team | 4.27      | ~4.3  |
| Home wins          | 45.2%     | ~44%  |
| Draws              | 22.7%     | ~23%  |
| Yellows per match  | 4.02      | ~4.0  |
| Reds per match     | 0.15      | ~0.15 |

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

## Transfers, training and the match report

**Windows** run for rounds 1 to 4 and 20 to 23. Both are several rounds wide
because a deal is not instant: a bid gets an answer the following round, a
haggle costs another, and a one-round window would see every offer expire before
anyone could reply.

**A bid** goes to the selling club, which accepts, refuses, or names a number of
its own. Only once a fee is agreed does the player decide, and he can still say
no: joining a clearly weaker side costs a great deal in wages, and past a
certain drop in level he will not go at any price. Rival clubs bid for your
players and against you for theirs, on exactly the same code path. Squads are
held between 18 and 32, enforced on both sides of every deal.

The price a club quotes already includes how willing it is to sell, so bidding
what was asked is accepted rather than countered. Getting that wrong is an easy
and very annoying bug, and `askingAfterAppetite` exists to keep the number on
screen and the number in the decision the same one.

**Training** applies once a week, in the same moment as recovery, because it is
the same week: the days between matches are either rest or work. A focused
attribute moves about a tenth of a point a week at normal intensity, scaled by
age, by how far the player is from his ceiling, and by how relevant the session
is to his position. A season of finishing work is worth a few points to a
twenty year old and almost nothing to a thirty-two year old, which is the shape
real development has. Higher intensity pays better and costs freshness and the
occasional torn hamstring. Every club trains, not only yours, so the division
does not stand still.

**The report** at full time scores nine areas against par and says what to do
about the worst of them. It is stored on the fixture when the match ends,
because building it needs the finished match state, which is deleted with the
live match as soon as the round settles.

## Not built yet

Cups, European competition, full finances beyond a budget, contracts and
expiries, youth academies, and more than one league. Fixtures already carry a
competition column, and the engine is career-scoped and deterministic
throughout.
