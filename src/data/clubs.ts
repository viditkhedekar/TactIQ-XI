/**
 * The 20 real Premier League clubs, keyed by their EA club_team_id.
 *
 * The source export lists 22 clubs under the "Premier League" league name
 * (Dynamo Kyiv and Shakhtar Donetsk are grouped there by the data provider),
 * so every importer filters on these ids rather than on the league name.
 * Short codes and colours are maintained by hand: the export has neither.
 */

export type ClubSeed = {
  id: number;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
};

export const PL_CLUBS: ClubSeed[] = [
  { id: 1943, name: "AFC Bournemouth", shortName: "BOU", primaryColor: "#DA291C", secondaryColor: "#000000" },
  { id: 1, name: "Arsenal", shortName: "ARS", primaryColor: "#EF0107", secondaryColor: "#063672" },
  { id: 2, name: "Aston Villa", shortName: "AVL", primaryColor: "#95BFE5", secondaryColor: "#670E36" },
  { id: 1925, name: "Brentford", shortName: "BRE", primaryColor: "#E30613", secondaryColor: "#FBB800" },
  { id: 1808, name: "Brighton & Hove Albion", shortName: "BHA", primaryColor: "#0057B8", secondaryColor: "#FFCD00" },
  { id: 1796, name: "Burnley", shortName: "BUR", primaryColor: "#6C1D45", secondaryColor: "#99D6EA" },
  { id: 5, name: "Chelsea", shortName: "CHE", primaryColor: "#034694", secondaryColor: "#FFFFFF" },
  { id: 1799, name: "Crystal Palace", shortName: "CRY", primaryColor: "#1B458F", secondaryColor: "#C4122E" },
  { id: 7, name: "Everton", shortName: "EVE", primaryColor: "#003399", secondaryColor: "#FFFFFF" },
  { id: 144, name: "Fulham FC", shortName: "FUL", primaryColor: "#FFFFFF", secondaryColor: "#000000" },
  { id: 8, name: "Leeds United", shortName: "LEE", primaryColor: "#FFCD00", secondaryColor: "#1D428A" },
  { id: 9, name: "Liverpool", shortName: "LIV", primaryColor: "#C8102E", secondaryColor: "#00B2A9" },
  { id: 10, name: "Manchester City", shortName: "MCI", primaryColor: "#6CABDD", secondaryColor: "#1C2C5B" },
  { id: 11, name: "Manchester United", shortName: "MUN", primaryColor: "#DA291C", secondaryColor: "#FBE122" },
  { id: 13, name: "Newcastle United", shortName: "NEW", primaryColor: "#241F20", secondaryColor: "#FFFFFF" },
  { id: 14, name: "Nottingham Forest", shortName: "NFO", primaryColor: "#DD0000", secondaryColor: "#FFFFFF" },
  { id: 106, name: "Sunderland", shortName: "SUN", primaryColor: "#EB172B", secondaryColor: "#211E1F" },
  { id: 18, name: "Tottenham Hotspur", shortName: "TOT", primaryColor: "#132257", secondaryColor: "#FFFFFF" },
  { id: 19, name: "West Ham United", shortName: "WHU", primaryColor: "#7A263A", secondaryColor: "#1BB1E7" },
  { id: 110, name: "Wolverhampton Wanderers", shortName: "WOL", primaryColor: "#FDB913", secondaryColor: "#231F20" },
];

export const PL_CLUB_IDS: number[] = PL_CLUBS.map((c) => c.id);

export const CLUB_BY_ID: Map<number, ClubSeed> = new Map(PL_CLUBS.map((c) => [c.id, c]));
