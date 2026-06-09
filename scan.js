/**
 * scan.js — SafeBet Bot v7.3 Stable
 * ES Module pentru Vercel.
 * Surse: odds-providers.js + API-Football live + Flashscore opțional.
 */

import { getAllOddsEvents, getFootyStats, getClubElo } from "./odds-providers.js";
import { getFlashscoreContext } from "./flashscore.js";

const FOOTBALL_API = "https://v3.football.api-sports.io";
const MIN_SAFE_SCORE = 75;

function marketLabel(k) {
  return ({
    h2h: "1X2",
    totals: "Goluri over/under",
    spreads: "Handicap",
    btts: "Ambele marchează",
    live_home: "LIVE 1",
    live_away: "LIVE 2",
    live_draw: "LIVE X",
    live_over15: "LIVE peste 1.5",
    live_over25: "LIVE peste 2.5",
    live_next_goal: "LIVE gol următor"
  }[k] || k || "necunoscută");
}

function category(k) {
  if (k === "h2h") return "h2h";
  if ((k || "").includes("total")) return "totals";
  if ((k || "").includes("spread")) return "spreads";
  if (k === "btts") return "btts";
  if ((k || "").startsWith("live_")) return "live";
  return "other";
}

function baseScore(odd, market) {
  let s = Math.round((1 / Number(odd)) * 100);
  if (market === "h2h") s -= 4;
  if ((market || "").includes("total")) s -= 1;
  if ((market || "").includes("spread")) s -= 3;
  if (market === "btts") s -= 2;
  if ((market || "").startsWith("live_")) s -= 2;
  if (odd >= 1.12 && odd <= 1.45) s += 8;
  if (odd > 1.65) s -= 20;
  if (odd > 1.90) s -= 30;
  return Math.max(0, Math.min(95, s));
}

function pickLabel(outcome, market, home, away) {
  const n = outcome?.name || "";
  const p = outcome?.point != null ? ` ${outcome.point}` : "";

  if (market === "h2h") {
    if (n === home) return "1 - câștigă gazdele";
    if (n === away) return "2 - câștigă oaspeții";
    if (n === "Draw") return "X - egal";
  }

  if ((market || "").includes("total")) return `${n}${p} goluri`;
  if ((market || "").includes("spread")) return `${n} handicap${p}`;
  if (market === "btts") return n === "Yes" ? "Da - ambele marchează" : "Nu - cel puțin una nu marchează";
  return `${n}${p}`.trim() || "Selecție necunoscută";
}

function roDate(iso) {
  return iso ? new Date(iso).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "";
}

function addTop(list, candidate, maxSize = 10) {
  list.push(candidate);
  list.sort((a, b) => (b.safeScore || 0) - (a.safeScore || 0));
  if (list.length > maxSize) list.pop();
}

function clean(c) {
  if (!c) return c;
  const x = { ...c };
  delete x.rawScore;
  return x;
}

function timeInfo(iso) {
  const start = iso ? new Date(iso).getTime() : 0;
  const now = Date.now();
  const diffMin = (start - now) / 60000;

  if (start && diffMin <= 0 && diffMin > -180) return { status: "LIVE ACUM", boost: 3, key: "live" };
  if (start && diffMin > 0 && diffMin <= 120) return { status: "ÎNCEPE CURÂND", boost: 2, key: "soon" };
  return { status: "PRE-MATCH", boost: 0, key: "prematch" };
}

