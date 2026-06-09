// SafeBet Bot api/scan.js v7.3.3 final - generated 1781001464
/**
 * scan.js — SafeBet Bot v7.1
 * CommonJS pentru Vercel Serverless
 * Fallback complet: Odds API → API-Football → OpenLigaDB
 * Scoring: baza probabilitate + formă + H2H + xG + ELO + Flashscore + timp
 * Fără oprire la epuizare credite — trece automat la sursa următoare
 */

const { getAllOddsEvents, getFootyStats, getClubElo } = require("./odds-providers.js");
const { getFlashscoreContext } = require("../flashscore.js");

const FOOTBALL_API = "https://v3.football.api-sports.io";
const MIN_SAFE_SCORE = 62; // prag coborât realist — dacă nu există >75, afișăm tot ce e mai bun

// ─── helpers ──────────────────────────────────────────────────────────────────

function marketLabel(k) {
  return ({
    h2h: "1X2", totals: "Goluri over/under", spreads: "Handicap", btts: "Ambele marchează",
    live_home: "LIVE 1", live_away: "LIVE 2", live_draw: "LIVE X",
    live_over15: "LIVE peste 1.5", live_over25: "LIVE peste 2.5", live_next_goal: "LIVE gol următor"
  }[k] || k || "necunoscută");
}

function category(k) {
  if (k === "h2h") return "h2h";
  if ((k||"").includes("total")) return "totals";
  if ((k||"").includes("spread")) return "spreads";
  if (k === "btts") return "btts";
  if ((k||"").startsWith("live_")) return "live";
  return "other";
}

/**
 * baseScore — probabilitate implicită din cotă + penalizări/bonusuri structurale
 * Nu se bazează pe cotă ca singur criteriu: cota mică nu = safe în fotbal real
 */
function baseScore(odd, market) {
  const impliedProb = Math.round((1 / Number(odd)) * 100);
  let s = impliedProb;
  // Penalizări per piață (marginea bookmaker este mai mare la anumite piețe)
  if (market === "h2h") s -= 5;
  if ((market||"").includes("total")) s -= 2;
  if ((market||"").includes("spread")) s -= 4;
  if (market === "btts") s -= 3;
  if ((market||"").startsWith("live_")) s -= 1;
  // Zona "safe" — cote 1.15–1.55: probabilitate implicită ridicată, margine bookmaker acceptabilă
  if (odd >= 1.15 && odd <= 1.35) s += 10;
  else if (odd > 1.35 && odd <= 1.55) s += 6;
  else if (odd > 1.55 && odd <= 1.75) s -= 8;
  else if (odd > 1.75 && odd <= 2.00) s -= 18;
  else if (odd > 2.00) s -= 28;
  return Math.max(0, Math.min(92, s));
}

function pickLabel(outcome, market, home, away) {
  const n = outcome?.name || "";
  const p = outcome?.point != null ? ` ${outcome.point}` : "";
  if (market === "h2h") {
    if (n === home) return "1 — câștigă gazdele";
    if (n === away) return "2 — câștigă oaspeții";
    if (n === "Draw") return "X — egal";
  }
  if ((market||"").includes("total")) return `${n}${p} goluri`;
  if ((market||"").includes("spread")) return `${n} handicap${p}`;
  if (market === "btts") return n === "Yes" ? "Da — ambele marchează" : "Nu — cel puțin una nu marchează";
  return `${n}${p}`.trim() || "Selecție";
}

function roDate(iso) {
  return iso ? new Date(iso).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "—";
}

function addTop(list, c, maxSize = 10) {
  list.push(c);
  list.sort((a, b) => (b.safeScore||0) - (a.safeScore||0));
  if (list.length > maxSize) list.pop();
}

function clean(c) {
  if (!c) return c;
  const x = { ...c };
  delete x.rawScore;
  return x;
}

