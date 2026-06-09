/**
 * odds-providers.js
 * Fallback chain: The Odds API → API-Football odds → OpenLigaDB → synthetic fallback
 * Returnează mereu același format: Array<OddsEvent>
 */

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const FOOTBALL_API = "https://v3.football.api-sports.io";
const OPENLIGADB_BASE = "https://api.openligadb.de";
const FOOTYSTATS_BASE = "https://api.footystats.org";
const CLUBELO_BASE = "http://api.clubelo.com";

const MARKETS = ["h2h", "totals", "spreads", "btts"];
const MAX_SPORTS = 14;

// ─── helpers ─────────────────────────────────────────────────────────────────

async function safeFetch(url, headers = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal, headers });
    clearTimeout(t);
    if (!r.ok) return { ok: false, status: r.status, data: null };
    const data = await r.json().catch(() => null);
    return { ok: true, status: r.status, data };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: 0, data: null, error: e?.name };
  }
}

function makeEvent(id, home, away, commence, bookmaker, outcomes_h2h, outcomes_totals, outcomes_btts, source) {
  const bookmakers = [];
  if (outcomes_h2h?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "h2h", outcomes: outcomes_h2h }] });
  if (outcomes_totals?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "totals", outcomes: outcomes_totals }] });
  if (outcomes_btts?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "btts", outcomes: outcomes_btts }] });
  return { id, home_team: home, away_team: away, commence_time: commence, bookmakers, _source: source };
}

// ─── Provider 1: The Odds API ─────────────────────────────────────────────────

async function getSoccerSportsOddsAPI(key) {
  const r = await safeFetch(`${ODDS_BASE}/sports/?apiKey=${key}`);
  if (!r.ok || !Array.isArray(r.data)) return ["soccer_epl"];
  const sports = r.data.filter(s => String(s.key || "").startsWith("soccer_") && s.active !== false);
  const priority = [
    "soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga",
    "soccer_italy_serie_a", "soccer_france_ligue_one", "soccer_uefa_champs_league",
    "soccer_fifa_world_cup", "soccer_usa_mls", "soccer_brazil_campeonato",
    "soccer_argentina_primera_division", "soccer_portugal_primeira_liga",
    "soccer_netherlands_eredivisie", "soccer_turkey_super_league", "soccer_mexico_ligamx"
  ];
  const keys = [...new Set([...priority, ...sports.map(s => s.key)])];
  return keys.slice(0, MAX_SPORTS);
}

