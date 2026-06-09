# SafeBet Bot v7.4.1

Bot de analiză pariuri sportive cu fallback automat între surse, scoring compus și urmărire live.

## 🚀 Deploy pe Vercel (pași simpli)

1. **Urcă pe GitHub** — repo nou, uploadezi fișierele
2. **Vercel** → New Project → Import repo
3. **Adaugă variabilele de mediu** (Settings → Environment Variables):

| Variabilă | Obligatorie | Unde o obții |
|---|---|---|
| `ODDS_API_KEY` | ✅ DA | [the-odds-api.com](https://the-odds-api.com) — 500 req/lună gratuit |
| `API_FOOTBALL_KEY` | ✅ DA | [api-sports.io](https://api-sports.io) — 100 req/zi gratuit |
| `FOOTYSTATS_KEY` | ⚠️ Opțional | [footystats.org/api](https://footystats.org/api) — xG + BTTS |
| `FLASHSCORE_API_URL` | ⚠️ Opțional | URL propriu (vezi FLASH_SCORE_SETUP.md) |

4. **Redeploy** după adăugarea variabilelor

## 🔄 Cum funcționează fallback-ul

Toate sursele pornesc **în paralel** la fiecare scanare:
```
The Odds API ──┐
API-Football ──┼──► combinate + deduplicate → scoring → recomandare
OpenLigaDB  ──┘
```
Dacă Odds API epuizează creditele → continuă din API-Football + OpenLigaDB, **fără întrerupere**.

## 📊 Scoring (max 95/100)

| Factor | Bonus max |
|---|---|
| Probabilitate implicită cotă | baza |
| Zona cotă 1.15–1.35 | +10 |
| Formă echipe (API-Football) | +6 |
| Formă Flashscore | +5 |
| Expected Goals xG (FootyStats) | +3 |
| Club ELO difference | +3 |
| Timp (live/curând/azi) | +4 |

## ⚡ Live Auto

Refresh automat la 22 secunde — meciurile live sunt prioritizate în scoring.
