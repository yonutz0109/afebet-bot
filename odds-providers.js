/**
 * odds-providers.js — SafeBet Bot v7.1
 * Fallback chain: The Odds API → API-Football odds → OpenLigaDB
 * CommonJS pentru Vercel Serverless
 */

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const FOOTBALL_API = "https://v3.football.api-sports.io";
const OPENLIGADB_BASE = "https://api.openligadb.de";
const FOOTYSTATS_BASE = "https://api.footystats.org";
const CLUBELO_BASE = "https://api.clubelo.com"; // https în loc de http — mixed content fix

const MARKETS = ["h2h", "totals", "spreads", "btts"];
const MAX_SPORTS = 14;

// ─── helpers ──────────────────────────────────────────────────────────────────

async function safeFetch(url, headers = {}, timeoutMs = 6000) {
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

function makeEvent(id, home, away, commence, bookmaker, h2h, totals, btts, source) {
  const bookmakers = [];
  if (h2h?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "h2h", outcomes: h2h }] });
  if (totals?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "totals", outcomes: totals }] });
  if (btts?.length) bookmakers.push({ title: bookmaker, markets: [{ key: "btts", outcomes: btts }] });
  return { id, home_team: home, away_team: away, commence_time: commence, bookmakers, _source: source };
}

// ─── Provider 1: The Odds API ─────────────────────────────────────────────────

async function getSoccerSports(key) {
  const r = await safeFetch(`${ODDS_BASE}/sports/?apiKey=${key}`);
  if (!r.ok || !Array.isArray(r.data)) return ["soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga"];
  const priority = [
    "soccer_epl","soccer_spain_la_liga","soccer_germany_bundesliga",
    "soccer_italy_serie_a","soccer_france_ligue_one","soccer_uefa_champs_league",
    "soccer_usa_mls","soccer_brazil_campeonato","soccer_argentina_primera_division",
    "soccer_portugal_primeira_liga","soccer_netherlands_eredivisie",
    "soccer_turkey_super_league","soccer_mexico_ligamx","soccer_romania_liga1"
  ];
  const active = r.data.filter(s => String(s.key||"").startsWith("soccer_") && s.active !== false).map(s => s.key);
  return [...new Set([...priority, ...active])].slice(0, MAX_SPORTS);
}

