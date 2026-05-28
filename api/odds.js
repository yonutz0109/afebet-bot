export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: "ODDS_API_KEY lipseste din Environment Variables in Vercel." });
  const sport = req.query.sport || "soccer_epl";
  const regions = req.query.regions || "eu,uk";
  const markets = req.query.markets || "h2h,totals";
  const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/?apiKey=${key}&regions=${regions}&markets=${markets}&oddsFormat=decimal`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.message || "Eroare The Odds API", details: data });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: "Nu pot lua cotele acum.", details: String(e) });
  }
}
