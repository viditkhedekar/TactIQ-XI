/**
 * Clubs from outside the top flight.
 *
 * Two groups, both real names with invented squads. The second tier supplies
 * the three clubs promoted at the end of each season; the smaller clubs fill
 * the early rounds of the cup so there is somebody to be embarrassed by.
 *
 * These are seeded into the shared `clubs` and `players` tables alongside the
 * Premier League, once, by the import script. That is deliberate: generating a
 * promoted club's squad per career would mean writing career-specific rows into
 * tables every save reads from. Seeding the whole pool up front instead means
 * promotion is a matter of choosing three ids that already exist, and each
 * career's own `career_player_state` gives those players their per-save
 * condition exactly as it does for everybody else.
 *
 * Ids start at 9000 to stay clear of the EA club ids, which top out at 1943.
 */

import type { ClubSeed } from "./clubs";

/** Real second-tier clubs. Three are promoted at the end of each season. */
export const CHAMPIONSHIP_CLUBS: ClubSeed[] = [
  { id: 9001, name: "Leicester City", shortName: "LEI", primaryColor: "#003090", secondaryColor: "#FDBE11" },
  { id: 9002, name: "Southampton", shortName: "SOU", primaryColor: "#D71920", secondaryColor: "#130C0E" },
  { id: 9003, name: "Ipswich Town", shortName: "IPS", primaryColor: "#0044A9", secondaryColor: "#FFFFFF" },
  { id: 9004, name: "Norwich City", shortName: "NOR", primaryColor: "#FFF200", secondaryColor: "#00A650" },
  { id: 9005, name: "Sheffield United", shortName: "SHU", primaryColor: "#EE2737", secondaryColor: "#000000" },
  { id: 9006, name: "West Bromwich Albion", shortName: "WBA", primaryColor: "#122F67", secondaryColor: "#FFFFFF" },
  { id: 9007, name: "Middlesbrough", shortName: "MID", primaryColor: "#E21C38", secondaryColor: "#FFFFFF" },
  { id: 9008, name: "Coventry City", shortName: "COV", primaryColor: "#78D0F3", secondaryColor: "#000000" },
  { id: 9009, name: "Hull City", shortName: "HUL", primaryColor: "#F5971D", secondaryColor: "#000000" },
  { id: 9010, name: "Preston North End", shortName: "PRE", primaryColor: "#B2B2B2", secondaryColor: "#00317F" },
  { id: 9011, name: "Bristol City", shortName: "BRC", primaryColor: "#E21C38", secondaryColor: "#FFFFFF" },
  { id: 9012, name: "Cardiff City", shortName: "CAR", primaryColor: "#0070B5", secondaryColor: "#FFFFFF" },
  { id: 9013, name: "Swansea City", shortName: "SWA", primaryColor: "#FFFFFF", secondaryColor: "#000000" },
  { id: 9014, name: "Stoke City", shortName: "STK", primaryColor: "#E03A3E", secondaryColor: "#1B449C" },
  { id: 9015, name: "Watford", shortName: "WAT", primaryColor: "#FBEE23", secondaryColor: "#ED2127" },
  { id: 9016, name: "Millwall", shortName: "MIL", primaryColor: "#001D5E", secondaryColor: "#FFFFFF" },
  { id: 9017, name: "Blackburn Rovers", shortName: "BLB", primaryColor: "#009EE0", secondaryColor: "#FFFFFF" },
  { id: 9018, name: "Queens Park Rangers", shortName: "QPR", primaryColor: "#1D5BA4", secondaryColor: "#FFFFFF" },
  { id: 9019, name: "Sheffield Wednesday", shortName: "SHW", primaryColor: "#0066B3", secondaryColor: "#FFFFFF" },
  { id: 9020, name: "Derby County", shortName: "DER", primaryColor: "#FFFFFF", secondaryColor: "#000000" },
  { id: 9021, name: "Portsmouth", shortName: "POR", primaryColor: "#001489", secondaryColor: "#FFFFFF" },
  { id: 9022, name: "Oxford United", shortName: "OXF", primaryColor: "#FFE500", secondaryColor: "#00205B" },
  { id: 9023, name: "Plymouth Argyle", shortName: "PLY", primaryColor: "#007B5F", secondaryColor: "#FFFFFF" },
  { id: 9024, name: "Luton Town", shortName: "LUT", primaryColor: "#F78F1E", secondaryColor: "#002D62" },
];

/**
 * Smaller clubs, for the opening rounds of the cup only. They never play in
 * the league and are never promoted, so their squads can be thinner and worse.
 */
export const CUP_CLUBS: ClubSeed[] = [
  { id: 9101, name: "Wrexham", shortName: "WRX", primaryColor: "#DA291C", secondaryColor: "#FFFFFF" },
  { id: 9102, name: "Bolton Wanderers", shortName: "BOL", primaryColor: "#FFFFFF", secondaryColor: "#122A5C" },
  { id: 9103, name: "Charlton Athletic", shortName: "CHA", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9104, name: "Barnsley", shortName: "BAR", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9105, name: "Peterborough United", shortName: "PET", primaryColor: "#0072CE", secondaryColor: "#FFFFFF" },
  { id: 9106, name: "Wigan Athletic", shortName: "WIG", primaryColor: "#0086D6", secondaryColor: "#FFFFFF" },
  { id: 9107, name: "Blackpool", shortName: "BLA", primaryColor: "#F68712", secondaryColor: "#FFFFFF" },
  { id: 9108, name: "Lincoln City", shortName: "LIN", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9109, name: "Exeter City", shortName: "EXE", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9110, name: "Stevenage", shortName: "STE", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9111, name: "Mansfield Town", shortName: "MAN", primaryColor: "#FFE500", secondaryColor: "#0033A0" },
  { id: 9112, name: "Bradford City", shortName: "BRA", primaryColor: "#F5971D", secondaryColor: "#7B2D26" },
  { id: 9113, name: "Notts County", shortName: "NOT", primaryColor: "#000000", secondaryColor: "#FFFFFF" },
  { id: 9114, name: "Grimsby Town", shortName: "GRI", primaryColor: "#000000", secondaryColor: "#FFFFFF" },
  { id: 9115, name: "Salford City", shortName: "SAL", primaryColor: "#E31B23", secondaryColor: "#FFFFFF" },
  { id: 9116, name: "Accrington Stanley", shortName: "ACC", primaryColor: "#E31B23", secondaryColor: "#000000" },
];

export const CHAMPIONSHIP_CLUB_IDS = CHAMPIONSHIP_CLUBS.map((c) => c.id);
export const CUP_CLUB_IDS = CUP_CLUBS.map((c) => c.id);

/** Every club outside the top flight, which is what the importer seeds. */
export const ALL_LOWER_CLUBS: ClubSeed[] = [...CHAMPIONSHIP_CLUBS, ...CUP_CLUBS];

/**
 * How good each tier is, as the average overall of its best sixteen.
 *
 * The Premier League runs from about 70 at the bottom to 86 at the top, so a
 * promoted club at 68 is a plausible relegation favourite rather than a free
 * three points, and a cup club at 55 can only win on a bad day. Those bad days
 * are the point of putting them in.
 */
export const TIER_STRENGTH = {
  championship: { mean: 68, spread: 4 },
  lower: { mean: 55, spread: 5 },
} as const;