function timeInfo(iso) {
  const start = iso ? new Date(iso).getTime() : 0, now = Date.now();
  const diffMin = (start - now) / 60000;
  if (start && diffMin <= 0 && diffMin > -150) return { status: "🔴 LIVE ACUM", boost: 4, key: "live" };
  if (start && diffMin > 0 && diffMin <= 60)  return { status: "⚡ ÎNCEPE CURÂND", boost: 3, key: "soon" };
  if (start && diffMin > 60 && diffMin <= 240) return { status: "📅 AZI", boost: 1, key: "today" };
  return { status: "PRE-MATCH", boost: 0, key: "prematch" };
}

// ─── Nivel de încredere text ──────────────────────────────────────────────────

function confidenceLabel(score) {
  if (score >= 82) return { label: "🟢 FOARTE SIGUR", color: "green" };
  if (score >= 72) return { label: "🟡 SIGUR", color: "yellow" };
  if (score >= 62) return { label: "🟠 ACCEPTABIL", color: "orange" };
  return { label: "🔴 RISC MARE", color: "red" };
}

// ─── API-Football fetch ───────────────────────────────────────────────────────

async function footballFetch(path, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(`${FOOTBALL_API}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

const teamCache = new Map(), statsCache = new Map();

async function findTeamId(name, key) {
  if (teamCache.has(name)) return teamCache.get(name);
  const data = await footballFetch(`/teams?search=${encodeURIComponent(name)}`, key);
  const id = data?.response?.[0]?.team?.id || null;
  teamCache.set(name, id); return id;
}

function formString(fixtures, teamId) {
  const out = [];
  for (const f of fixtures || []) {
    const isHome = f.teams?.home?.id === teamId;
    const isAway = f.teams?.away?.id === teamId;
    if (!isHome && !isAway) continue;
    const hg = f.goals?.home, ag = f.goals?.away;
    if (hg == null || ag == null) continue;
    const gf = isHome ? hg : ag, ga = isHome ? ag : hg;
    out.push(gf > ga ? "W" : gf === ga ? "D" : "L");
    if (out.length >= 6) break;
  }
  return out.join("") || "n/a";
}

function formPoints(form) {
  return [...(form||"")].reduce((s, x) => s + (x==="W"?3:x==="D"?1:0), 0);
}


function rankingBoost(homeForm, awayForm) {
  const hp = formPoints(homeForm);
  const ap = formPoints(awayForm);
  const diff = hp - ap;
  if (diff >= 10) return 8;
  if (diff >= 6) return 5;
  if (diff >= 3) return 2;
  if (diff <= -10) return -8;
  if (diff <= -6) return -5;
  if (diff <= -3) return -2;
  return 0;
}

function homeAdvantageBoost() {
  return 2;
}

function officialMatchBoost(sportKey, dataSource) {
  const s = String(sportKey || "").toLowerCase();
  const d = String(dataSource || "").toLowerCase();
  if (s.includes("friendly") || s.includes("friendlies") || d.includes("friendly")) return -6;
  if (s.includes("soccer") || d) return 3;
  return 0;
}

function lowOddPenalty(odd) {
  const n = Number(odd);
  if (!n || Number.isNaN(n)) return 0;
  if (n < 1.08) return -10;
  if (n < 1.12) return -5;
  return 0;
}

async function getFootballStats(home, away, key) {
  if (!key) return { boost: 0, note: "API_FOOTBALL_KEY lipsește.", homeForm: "n/a", awayForm: "n/a", h2hCount: 0 };
  const ck = `${home}|${away}`;
  if (statsCache.has(ck)) return statsCache.get(ck);
  try {
    const [homeId, awayId] = await Promise.all([findTeamId(home, key), findTeamId(away, key)]);
    if (!homeId || !awayId) {
      const v = { boost: 0, note: "Echipele negăsite.", homeForm: "n/a", awayForm: "n/a", h2hCount: 0 };
      statsCache.set(ck, v); return v;
    }
    const [hf, af, h2h] = await Promise.all([
      footballFetch(`/fixtures?team=${homeId}&last=6`, key),
      footballFetch(`/fixtures?team=${awayId}&last=6`, key),
      footballFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=6`, key)
    ]);
    const homeForm = formString(hf?.response, homeId);
    const awayForm = formString(af?.response, awayId);
    const hp = formPoints(homeForm), ap = formPoints(awayForm);
    const h2hCount = h2h?.response?.length || 0;
    const diff = Math.abs(hp - ap);
    let boost = diff >= 7 ? 4 : diff >= 4 ? 3 : diff >= 2 ? 2 : 0;
    if (h2hCount >= 3) boost += 1;
    // Bonus suplimentar dacă o echipă e în formă excelentă (5W din 6)
    const homeWins = [...(homeForm||"")].filter(x=>x==="W").length;
    const awayWins = [...(awayForm||"")].filter(x=>x==="W").length;
    if (homeWins >= 5 || awayWins >= 5) boost += 2;
    const v = { boost, homeForm, awayForm, h2hCount, homeWins, awayWins, note: `Formă: ${home} ${homeForm} (${hp}p), ${away} ${awayForm} (${ap}p). H2H: ${h2hCount}. Bonus: +${boost}.` };
    statsCache.set(ck, v); return v;
  } catch (e) {
    const v = { boost: 0, note: "API-Football eroare.", homeForm: "n/a", awayForm: "n/a", h2hCount: 0 };
    statsCache.set(ck, v); return v;
  }
}

