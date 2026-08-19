/**
 * Slices the full EA FC 26 export down to the 20 real Premier League clubs and
 * writes data/pl-players.csv, so the repo can seed itself without the 18k-row
 * source file.
 *
 * The source export groups two Ukrainian clubs under "Premier League", so the
 * filter is an explicit club id whitelist rather than a league name match.
 *
 *   npm run data:extract [-- /path/to/FC26.csv]
 */
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import fs from "node:fs";
import path from "node:path";
import { PL_CLUB_IDS } from "../src/data/clubs";

const sourcePath =
  process.argv[2] ?? process.env.FC_CSV_PATH ?? "/Users/Vidit/Downloads/FC26_20250921.csv";

const outPath = path.join(process.cwd(), "data", "pl-players.csv");

if (!fs.existsSync(sourcePath)) {
  console.error(`Source CSV not found: ${sourcePath}`);
  console.error("Pass a path as an argument or set FC_CSV_PATH.");
  process.exit(1);
}

const rows: Record<string, string>[] = parse(fs.readFileSync(sourcePath), {
  columns: true,
  skip_empty_lines: true,
});

const wanted = new Set(PL_CLUB_IDS.map(String));
const kept = rows.filter((r) => wanted.has(r.club_team_id));

if (kept.length === 0) {
  console.error("No rows matched the club id whitelist. Is this the right export?");
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, stringify(kept, { header: true }));

const perClub = new Map<string, number>();
for (const r of kept) perClub.set(r.club_name, (perClub.get(r.club_name) ?? 0) + 1);

console.log(`Wrote ${kept.length} players from ${perClub.size} clubs to ${outPath}`);
for (const [club, n] of [...perClub].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${club.padEnd(26)} ${n}`);
}
