const ODDS_BASE = "https://api.the-odds-api.com/v4";

const MARKETS = ["h2h", "totals", "spreads", "btts"];
const MAX_SPORTS_TO_SCAN = 14;

async function safeJsonFetch(url, options = {}) {
  try {
    const r = await fetch(url, { ...options, cache: "no-store" });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e?.message || String(e) };
  }
}

async function getSoccerSports(key) {
  if (!key) return ["soccer"];

  const r = await safeJsonFetch(`${ODDS_BASE}/sports/?apiKey=${key}`);

  if (!r.ok || !Array.isArray(r.data)) return ["soccer"];

  const sports = r.data.filter(
    s => String(s.key || "").startsWith("soccer_") && s.active !== false
  );

  const priority = [
    "soccer",
    "soccer_fifa_world_cup",
    "soccer_uefa_european_championship",
    "soccer_conmebol_copa_america",
    "soccer_brazil_campeonato",
    "soccer_brazil_serie_b",
    "soccer_japan_j_league",
    "soccer_japan_j_league_2",
    "soccer_norway_eliteserien",
    "soccer_sweden_allsvenskan",
    "soccer_korea_kleague1",
    "soccer_usa_mls",
    "soccer_china_superleague",
    "soccer_argentina_primera_division"
  ];

  return [...new Set(["soccer", ...priority, ...sports.map(s => s.key)])].slice(0, MAX_SPORTS_TO_SCAN);
}

async function getOddsForSport(sport, key) {
  if (!key) return [];

  const url = `${ODDS_BASE}/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`;

  const r = await safeJsonFetch(url);

  if (!r.ok || !Array.isArray(r.data)) return [];

  return r.data.map(ev => ({
    ...ev,
    sportKey: sport,
    _source: "the-odds-api"
  }));
}

export async function getAllOddsEvents(oddsKey, footballKey) {
  const sports = await getSoccerSports(oddsKey);

  let events = [];

  for (const sport of sports) {
    const rows = await getOddsForSport(sport, oddsKey);
    events.push(...rows);
  }

  const seen = new Set();

  events = events.filter(ev => {
    const id = ev.id || `${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    events,
    sourceUsed: events.length ? "the-odds-api" : "none",
    oddsApiWorking: events.length > 0
  };
}

export async function getFootyStats(home, away, key) {
  if (!key) {
    return {
      xgBoost: 0,
      note: "FootyStats dezactivat"
    };
  }

  return {
    xgBoost: 0,
    note: "FootyStats activ, dar fără mapping sigur momentan"
  };
}

export async function getClubElo(home, away) {
  return {
    eloBoost: 0,
    note: "ClubELO dezactivat temporar pentru stabilitate"
  };
}