async function footballFetch(path, key) {
  if (!key) return null;
  try {
    const r = await fetch(`${FOOTBALL_API}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store"
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

const teamCache = new Map();
const statsCache = new Map();

async function findTeamId(name, key) {
  if (!key) return null;
  if (teamCache.has(name)) return teamCache.get(name);

  const data = await footballFetch(`/teams?search=${encodeURIComponent(name)}`, key);
  const id = data?.response?.[0]?.team?.id || null;
  teamCache.set(name, id);
  return id;
}

function formString(fixtures, teamId) {
  const out = [];

  for (const f of fixtures || []) {
    const h = f.teams?.home?.id === teamId;
    const a = f.teams?.away?.id === teamId;
    if (!h && !a) continue;

    const hg = f.goals?.home;
    const ag = f.goals?.away;
    if (hg == null || ag == null) continue;

    const gf = h ? hg : ag;
    const ga = h ? ag : hg;
    out.push(gf > ga ? "W" : gf === ga ? "D" : "L");

    if (out.length >= 5) break;
  }

  return out.join("") || "n/a";
}

function formPoints(form) {
  return [...(form || "")].reduce((s, x) => s + (x === "W" ? 3 : x === "D" ? 1 : 0), 0);
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
  if (!key) {
    return {
      boost: 0,
      note: "API_FOOTBALL_KEY lipsește.",
      homeForm: "n/a",
      awayForm: "n/a",
      h2hCount: 0
    };
  }

  const cacheKey = `${home}|${away}`;
  if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);

  try {
    const homeId = await findTeamId(home, key);
    const awayId = await findTeamId(away, key);

    if (!homeId || !awayId) {
      const v = {
        boost: 0,
        note: "Echipele nu au fost găsite în API-FOOTBALL.",
        homeForm: "n/a",
        awayForm: "n/a",
        h2hCount: 0
      };
      statsCache.set(cacheKey, v);
      return v;
    }

    const [hf, af, h2h] = await Promise.all([
      footballFetch(`/fixtures?team=${homeId}&last=5`, key),
      footballFetch(`/fixtures?team=${awayId}&last=5`, key),
      footballFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`, key)
    ]);

    const homeForm = formString(hf?.response, homeId);
    const awayForm = formString(af?.response, awayId);
    const hp = formPoints(homeForm);
    const ap = formPoints(awayForm);
    const h2hCount = h2h?.response?.length || 0;

    let boost = 0;
    const diff = Math.abs(hp - ap);
    if (diff >= 6) boost += 3;
    else if (diff >= 3) boost += 2;
    if (h2hCount >= 3) boost += 1;

    const v = {
      boost,
      homeForm,
      awayForm,
      h2hCount,
      note: `Formă: ${home} ${homeForm} (${hp}p), ${away} ${awayForm} (${ap}p). H2H: ${h2hCount}. Bonus: +${boost}.`
    };

    statsCache.set(cacheKey, v);
    return v;
  } catch {
    const v = {
      boost: 0,
      note: "API-FOOTBALL eroare.",
      homeForm: "n/a",
      awayForm: "n/a",
      h2hCount: 0
    };
    statsCache.set(cacheKey, v);
    return v;
  }
}

function liveScoreCandidate(fix) {
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
    timeStatus: "LIVE ACUM",
    timeBoost: 3,
    bookmaker: "API-FOOTBALL LIVE",
    footballStats: {
      boost: 3,
      homeForm: "live",
      awayForm: "live",
      h2hCount: 0,
      note: `Live ${minute}' scor ${hg}-${ag}.`
    },
    live: { minute, score: `${hg}-${ag}`, status }
  };

  if (minute >= 15 && minute <= 75) {
    if (total <= 1) {
      picks.push({
        ...base,
        pick: "LIVE peste 1.5 goluri",
        marketKey: "live_over15",
        marketLabel: "LIVE peste 1.5",
        odd: "n/a",
        safeScore: 78,
        reason: "Meci live, scor cu potențial. Verifică manual cota înainte.",
        verdict: "OBSERVĂ",
        rawScore: 78
      });
    }

    if (total <= 2 && minute <= 65) {
      picks.push({
        ...base,
        pick: "LIVE peste 2.5 goluri",
        marketKey: "live_over25",
        marketLabel: "LIVE peste 2.5",
        odd: "n/a",
        safeScore: 73,
        reason: "Timp suficient pentru goluri, dar sub prag.",
        verdict: "CEL MAI BUN GĂSIT",
        rawScore: 73
      });
    }

    if (hg > ag && minute >= 60) {
      picks.push({
        ...base,
        pick: `${home} să nu piardă live`,
        marketKey: "live_home",
        marketLabel: "LIVE avantaj gazde",
        odd: "n/a",
        safeScore: 80,
        reason: "Gazdele conduc după min 60. Verifică manual cota înainte.",
        verdict: "OBSERVĂ",
        rawScore: 80
      });
    }

    if (ag > hg && minute >= 60) {
      picks.push({
        ...base,
        pick: `${away} să nu piardă live`,
        marketKey: "live_away",
        marketLabel: "LIVE avantaj oaspeți",
        odd: "n/a",
        safeScore: 80,
        reason: "Oaspeții conduc după min 60. Verifică manual cota înainte.",
        verdict: "OBSERVĂ",
        rawScore: 80
      });
    }
  }

  return picks;
}

async function getLiveFootballCandidates(key) {
  if (!key) return { fixtures: [], candidates: [], error: "API_FOOTBALL_KEY lipsește" };

  const data = await footballFetch(`/fixtures?live=all`, key);
  const fixtures = Array.isArray(data?.response) ? data.response : [];

  return {
    fixtures,
    candidates: fixtures.flatMap(liveScoreCandidate),
    error: null
  };
}

