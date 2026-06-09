import { getAllOddsEvents } from "./odds-providers.js";

export default async function handler(req, res) {
  try {
    const data = await getAllOddsEvents(
      process.env.ODDS_API_KEY,
      process.env.API_FOOTBALL_KEY
    );

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({
      error: "Nu am putut citi odds.",
      detail: e?.message || String(e)
    });
  }
}
