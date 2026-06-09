export async function getFlashscoreContext(home, away) {
  const base = process.env.FLASHSCORE_API_URL;

  if (!base) {
    return {
      boost: 0,
      note: "Flashscore dezactivat"
    };
  }

  try {
    const url = `${base.replace(/\/$/, "")}/context?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`;

    const r = await fetch(url, { cache: "no-store" });

    if (!r.ok) {
      return {
        boost: 0,
        note: "Flashscore indisponibil"
      };
    }

    const data = await r.json().catch(() => null);

    return {
      boost: Math.max(-5, Math.min(5, Number(data?.boost || 0))),
      note: data?.note || "Flashscore context citit"
    };
  } catch (e) {
    return {
      boost: 0,
      note: "Flashscore eroare"
    };
  }
}