export default async function handler(req, res) {
  const oddsKey = process.env.ODDS_API_KEY;
  const footballKey = process.env.API_FOOTBALL_KEY;
  const footyStatsKey = process.env.FOOTYSTATS_KEY;

  try {
    const [{ events, sourceUsed, oddsApiWorking }, livePack] = await Promise.all([
      getAllOddsEvents(oddsKey, footballKey),
      getLiveFootballCandidates(footballKey)
    ]);

    let eventsChecked = events.length;
    let outcomesChecked = 0;
    let bestSafe = null;
    let bestOverall = null;
    let firstAvailable = null;
    const topOverall = [];
    const marketStats = { h2h: 0, totals: 0, spreads: 0, btts: 0, other: 0, live: 0 };
    const timeStats = { live: livePack.fixtures.length, soon: 0, prematch: 0 };

    for (const lc of livePack.candidates) {
      outcomesChecked++;
      marketStats.live++;

      if (!firstAvailable) firstAvailable = lc;
      if (!bestOverall || lc.rawScore > bestOverall.rawScore) bestOverall = lc;
      addTop(topOverall, { ...lc });

      if (lc.safeScore >= MIN_SAFE_SCORE && (!bestSafe || lc.rawScore > bestSafe.rawScore)) {
        bestSafe = lc;
      }
    }

    const eventAnalyses = await Promise.allSettled(
      events.map(async ev => {
        const home = ev.home_team || "Gazde";
        const away = ev.away_team || "Oaspeți";
        const ti = timeInfo(ev.commence_time);

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

      for (const bookmaker of ev.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const mk = market.key || "unknown";
          const cat = category(mk);
          marketStats[cat] = (marketStats[cat] || 0) + (market.outcomes || []).length;

          for (const outcome of market.outcomes || []) {
            outcomesChecked++;

            const odd = Number(outcome.price);
            if (!odd || odd <= 0) continue;

            const totalBoost =
              Number(footballStats.boost || 0) +
              Number(flashscoreStats.boost || 0) +
              Number(footyStats.xgBoost || 0) +
              Number(eloStats.eloBoost || 0) +
              ti.boost;

            const smartBoost =
              rankingBoost(footballStats.homeForm, footballStats.awayForm) +
              homeAdvantageBoost() +
              officialMatchBoost(ev.sportKey || "soccer", ev._source || sourceUsed) +
              lowOddPenalty(odd);

            const score = Math.max(0, Math.min(95, baseScore(odd, mk) + totalBoost + smartBoost));

            const candidate = {
              match: `${home} vs ${away}`,
              pick: pickLabel(outcome, mk, home, away),
              marketKey: mk,
              marketLabel: marketLabel(mk),
              odd: odd.toFixed(2),
              safeScore: score,
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
              reason: score >= MIN_SAFE_SCORE
                ? `SafeBet ✅ Scor ${score}/100. Bonus: timp +${ti.boost}, formă +${footballStats.boost || 0}, xG +${footyStats.xgBoost || 0}, ELO +${eloStats.eloBoost || 0}, flash +${flashscoreStats.boost || 0}, smart +${smartBoost}.`
                : `Sub prag: ${score}/100 < ${MIN_SAFE_SCORE}. Bonus total: +${totalBoost}, smart +${smartBoost}.`,
              verdict: score >= MIN_SAFE_SCORE ? "JOACĂ" : "CEL MAI BUN GĂSIT",
              rawScore: score
            };

            if (!firstAvailable) firstAvailable = candidate;
            if (!bestOverall || candidate.rawScore > bestOverall.rawScore) bestOverall = candidate;
            addTop(topOverall, { ...candidate });

            if (score >= MIN_SAFE_SCORE && odd >= 1.12 && odd <= 1.65) {
              if (!bestSafe || candidate.rawScore > bestSafe.rawScore) {
                bestSafe = candidate;
              }
            }
          }
        }
      }
    }

    const report = {
      eventsChecked: eventsChecked + livePack.fixtures.length,
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

    if (bestSafe) {
      bestSafe.verdict = "JOACĂ";
      return res.status(200).json({
        accepted: true,
        tip: clean(bestSafe),
        report,
        message: "Recomandare peste pragul minim."
      });
    }

    return res.status(200).json({
      accepted: false,
      tip: clean(bestOverall || firstAvailable),
      report,
      message: "Nu recomand pariu acum, dar afișez cea mai bună selecție găsită."
    });
  } catch (e) {
    return res.status(500).json({
      error: "Eroare internă server.",
      detail: e?.message || String(e),
      help: "Verifică logurile Vercel."
    });
  }
}
