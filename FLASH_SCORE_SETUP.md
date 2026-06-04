# Flashscore în SafeBet Bot

Am adăugat Flashscore ca sursă opțională de context, nu ca dependență obligatorie.

## Cum funcționează

Botul merge normal cu:
- `ODDS_API_KEY`
- `API_FOOTBALL_KEY`

Dacă adaugi și:
- `FLASHSCORE_API_URL`

atunci `api/scan.js` trimite pentru fiecare meci:

```text
?home=NumeGazde&away=NumeOaspeti
```

Endpointul trebuie să răspundă JSON. Poate întoarce `events`, `matches`, `response`, `data` sau un array direct.

## Câmpuri utile acceptate

Exemple de câmpuri pe care modulul le poate folosi:

```json
{
  "homeTeam": { "name": "Arsenal" },
  "awayTeam": { "name": "Chelsea" },
  "homeForm": "WWDLW",
  "awayForm": "LDWDL",
  "h2h": [],
  "injuries": [],
  "lineups": true,
  "minute": 62
}
```

## Important

Nu am pus scraping direct agresiv în aplicație. Flashscore are protecții și își poate schimba structura des. Cel mai curat este să folosim un proxy/endpoint JSON stabil sau o sursă licențiată.

Dacă `FLASHSCORE_API_URL` lipsește sau nu răspunde, botul continuă fără să pice.
