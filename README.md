# SafeBet Bot v7.0

Bot de pariuri cu fallback automat între mai multe surse de cote, scoring compus și urmărire live.

## 🚀 Deploy pe Vercel

1. Fork/upload repo pe GitHub
2. Conectează în Vercel → New Project
3. Adaugă variabilele de mediu (vezi mai jos)
4. Deploy

## 🔑 Environment Variables (Vercel → Settings → Environment Variables)

| Variabilă | Obligatorie | Descriere |
|---|---|---|
| `ODDS_API_KEY` | ✅ Recomandat | [the-odds-api.com](https://the-odds-api.com) — Plan gratuit: 500 req/lună |
| `API_FOOTBALL_KEY` | ✅ Recomandat | [api-sports.io](https://api-sports.io) — Plan gratuit: 100 req/zi |
| `FOOTYSTATS_KEY` | ⚠️ Opțional | [footystats.org](https://footystats.org/api) — xG + BTTS stats |
| `FLASHSCORE_API_URL` | ⚠️ Opțional | URL custom Flashscore (vezi FLASH_SCORE_SETUP.md) |

## 🔄 Fallback automat cote

Sistemul încearcă în paralel:
1. **The Odds API** — cote reale de la bookmakers europeni
2. **API-Football Odds** — cote alternative (dacă Odds API e epuizat)
3. **OpenLigaDB** — date structurale Bundesliga (fără cheie, fără cote reale)

Dacă toate eșuează → raportează eroare clară în UI.

## 📊 Scoring compus (max 95/100)

| Sursă | Bonus max |
|---|---|
| Probabilitate implicită cotă | baza |
| API-Football (formă, H2H) | +4 |
| Flashscore (formă, lineup) | +5 |
| FootyStats xG | +3 |
| Club ELO difference | +3 |
| Timp până la meci (live/soon) | +3 |

## ⚡ Live Auto

Butonul **📡 Live Auto** activează refresh la fiecare 20 secunde — ideal pentru meciuri live.

## 📋 Istoric

Istoricul pariurilor este salvat în **IndexedDB** (nu se pierde la curățare cache simplu).
Export JSON disponibil din UI.