// ─── Live candidates ──────────────────────────────────────────────────────────

function liveScoreCandidates(fix) {
  const home = fix.teams?.home?.name || "Gazde";
  const away = fix.teams?.away?.name || "Oaspeți";
  const hg = Number(fix.goals?.home ?? 0);
  const ag = Number(fix.goals?.away ?? 0);
  const minute = Number(fix.fixture?.status?.elapsed || 0);
  const status = fix.fixture?.status?.short || "LIVE";
  const total = hg + ag;
  const picks = [];
  const base = {
    match: `${home} vs ${away}`,
    startTime: roDate(fix.fixture?.date),
    timeStatus: "🔴 LIVE ACUM", timeBoost: 4,
    bookmaker: "API-Football Live",
    footballStats: { boost: 4, homeForm: "live", awayForm: "live", h2hCount: 0, note: `Live min ${minute}' scor ${hg}-${ag}.` },
    live: { minute, score: `${hg}-${ag}`, status }
  };
  if (minute < 10 || minute > 88) return picks;
  // Logica live îmbunătățită
  if (total === 0 && minute >= 20) {
    picks.push({ ...base, pick: "LIVE peste 0.5 goluri", marketKey: "live_over05", marketLabel: "LIVE +0.5 goluri", odd: "n/a", safeScore: 84, reason: `0 goluri după min ${minute} — un gol este aproape sigur.`, verdict: "JOACĂ", rawScore: 84 });
  }
  if (total <= 1 && minute >= 15 && minute <= 70) {
    picks.push({ ...base, pick: "LIVE peste 1.5 goluri", marketKey: "live_over15", marketLabel: "LIVE +1.5 goluri", odd: "n/a", safeScore: 77, reason: `Scor ${hg}-${ag} la min ${minute} — timp suficient.`, verdict: "JOACĂ", rawScore: 77 });
  }
  if (total <= 2 && minute >= 15 && minute <= 60) {
    picks.push({ ...base, pick: "LIVE peste 2.5 goluri", marketKey: "live_over25", marketLabel: "LIVE +2.5 goluri", odd: "n/a", safeScore: 70, reason: `Meci cu potențial de goluri.`, verdict: "CEL MAI BUN GĂSIT", rawScore: 70 });
  }
  if (hg > ag + 1 && minute >= 65) {
    picks.push({ ...base, pick: `${home} câștigă (conduce cu ${hg-ag})`, marketKey: "live_home", marketLabel: "LIVE avantaj gazde", odd: "n/a", safeScore: 85, reason: `Gazde conduc cu ${hg-ag} goluri la min ${minute}.`, verdict: "JOACĂ", rawScore: 85 });
  }
  if (ag > hg + 1 && minute >= 65) {
    picks.push({ ...base, pick: `${away} câștigă (conduce cu ${ag-hg})`, marketKey: "live_away", marketLabel: "LIVE avantaj oaspeți", odd: "n/a", safeScore: 85, reason: `Oaspeți conduc cu ${ag-hg} goluri la min ${minute}.`, verdict: "JOACĂ", rawScore: 85 });
  }
  if (hg === ag && minute >= 75) {
    picks.push({ ...base, pick: "LIVE ambele marchează (BTTS)", marketKey: "live_btts", marketLabel: "LIVE BTTS", odd: "n/a", safeScore: 72, reason: `Egal ${hg}-${ag} la min ${minute} — echipele atacă.`, verdict: "JOACĂ", rawScore: 72 });
  }
  return picks;
}