async function fetchOddsAPI(key) {
  if (!key) return [];
  try {
    const sports = await getSoccerSports(key);
    const results = await Promise.allSettled(
      sports.map(sport =>
        safeFetch(`${ODDS_BASE}/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`)
          .then(r => r.ok && Array.isArray(r.data) ? r.data.map(ev => ({ ...ev, sportKey: sport, _source: "odds-api" })) : [])
      )
    );
    const events = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    const seen = new Set();
    return events.filter(ev => {
      const id = ev.id || `${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
  } catch (e) { return []; }
}

// ─── Provider 2: API-Football odds ────────────────────────────────────────────

async function fetchAPIFootballOdds(key) {
  if (!key) return [];
  try {
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
      const toO = (vals) => (vals||[]).map(v => ({ name: v.value, price: parseFloat(v.odd)||0 })).filter(o => o.price > 0);
      return [makeEvent(
        `aff_${home}_${away}`, home, away, commence, bk.name||"API-Football",
        toO(bk.bets?.find(b => b.name==="Match Winner")?.values),
        toO(bk.bets?.find(b => b.name==="Goals Over/Under")?.values),
        toO(bk.bets?.find(b => b.name==="Both Teams Score")?.values),
        "api-football-odds"
      )];
    });
  } catch (e) { return []; }
}

// ─── Provider 3: OpenLigaDB ───────────────────────────────────────────────────

async function fetchOpenLigaDB() {
  try {
    const leagues = [
      { key: "bl1", season: "2024" },
      { key: "bl2", season: "2024" }
    ];
    const results = await Promise.allSettled(
      leagues.map(l => safeFetch(`${OPENLIGADB_BASE}/getmatchdata/${l.key}/${l.season}`))
    );
    const now = Date.now();
    const events = [];
    for (const res of results) {
      if (res.status !== "fulfilled" || !res.value.ok) continue;
      for (const m of Array.isArray(res.value.data) ? res.value.data : []) {
        const commence = m.MatchDateTime ? new Date(m.MatchDateTime).toISOString() : new Date().toISOString();
        if (new Date(commence).getTime() < now - 3 * 3600000) continue;
        const home = m.Team1?.TeamName || "Gazde";
        const away = m.Team2?.TeamName || "Oaspeți";
        events.push(makeEvent(
          `oldb_${m.MatchID}`, home, away, commence, "OpenLigaDB",
          [{ name: home, price: 2.10 }, { name: "Draw", price: 3.20 }, { name: away, price: 3.10 }],
          [], [], "openligadb"
        ));
      }
    }
    return events;
  } catch (e) { return []; }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function getAllOddsEvents(oddsKey, footballKey) {
  const [oddsEvents, apifEvents, oldbEvents] = await Promise.all([
    fetchOddsAPI(oddsKey),
    fetchAPIFootballOdds(footballKey),
    fetchOpenLigaDB()
  ]);
  let events = [], sourceUsed = [];
  if (oddsEvents.length) { events.push(...oddsEvents); sourceUsed.push("The Odds API"); }
  if (apifEvents.length) { events.push(...apifEvents); sourceUsed.push("API-Football Odds"); }
  if (oldbEvents.length) { events.push(...oldbEvents); sourceUsed.push("OpenLigaDB"); }
  if (!events.length) sourceUsed.push("⚠️ nicio sursă disponibilă");
  const seen = new Set();
  events = events.filter(ev => {
    const id = ev.id || `${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  return { events, sourceUsed, oddsApiWorking: oddsEvents.length > 0 };
}

// ─── FootyStats xG ────────────────────────────────────────────────────────────

const footyCache = new Map();

async function getFootyStats(home, away, key) {
  if (!key) return { xgBoost: 0, bttsRate: null, note: "FOOTYSTATS_KEY lipsește." };
  const ck = `${home}|${away}`;
  if (footyCache.has(ck)) return footyCache.get(ck);
  try {
    const [rh, ra] = await Promise.all([
      safeFetch(`${FOOTYSTATS_BASE}/team?key=${key}&team_name=${encodeURIComponent(home)}`),
      safeFetch(`${FOOTYSTATS_BASE}/team?key=${key}&team_name=${encodeURIComponent(away)}`)
    ]);
    const hd = rh.data?.data?.[0] || rh.data?.[0];
    const ad = ra.data?.data?.[0] || ra.data?.[0];
    if (!hd || !ad) { const v={xgBoost:0,bttsRate:null,note:"FootyStats: echipe negăsite."}; footyCache.set(ck,v); return v; }
    const hXg = parseFloat(hd.stats?.xg_for_avg_overall||hd.xg_for_avg||0);
    const aXg = parseFloat(ad.stats?.xg_for_avg_overall||ad.xg_for_avg||0);
    const totalXg = hXg + aXg;
    const bttsRate = ((parseFloat(hd.stats?.btts_percentage_overall||0)+parseFloat(ad.stats?.btts_percentage_overall||0))/2);
    const xgBoost = totalXg >= 3.0 ? 3 : totalXg >= 2.5 ? 2 : totalXg >= 2.0 ? 1 : 0;
    const v = { xgBoost, bttsRate: bttsRate||null, homeXg: hXg, awayXg: aXg, totalXg, note: `xG: ${hXg.toFixed(2)}+${aXg.toFixed(2)}=${totalXg.toFixed(2)}, BTTS ${bttsRate.toFixed(0)}%. Bonus: +${xgBoost}.` };
    footyCache.set(ck, v); return v;
  } catch (e) { const v={xgBoost:0,bttsRate:null,note:"FootyStats eroare."}; footyCache.set(ck,v); return v; }
}

// ─── ClubELO ──────────────────────────────────────────────────────────────────

const eloCache = new Map();

async function getClubElo(home, away) {
  const ck = `${home}|${away}`;
  if (eloCache.has(ck)) return eloCache.get(ck);
  try {
    const simplify = n => n.split(" ").pop();
    const [rh, ra] = await Promise.all([
      safeFetch(`${CLUBELO_BASE}/${encodeURIComponent(simplify(home))}`),
      safeFetch(`${CLUBELO_BASE}/${encodeURIComponent(simplify(away))}`)
    ]);
    const parseElo = d => {
      if (!d) return null;
      if (Array.isArray(d)) return parseFloat(d[0]?.Elo)||null;
      if (typeof d === "string") {
        const last = d.split("\n").filter(l => l.trim() && !l.startsWith("Club")).pop();
        return last ? parseFloat(last.split(",")[4])||null : null;
      }
      return null;
    };
    const homeElo = parseElo(rh.data), awayElo = parseElo(ra.data);
    if (!homeElo || !awayElo) { const v={eloBoost:0,homeElo:null,awayElo:null,note:"ClubELO: date indisponibile."}; eloCache.set(ck,v); return v; }
    const diff = homeElo - awayElo;
    const homeWinProb = Math.round(1/(1+Math.pow(10,-diff/400))*100);
    const eloBoost = Math.abs(diff)>=200?3:Math.abs(diff)>=100?2:Math.abs(diff)>=50?1:0;
    const v = { eloBoost, homeElo, awayElo, eloDiff: Math.round(diff), homeWinProb, note: `ELO: ${Math.round(homeElo)} vs ${Math.round(awayElo)} (diff ${Math.round(diff)}, prob ${homeWinProb}%). Bonus: +${eloBoost}.` };
    eloCache.set(ck, v); return v;
  } catch (e) { const v={eloBoost:0,homeElo:null,awayElo:null,note:"ClubELO eroare."}; eloCache.set(ck,v); return v; }
}

export { getAllOddsEvents, getFootyStats, getClubElo };
