export default async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Lipsește ODDS_API_KEY în Vercel → Environment Variables.' });
  const sport = req.query.sport || 'soccer_epl';
  const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds/?apiKey=${key}&regions=eu&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text || 'Eroare de la Odds API' });
    const events = JSON.parse(text);
    res.status(200).json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Eroare server' });
  }
}