async function getLiveCandidates(key) {
  if (!key) return { fixtures: [], candidates: [], error: "API_FOOTBALL_KEY lipsește" };
  try {
    const data = await footballFetch("/fixtures?live=all", key);
    const fixtures = Array.isArray(data?.response) ? data.response : [];
    return { fixtures, candidates: fixtures.flatMap(liveScoreCandidates), error: null };
  } catch (e) {
    return { fixtures: [], candidates: [], error: e?.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS pentru accesul din browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache");

  const oddsKey = process.env.ODDS_API_KEY;
  const footballKey = process.env.API_FOOTBALL_KEY;
  const footyStatsKey = process.env.FOOTYSTATS_KEY;

  try {
    // Toate sursele în paralel — dacă una cade, celelalte continuă
    const [oddsResult, livePack] = await Promise.all([
      getAllOddsEvents(oddsKey, footballKey),
      getLiveCandidates(footballKey)
    ]);

    const { events, sourceUsed, oddsApiWorking } = oddsResult;

    let eventsChecked = events.length + livePack.fixtures.length;
    let outcomesChecked = 0;
    let bestSafe = null, bestOverall = null, firstAvailable = null;
    let topOverall = [];
    let marketStats = { h2h: 0, totals: 0, spreads: 0, btts: 0, other: 0, live: 0 };
    let timeStats = { live: livePack.fixtures.length, soon: 0, today: 0, prematch: 0 };

    // Live candidates — prioritate maximă
    for (const lc of livePack.candidates) {
      outcomesChecked++;
      marketStats.live++;
      if (!firstAvailable) firstAvailable = lc;
      if (!bestOverall || lc.rawScore > bestOverall.rawScore) bestOverall = lc;
      addTop(topOverall, { ...lc });
      if (lc.safeScore >= MIN_SAFE_SCORE && (!bestSafe || lc.rawScore > bestSafe.rawScore)) bestSafe = lc;
    }

    // Pre-match — analize în paralel per meci (rapid)
    const eventAnalyses = await Promise.allSettled(
      events.map(async ev => {
        const home = ev.home_team || "Gazde";
        const away = ev.away_team || "Oaspeți";
        const ti = timeInfo(ev.commence_time);
        // Toate analizele externe în paralel
        const [footballStats, flashscoreStats, footyStats, eloStats] = await Promise.all([
          getFootballStats(home, away, footballKey),
          getFlashscoreContext(home, away),
          getFootyStats(home, away, footyStatsKey),
          getClubElo(home, away)
        ]);
        return { ev, home, away, ti, footballStats, flashscoreStats, footyStats, eloStats };
      })
    );

    for (const result of eventAnalyses) {
      if (result.status !== "fulfilled") continue;
      const { ev, home, away, ti, footballStats, flashscoreStats, footyStats, eloStats } = result.value;
      timeStats[ti.key] = (timeStats[ti.key] || 0) + 1;

      for (const bookmaker of (ev.bookmakers || [])) {
        for (const market of (bookmaker.markets || [])) {
          const mk = market.key || "unknown";
          const cat = category(mk);
          marketStats[cat] = (marketStats[cat]||0) + (market.outcomes||[]).length;

          for (const outcome of (market.outcomes || [])) {
            outcomesChecked++;
            const odd = Number(outcome.price);
            if (!odd || odd <= 0) continue;

            const totalBoost =
              Number(footballStats.boost||0) +
              Number(flashscoreStats.boost||0) +
              Number(footyStats.xgBoost||0) +
              Number(eloStats.eloBoost||0) +
              ti.boost;

            const smartBoost =
              rankingBoost(footballStats.homeForm, footballStats.awayForm) +
              homeAdvantageBoost() +
              officialMatchBoost(ev.sportKey || "soccer", ev._source || sourceUsed) +
              lowOddPenalty(odd);

            const score = Math.max(0, Math.min(95, baseScore(odd, mk) + totalBoost + smartBoost));
            const conf = confidenceLabel(score);

            const candidate = {
              match: `${home} vs ${away}`,
              pick: pickLabel(outcome, mk, home, away),
              marketKey: mk,
              marketLabel: marketLabel(mk),
              odd: odd.toFixed(2),
              safeScore: score,
              confidence: conf.label,
              startTime: roDate(ev.commence_time),
              timeStatus: ti.status,
              timeBoost: ti.boost,
              sportKey: ev.sportKey || "soccer",
              bookmaker: bookmaker.title || "Bookmaker",
              dataSource: ev._source || "unknown",
              footballStats,
              flashscoreStats,
              footyStats,
              eloStats,
              reason: `Scor ${score}/100 | Timp +${ti.boost} | Formă +${footballStats.boost||0} | xG +${footyStats.xgBoost||0} | ELO +${eloStats.eloBoost||0} | Flash +${flashscoreStats.boost||0}`,
              verdict: score >= 75 ? "✅ JOACĂ" : score >= 62 ? "⚠️ ACCEPTABIL" : "❌ EVITĂ",
              rawScore: score
            };

            if (!firstAvailable) firstAvailable = candidate;
            if (!bestOverall || candidate.rawScore > bestOverall.rawScore) bestOverall = candidate;
            addTop(topOverall, { ...candidate });

            // bestSafe: scor bun + cotă în zona "safe" (1.12–1.75)
            if (score >= MIN_SAFE_SCORE && odd >= 1.12 && odd <= 1.75) {
              if (!bestSafe || candidate.rawScore > bestSafe.rawScore) bestSafe = candidate;
            }
          }
        }
      }
    }

    const report = {
      eventsChecked,
      outcomesChecked,
      minSafeScore: MIN_SAFE_SCORE,
      scannedAt: roDate(new Date().toISOString()),
      sourceUsed,
      oddsApiWorking,
      liveFixtures: livePack.fixtures.length,
      liveError: livePack.error,
      flashscoreEnabled: Boolean(process.env.FLASHSCORE_API_URL),
      footystatsEnabled: Boolean(footyStatsKey),
      marketStats,
      timeStats,
      bestOverall: clean(bestOverall),
      firstAvailable: clean(firstAvailable),
      topOverall: topOverall.map(clean)
    };

    const tip = bestSafe || bestOverall || firstAvailable;
    const accepted = Boolean(bestSafe);
    if (tip) tip.verdict = accepted ? "✅ JOACĂ" : tip.verdict || "⚠️ ACCEPTABIL";

    return res.status(200).json({
      accepted,
      tip: clean(tip),
      report,
      message: accepted
        ? `Recomandare sigură găsită (scor ${tip?.safeScore}/100).`
        : `Nu există selecție peste prag strict, afișez cea mai bună opțiune (scor ${tip?.safeScore||0}/100).`
    });

  } catch (e) {
    return res.status(500).json({
      error: "Eroare internă.",
      detail: e?.message,
      help: "Verifică variabilele de mediu în Vercel Settings."
    });
  }
};