async function fetchOddsAPI(key) {
  try {
    const sports = await getSoccerSportsOddsAPI(key);
    const results = await Promise.allSettled(
      sports.map(sport =>
        safeFetch(`${ODDS_BASE}/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`)
          .then(r => (r.ok && Array.isArray(r.data) ? r.data.map(ev => ({ ...ev, sportKey: sport, _source: "odds-api" })) : []))
      )
    );
    const events = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    // deduplicate
    const seen = new Set();
    return events.filter(ev => {
      const id = ev.id || `${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
  } catch (e) {
    return [];
  }
}

// ─── Provider 2: API-Football odds (fallback) ─────────────────────────────────

async function fetchAPIFootballOdds(key) {
  if (!key) return [];
  try {
    // Upcoming fixtures next 2 days
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const [r1, r2] = await Promise.all([
      safeFetch(`${FOOTBALL_API}/odds?date=${today}&bookmaker=8`, { "x-apisports-key": key }),
      safeFetch(`${FOOTBALL_API}/odds?date=${tomorrow}&bookmaker=8`, { "x-apisports-key": key })
    ]);
    const rows = [
      ...(Array.isArray(r1.data?.response) ? r1.data.response : []),
      ...(Array.isArray(r2.data?.response) ? r2.data.response : [])
    ];
    return rows.flatMap(row => {
      const fix = row.fixture || {};
      const home = fix.teams?.home?.name || row.teams?.home?.name || "Gazde";
      const away = fix.teams?.away?.name || row.teams?.away?.name || "Oaspeți";
      const commence = fix.date || new Date().toISOString();
      const bk = row.bookmakers?.[0];
      if (!bk) return [];
      const h2hMarket = bk.bets?.find(b => b.name === "Match Winner");
      const totalsMarket = bk.bets?.find(b => b.name === "Goals Over/Under");
      const bttsMarket = bk.bets?.find(b => b.name === "Both Teams Score");
      const toOutcomes = (values) => (values || []).map(v => ({ name: v.value, price: parseFloat(v.odd) || 0 })).filter(o => o.price > 0);
      return [makeEvent(
        `aff_${home}_${away}`, home, away, commence, bk.name || "API-Football Odds",
        toOutcomes(h2hMarket?.values),
        toOutcomes(totalsMarket?.values),
        toOutcomes(bttsMarket?.values),
        "api-football-odds"
      )];
    });
  } catch (e) { return []; }
}

// ─── Provider 3: OpenLigaDB (Bundesliga + alte ligi GER, fără cheie) ──────────

async function fetchOpenLigaDB() {
  try {
    const leagues = [
      { key: "bl1", season: "2024" },
      { key: "bl2", season: "2024" },
      { key: "dfb", season: "2024" }
    ];
    const results = await Promise.allSettled(
      leagues.map(l => safeFetch(`${OPENLIGADB_BASE}/getmatchdata/${l.key}/${l.season}`))
    );
    const now = Date.now();
    const events = [];
    for (const res of results) {
      if (res.status !== "fulfilled" || !res.value.ok) continue;
      const matches = Array.isArray(res.value.data) ? res.value.data : [];
      for (const m of matches) {
        const commence = m.MatchDateTime ? new Date(m.MatchDateTime).toISOString() : new Date().toISOString();
        // only future/live matches
        if (new Date(commence).getTime() < now - 3 * 3600 * 1000) continue;
        const home = m.Team1?.TeamName || "Gazde";
        const away = m.Team2?.TeamName || "Oaspeți";
        // OpenLigaDB nu are cote proprii — generăm cote neutre (50/50 ajustate)
        // ca fallback structural (botul le va nota cu safeScore mic)
        const syntheticH2H = [
          { name: home, price: 2.10 },
          { name: "Draw", price: 3.20 },
          { name: away, price: 3.10 }
        ];
        events.push(makeEvent(
          `oldb_${m.MatchID}`, home, away, commence, "OpenLigaDB",
          syntheticH2H, [], [], "openligadb"
        ));
      }
    }
    return events;
  } catch (e) { return []; }
}

// ─── Orchestrator: încearcă în ordine, combină ────────────────────────────────

export async function getAllOddsEvents(oddsKey, footballKey) {
  // Lansăm toți providerii în paralel pentru viteză
  const [oddsEvents, apifEvents, oldbEvents] = await Promise.all([
    oddsKey ? fetchOddsAPI(oddsKey) : Promise.resolve([]),
    footballKey ? fetchAPIFootballOdds(footballKey) : Promise.resolve([]),
    fetchOpenLigaDB()
  ]);

  const oddsOk = oddsEvents.length > 0;
  const apifOk = apifEvents.length > 0;

  let events = [];
  let sourceUsed = [];

  if (oddsOk) { events.push(...oddsEvents); sourceUsed.push("The Odds API"); }
  if (apifOk) { events.push(...apifEvents); sourceUsed.push("API-Football Odds"); }
  if (oldbEvents.length > 0) { events.push(...oldbEvents); sourceUsed.push("OpenLigaDB"); }

  // Dacă nimic nu a funcționat — notificăm dar nu crăpăm
  if (events.length === 0) {
    sourceUsed.push("⚠️ nicio sursă de cote disponibilă");
  }

  // Dedup global
  const seen = new Set();
  events = events.filter(ev => {
    const id = ev.id || `${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });

  return { events, sourceUsed, oddsApiWorking: oddsOk };
}

// ─── FootyStats: xG + BTTS rate ──────────────────────────────────────────────

const footyCache = new Map();

export async function getFootyStats(home, away, key) {
  if (!key) return { xgBoost: 0, bttsRate: null, note: "FOOTYSTATS_KEY lipsește." };
  const ck = `${home}|${away}`;
  if (footyCache.has(ck)) return footyCache.get(ck);
  try {
    // Căutăm echipele în FootyStats
    const [rh, ra] = await Promise.all([
      safeFetch(`${FOOTYSTATS_BASE}/team?key=${key}&team_name=${encodeURIComponent(home)}`),
      safeFetch(`${FOOTYSTATS_BASE}/team?key=${key}&team_name=${encodeURIComponent(away)}`)
    ]);
    const hd = rh.data?.data?.[0] || rh.data?.[0];
    const ad = ra.data?.data?.[0] || ra.data?.[0];
    if (!hd || !ad) {
      const v = { xgBoost: 0, bttsRate: null, note: "FootyStats: echipe negăsite." };
      footyCache.set(ck, v); return v;
    }
    const hXg = parseFloat(hd.stats?.xg_for_avg_overall || hd.xg_for_avg || 0);
    const aXg = parseFloat(ad.stats?.xg_for_avg_overall || ad.xg_for_avg || 0);
    const hBtts = parseFloat(hd.stats?.btts_percentage_overall || hd.btts_percentage || 0);
    const aBtts = parseFloat(ad.stats?.btts_percentage_overall || ad.btts_percentage || 0);
    const totalXg = hXg + aXg;
    const bttsRate = (hBtts + aBtts) / 2;
    let xgBoost = 0;
    if (totalXg >= 3.0) xgBoost += 3;
    else if (totalXg >= 2.5) xgBoost += 2;
    else if (totalXg >= 2.0) xgBoost += 1;
    const v = {
      xgBoost, bttsRate: bttsRate || null,
      homeXg: hXg, awayXg: aXg, totalXg,
      note: `FootyStats xG: ${hXg.toFixed(2)}+${aXg.toFixed(2)}=${totalXg.toFixed(2)}, BTTS ${bttsRate.toFixed(0)}%. Bonus xG: +${xgBoost}.`
    };
    footyCache.set(ck, v); return v;
  } catch (e) {
    const v = { xgBoost: 0, bttsRate: null, note: "FootyStats eroare." };
    footyCache.set(ck, v); return v;
  }
}

// ─── ClubELO: ratinguri ELO per echipă ───────────────────────────────────────

const eloCache = new Map();

export async function getClubElo(home, away) {
  const ck = `${home}|${away}`;
  if (eloCache.has(ck)) return eloCache.get(ck);
  try {
    // ClubELO acceptă nume simplu, ex: "Chelsea", "Bayern"
    const simplify = name => name.split(" ").slice(-1)[0]; // ultimul cuvânt
    const [rh, ra] = await Promise.all([
      safeFetch(`${CLUBELO_BASE}/${encodeURIComponent(simplify(home))}`),
      safeFetch(`${CLUBELO_BASE}/${encodeURIComponent(simplify(away))}`)
    ]);
    const parseElo = (data) => {
      if (!data) return null;
      if (typeof data === "string") {
        const lines = data.split("\n");
        const last = lines.filter(l => l.trim() && !l.startsWith("Club")).pop();
        return last ? parseFloat(last.split(",")[4]) || null : null;
      }
      if (Array.isArray(data)) return parseFloat(data[0]?.Elo) || null;
      return null;
    };
    const homeElo = parseElo(rh.data);
    const awayElo = parseElo(ra.data);
    if (!homeElo || !awayElo) {
      const v = { eloBoost: 0, homeElo: null, awayElo: null, note: "ClubELO: date indisponibile." };
      eloCache.set(ck, v); return v;
    }
    const diff = homeElo - awayElo;
    // Probabilitate ELO: P = 1 / (1 + 10^(-diff/400))
    const homeWinProb = Math.round(1 / (1 + Math.pow(10, -diff / 400)) * 100);
    let eloBoost = 0;
    if (Math.abs(diff) >= 200) eloBoost += 3;
    else if (Math.abs(diff) >= 100) eloBoost += 2;
    else if (Math.abs(diff) >= 50) eloBoost += 1;
    const v = { eloBoost, homeElo, awayElo, eloDiff: Math.round(diff), homeWinProb, note: `ELO: ${home} ${Math.round(homeElo)} vs ${away} ${Math.round(awayElo)} (diff ${Math.round(diff)}, prob gazde ${homeWinProb}%). Bonus: +${eloBoost}.` };
    eloCache.set(ck, v); return v;
  } catch (e) {
    const v = { eloBoost: 0, homeElo: null, awayElo: null, note: "ClubELO eroare." };
    eloCache.set(ck, v); return v;
  }
}
