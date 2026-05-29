const ODDS_API = "https://api.the-odds-api.com/v4/sports/soccer/odds";

function impliedProb(odd) {
  return 1 / Number(odd);
}

function safeScore(odd, marketKey) {
  const prob = impliedProb(odd);
  let score = Math.round(prob * 100);
  if (marketKey === "h2h") score -= 4;
  if (odd >= 1.12 && odd <= 1.45) score += 8;
  if (odd > 1.65) score -= 20;
  return Math.max(0, Math.min(95, score));
}

function labelPick(outcomeName, marketKey, home, away) {
  if (marketKey === "h2h") {
    if (outcomeName === home) return "1 - câștigă gazdele";
    if (outcomeName === away) return "2 - câștigă oaspeții";
    if (outcomeName === "Draw") return "X - egal";
  }
  return outcomeName;
}

export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: "Lipsește ODDS_API_KEY în Vercel.",
      help: "Intră în Vercel → proiect → Settings → Environment Variables → adaugă ODDS_API_KEY cu cheia ta de la The Odds API, apoi Redeploy."
    });
  }

  const url = `${ODDS_API}?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`;

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({
        error: data?.message || "The Odds API a returnat eroare.",
        help: "Verifică dacă cheia ODDS_API_KEY este corectă și dacă mai ai request-uri disponibile."
      });
    }

    let best = null;

    for (const event of data) {
      const home = event.home_team;
      const away = event.away_team;
      const bookmaker = event.bookmakers?.[0];
      if (!bookmaker) continue;

      const market = bookmaker.markets?.find(m => m.key === "h2h");
      if (!market) continue;

      for (const outcome of market.outcomes || []) {
        const odd = Number(outcome.price);
        if (!odd || odd < 1.12 || odd > 1.65) continue;

        const score = safeScore(odd, market.key);
        if (score < 70) continue;

        const candidate = {
          match: `${home} vs ${away}`,
          pick: labelPick(outcome.name, market.key, home, away),
          odd: odd.toFixed(2),
          safeScore: score,
          startTime: event.commence_time ? new Date(event.commence_time).toLocaleString("ro-RO") : "",
          reason: `Cotă mică/moderată din piața 1X2. Bookmaker: ${bookmaker.title}.`,
          rawScore: score
        };

        if (!best || candidate.rawScore > best.rawScore) best = candidate;
      }
    }

    if (!best) return res.status(200).json({ tip: null });

    delete best.rawScore;
    return res.status(200).json({ tip: best });
  } catch (e) {
    return res.status(500).json({
      error: "Nu am putut citi datele de cote.",
      help: "Încearcă din nou sau verifică deploy-ul pe Vercel."
    });
  }
}
