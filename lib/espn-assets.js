/**
 * ESPN and Flix use several matchup separators. Flix also appends a broadcast
 * competition after a middle dot; keep that suffix out of the participant
 * names so ESPN's team search receives exact names.
 */
export function parseEpgMatchup(title) {
  const matchup = String(title || "")
    .split(/\s*[·|•]\s*/)[0]
    .replace(/^\s*(?:next\s*:\s*)/i, "")
    .trim();

  // Explicit matchup markers must win over a dash used as a channel prefix.
  // EPG labels commonly look like "NYK - Knicks vs Toronto Raptors"; splitting
  // at the first dash turns the marker and half the matchup into fake teams.
  let match = matchup.match(/^(.+?)\s+(?:vs\.?|versus|v\.?|@|at)\s+(.+)$/i);
  if (!match) match = matchup.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!match) return null;
  const teams = match.slice(1).map(value => value.trim().replace(/^(?:NHL|NBA|NFL|MLB|NBL|NRL|AFL|MLR)\s+/i, ""));
  // Some feeds prefix a full team name with its short code, e.g. "NYK - Knicks".
  // Remove that code only when a full name follows it; retain standalone codes
  // such as "AZ" that are themselves the only team label in the matchup.
  teams[0] = teams[0].replace(/^[A-Z]{2,4}\s*[-–—]\s+(?=\S)/, "");
  return teams.length === 2 && teams.every(value => value.length >= 2) ? teams : null;
}
