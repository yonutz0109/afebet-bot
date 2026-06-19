"""
ADAM Engine — motorul de calcul pentru predicții sportive.
Extras și îmbunătățit din versiunea desktop (Tkinter) -> web (Flask).

Motor v3: probabilitate din cote ca bază + ajustare formă + statistici ligă.
"""
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime

SPORTS_API = {
    "football": {
        "name": "Fotbal",
        "host": "https://v3.football.api-sports.io",
        "fixtures": "/fixtures",
        "odds": "/odds",
        "bad": ["U19", "U20", "U21", "Women", "Reserve", "Youth", "Liga III"],
        "top": ["Champions", "Europa", "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"],
        "med": ["MLS", "Sudamericana", "Super Lig", "Eredivisie", "Primeira", "Liga I"],
    },
    "handball": {
        "name": "Handbal",
        "host": "https://v1.handball.api-sports.io",
        "fixtures": "/games",
        "odds": "/odds",
        "bad": ["U19", "U20", "U21", "Women", "Reserve", "Youth"],
        "top": ["Champions", "European", "Bundesliga", "Denmark", "France", "Spain", "Sweden"],
        "med": ["Norway", "Romania", "Poland", "Hungary", "Portugal"],
    },
    "basketball": {
        "name": "Baschet",
        "host": "https://v1.basketball.api-sports.io",
        "fixtures": "/games",
        "odds": "/odds",
        "bad": ["U19", "U20", "U21", "Women", "Reserve", "Youth"],
        "top": ["NBA", "Euroleague", "EuroCup", "ACB", "Lega A", "LNB", "BBL", "Liga ACB"],
        "med": ["NCAA", "NBL", "VTB", "Adriatic", "Champions League"],
    },
}

GENERIC_ALLOWED = ["Premier", "League", "Liga", "Division", "Cup", "Championship", "Serie", "Bundesliga", "NBA", "ATP", "WTA"]

# ─────────────────────────────────────────────────────────────────────────
# DATE STATISTICE LIGI — sezon 2024-25 (over25%, GG%, avg goluri, home_win%)
# ─────────────────────────────────────────────────────────────────────────
LEAGUE_STATS = {
    "UEFA Champions League":  {"o25": 62, "gg": 58, "avg": 3.02, "hw": 44, "tier": "TOP"},
    "UEFA Europa League":     {"o25": 59, "gg": 55, "avg": 2.88, "hw": 43, "tier": "TOP"},
    "Premier League":         {"o25": 64, "gg": 60, "avg": 3.10, "hw": 45, "tier": "TOP"},
    "La Liga":                {"o25": 59, "gg": 55, "avg": 2.87, "hw": 47, "tier": "TOP"},
    "Serie A":                {"o25": 57, "gg": 53, "avg": 2.78, "hw": 45, "tier": "TOP"},
    "Bundesliga":             {"o25": 67, "gg": 60, "avg": 3.22, "hw": 44, "tier": "TOP"},
    "Ligue 1":                {"o25": 59, "gg": 54, "avg": 2.85, "hw": 46, "tier": "TOP"},
    "Eredivisie":             {"o25": 66, "gg": 61, "avg": 3.18, "hw": 46, "tier": "MED"},
    "Primeira Liga":          {"o25": 56, "gg": 51, "avg": 2.72, "hw": 48, "tier": "MED"},
    "Liga I":                 {"o25": 50, "gg": 47, "avg": 2.55, "hw": 46, "tier": "MED"},
    "Super Lig":              {"o25": 57, "gg": 53, "avg": 2.80, "hw": 47, "tier": "MED"},
    "MLS":                    {"o25": 60, "gg": 55, "avg": 2.90, "hw": 43, "tier": "MED"},
    "Copa De La Liga":        {"o25": 52, "gg": 48, "avg": 2.62, "hw": 46, "tier": "MED"},
    "Scottish Premiership":   {"o25": 62, "gg": 57, "avg": 2.98, "hw": 44, "tier": "MED"},
    "Pro League":             {"o25": 60, "gg": 55, "avg": 2.88, "hw": 45, "tier": "MED"},
    "Brasileirao":            {"o25": 52, "gg": 48, "avg": 2.60, "hw": 48, "tier": "MED"},
    "Sudamericana":           {"o25": 50, "gg": 46, "avg": 2.52, "hw": 47, "tier": "MED"},
    "Libertadores":           {"o25": 51, "gg": 47, "avg": 2.55, "hw": 47, "tier": "MED"},
    "Ekstraklasa":            {"o25": 51, "gg": 47, "avg": 2.58, "hw": 46, "tier": "MED"},
}


def league_stats(league):
    if league in LEAGUE_STATS:
        return LEAGUE_STATS[league]
    ll = league.lower()
    for k, v in LEAGUE_STATS.items():
        if k.lower() in ll or ll in k.lower():
            return v
    return None


def league_tier(sport, league):
    if sport == "tennis":
        title = league.lower()
        if "atp" in title or "wta" in title or "grand slam" in title or "open" in title:
            return "TOP"
        return "MED"
    meta = SPORTS_API[sport]
    if any(w.lower() in league.lower() for w in meta["top"]):
        return "TOP"
    if any(w.lower() in league.lower() for w in meta["med"]):
        return "MED"
    return "LOW"


def is_bad_league(sport, league):
    if sport == "tennis":
        return False
    return any(w.lower() in league.lower() for w in SPORTS_API[sport]["bad"])


def is_allowed_league(sport, league, show_all):
    if show_all:
        return True
    if sport == "tennis":
        return True
    return any(w.lower() in league.lower() for w in GENERIC_ALLOWED + SPORTS_API[sport]["top"] + SPORTS_API[sport]["med"])


def risk_by_tier(t):
    return "LOW-MED" if t == "TOP" else ("MED" if t == "MED" else "MED-HIGH")


def live_flag(sport, status, elapsed, gh, ga):
    gh = gh or 0
    ga = ga or 0
    s = str(status).upper()
    if sport == "football":
        if any(x in s for x in ["1H", "2H", "HT", "LIVE"]):
            if elapsed >= 70 and gh == 0 and ga == 0:
                return "EVITA LIVE"
            if elapsed >= 55 and gh < ga:
                return "COMEBACK ALERT"
            return "LIVE OK"
    elif sport == "handball":
        if "LIVE" in s or "H" in s:
            if elapsed >= 45 and (gh + ga) < 38:
                return "RITM MIC"
            return "LIVE OK"
    elif sport == "basketball":
        if "LIVE" in s or "Q" in s or "HT" in s:
            if elapsed >= 30 and (gh + ga) < 110:
                return "PACE MIC"
            return "LIVE OK"
    elif sport == "tennis":
        if "LIVE" in s or "INPLAY" in s:
            return "LIVE OK"
    return "-"


def suspicious_odds(c1, cx, c2, sport):
    try:
        h = float(c1)
        a = float(c2)
        if sport == "football":
            d = float(cx)
            return "DA" if h > 7 or d > 8 or a > 7 else "-"
        return "DA" if h > 6 or a > 6 else "-"
    except Exception:
        return "-"


def final_risk(ai, susp, live):
    if live in ["EVITA LIVE", "RITM MIC", "PACE MIC"] or susp == "DA":
        return "HIGH"
    if ai >= 72:
        return "LOW-MED"
    if ai >= 60:
        return "MED"
    return "HIGH"


# ─────────────────────────────────────────────────────────────────────────
# MOTOR PRINCIPAL — probabilitate din cote
# ─────────────────────────────────────────────────────────────────────────
def calc_ai_and_bet(sport, league, hname, aname, c1, cx, c2, hf, af, live, susp, learn_adj=0):
    has_odds = c1 not in ["-", "", None] and c2 not in ["-", "", None]
    lstats = league_stats(league)
    tier = league_tier(sport, league)

    if not has_odds:
        if lstats is None or tier == "LOW":
            return 45, "EVITA", "EVITA", "AVOID", "-", "Ligă mică fără cote"
        if lstats["o25"] >= 62:
            base_nc, sel_nc = 65, "Peste 2.5 goluri (fără cote)"
        elif lstats["o25"] >= 52:
            base_nc, sel_nc = 60, "Peste 1.5 goluri (fără cote)"
        else:
            base_nc, sel_nc = 55, "EVITA (deficit date)"
        ai_nc = max(40, min(75, base_nc + learn_adj))
        motiv_nc = f"Fara cote | {league} O25:{lstats['o25']}% avg:{lstats['avg']}"
        return ai_nc, sel_nc, sel_nc, "NO ODDS", "-", motiv_nc

    try:
        o1 = float(c1)
        o2 = float(c2)
        ox = float(cx) if cx not in ["-", "", None] else None
    except Exception:
        return 50, "EVITA", "EVITA", "AVOID", "-", "Cote invalide"

    rp1 = 1.0 / o1
    rp2 = 1.0 / o2
    rpx = (1.0 / ox) if ox else 0.0
    tot = rp1 + rp2 + rpx
    p_home = rp1 / tot
    p_away = rp2 / tot
    p_draw = rpx / tot if ox else 0.0

    fav_is_home = (p_home >= p_away)
    fav_name = hname if fav_is_home else aname
    fav_prob = p_home if fav_is_home else p_away
    fav_odd = o1 if fav_is_home else o2

    form_known = not (hf == 50 and af == 50)
    if form_known:
        diff = (hf - af) / 100.0 if fav_is_home else (af - hf) / 100.0
        boost = diff * 0.08
        fav_prob_adj = min(0.93, max(0.28, fav_prob + boost))
    else:
        fav_prob_adj = fav_prob

    ai = int(30 + fav_prob_adj * 60)
    ai = max(40, min(95, ai + learn_adj))

    if susp == "DA":
        ai = max(40, ai - 8)
    if live in ["EVITA LIVE", "RITM MIC", "PACE MIC"]:
        ai = max(40, ai - 15)
    elif live == "COMEBACK ALERT":
        ai = max(40, ai - 6)

    o25_prob = (lstats["o25"] / 100.0) if lstats else 0.50
    gg_prob = (lstats["gg"] / 100.0) if lstats else 0.48

    if live in ["EVITA LIVE", "RITM MIC", "PACE MIC"]:
        sel = pariu = "EVITA LIVE"
    elif sport == "football":
        if fav_prob_adj >= 0.72:
            sel = pariu = f"{fav_name} câștigă"
        elif fav_prob_adj >= 0.60 and o25_prob >= 0.57:
            sel = pariu = "Peste 2.5 goluri"
        elif fav_prob_adj >= 0.55 and gg_prob >= 0.53:
            sel = pariu = "GG (ambele marchează)"
        elif fav_prob_adj >= 0.50:
            sel = pariu = "Peste 1.5 goluri"
        elif p_draw >= 0.28 and fav_prob_adj >= 0.43:
            sel = pariu = "1X" if fav_is_home else "X2"
        else:
            sel = pariu = "EVITA (meci incert)"
    elif sport == "handball":
        if live == "RITM MIC":
            sel = pariu = "EVITA / Under posibil"
        elif fav_prob_adj >= 0.68:
            sel = pariu = f"{fav_name} câștigă / Over total"
        elif fav_prob_adj >= 0.55:
            sel = pariu = "Over total / Favorit nu pierde"
        else:
            sel = pariu = "Over echipă / Handicap +"
    elif sport == "basketball":
        if live == "PACE MIC":
            sel = pariu = "EVITA / Under posibil"
        elif fav_prob_adj >= 0.68:
            sel = pariu = f"{fav_name} handicap / Over total"
        elif fav_prob_adj >= 0.55:
            sel = pariu = "Winner + Over prudent"
        else:
            sel = pariu = "Over total / Handicap +"
    elif sport == "tennis":
        if fav_prob_adj >= 0.70:
            sel = pariu = f"{fav_name} câștigă"
        elif fav_prob_adj >= 0.55:
            sel = pariu = f"{fav_name} câștigă set / Over games"
        else:
            sel = pariu = "Over games / Set 1 favorit"
    else:
        sel = pariu = "EVITA"

    edge = round((fav_prob_adj - fav_prob) / fav_prob * 100, 1)
    ev = round(fav_odd * fav_prob_adj, 2)

    if "EVITA" in pariu:
        verdict = "AVOID"
    elif edge >= 5 and fav_prob_adj >= 0.55:
        verdict = "VALUE"
    elif fav_prob_adj >= 0.48:
        verdict = "OK"
    else:
        verdict = "AVOID"

    vs_str = f"EV:{ev} edge:{edge:+.1f}% p:{fav_prob_adj:.0%}"
    form_str = f"H{hf}/A{af}" if form_known else "formă necunosc."
    lstats_str = f"O25:{lstats['o25']}% GG:{lstats['gg']}%" if lstats else "statistici indisponibile"
    motiv = f"p:{fav_prob:.0%}→{fav_prob_adj:.0%} | {form_str} | {lstats_str}"

    return ai, sel, pariu, verdict, vs_str, motiv


def predicted_correct_score(sport, ai, hf, af, c1, c2, live):
    if live in ["EVITA LIVE", "RITM MIC", "PACE MIC"]:
        return "EVITA"
    home_edge = int(hf or 50) - int(af or 50)
    try:
        o1 = float(c1)
        o2 = float(c2)
        if o1 < o2:
            home_edge += 6
        elif o2 < o1:
            home_edge -= 6
    except Exception:
        pass
    if sport == "football":
        if ai >= 75:
            if home_edge >= 6:
                return "2-0 / 2-1"
            if home_edge <= -6:
                return "0-2 / 1-2"
            return "1-1 / 2-1"
        if home_edge >= 5:
            return "1-0 / 2-1"
        if home_edge <= -5:
            return "0-1 / 1-2"
        return "1-1"
    if sport == "handball":
        if home_edge >= 6:
            return "31-27 / 32-28"
        if home_edge <= -6:
            return "27-31 / 28-32"
        return "29-29 / 30-29"
    if sport == "basketball":
        if home_edge >= 6:
            return "88-80 / 92-84"
        if home_edge <= -6:
            return "80-88 / 84-92"
        return "84-82 / 86-86"
    if sport == "tennis":
        if home_edge >= 5:
            return "2-0 / 2-1"
        if home_edge <= -5:
            return "0-2 / 1-2"
        return "2-1 / 1-2"
    return "-"


def make_row(sport, date_str, date_raw, fid, league, hname, aname, hid, aid,
             status, elapsed, gh, ga, c1, cx, c2, hf, af, hnote, anote, learn_adj=0, learn_note=""):
    lf = live_flag(sport, status, int(elapsed or 0), gh, ga)
    susp = suspicious_odds(c1, cx, c2, sport)

    ai, sel, pariu, verdict, vs_str, motiv = calc_ai_and_bet(
        sport, league, hname, aname, c1, cx, c2, hf, af, lf, susp, learn_adj
    )
    risk = final_risk(ai, susp, lf)

    try:
        dt = datetime.fromisoformat(str(date_raw).replace("Z", "+00:00"))
        ora = dt.strftime("%d.%m %H:%M")
    except Exception:
        ora = str(date_raw)[:16].replace("T", " ")

    if lf not in ["-", "LIVE OK"]:
        motiv += f" | {lf}"

    return {
        "Data": date_str,
        "Sport": {"football": "Fotbal", "handball": "Handbal", "basketball": "Baschet", "tennis": "Tenis"}[sport],
        "Ora": ora, "Meci": f"{hname} vs {aname}", "Liga": league,
        "Status": "NEINCEPUT" if str(status).upper() in ["NS", "UPCOMING"] else f"{status} {elapsed}' {gh}-{ga}",
        "ADAM": ai, "AIConfidence": ai, "SelectieFinala": sel,
        "PariuExact": pariu,
        "ScorCorect": predicted_correct_score(sport, ai, hf, af, c1, c2, lf),
        "RiscFinal": risk, "Verdict": verdict,
        "Cota1": c1, "CotaX": cx, "Cota2": c2, "ValueScore": vs_str,
        "FormHome": hf, "FormAway": af, "LiveFlag": lf, "Motiv": motiv, "FixtureID": fid,
        "HomeID": hid, "AwayID": aid, "HomeName": hname, "AwayName": aname, "GH": gh, "GA": ga,
        "CoteSuspecte": susp, "NoteAI": f"H {hnote} / A {anote} / {learn_note}"
    }


# ─────────────────────────────────────────────────────────────────────────
# DATA ACCESS — DB + API-SPORTS + The Odds API
# ─────────────────────────────────────────────────────────────────────────
def init_db(db_file):
    con = sqlite3.connect(db_file)
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS matches(
            fixture_id TEXT, sport TEXT, date TEXT, league TEXT,
            home_id TEXT, away_id TEXT, home_name TEXT, away_name TEXT,
            status TEXT, gh INTEGER, ga INTEGER,
            c1 TEXT, cx TEXT, c2 TEXT,
            ai INTEGER, selection TEXT, risk TEXT, verdict TEXT,
            PRIMARY KEY(fixture_id, sport)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_team_home ON matches(sport, home_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_team_away ON matches(sport, away_id)")
    con.commit()
    con.close()


def save_rows(db_file, rows, sport):
    con = sqlite3.connect(db_file)
    cur = con.cursor()
    for r in rows:
        cur.execute("""
            INSERT INTO matches(fixture_id, sport, date, league, home_id, away_id,
                home_name, away_name, status, gh, ga, c1, cx, c2, ai, selection, risk, verdict)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(fixture_id, sport) DO UPDATE SET
                status=excluded.status, gh=excluded.gh, ga=excluded.ga,
                c1=excluded.c1, cx=excluded.cx, c2=excluded.c2,
                ai=excluded.ai, selection=excluded.selection,
                risk=excluded.risk, verdict=excluded.verdict
        """, (
            r["FixtureID"], sport, r["Data"], r["Liga"], r["HomeID"], r["AwayID"],
            r["HomeName"], r["AwayName"], r["Status"], r["GH"], r["GA"],
            r["Cota1"], r["CotaX"], r["Cota2"], r["AIConfidence"],
            r["SelectieFinala"], r["RiscFinal"], r["Verdict"]
        ))
    con.commit()
    con.close()


def winrate_stats(db_file, sport):
    con = sqlite3.connect(db_file)
    cur = con.cursor()
    cur.execute("""
        SELECT selection, gh, ga FROM matches
        WHERE sport=? AND gh IS NOT NULL AND ga IS NOT NULL
        ORDER BY date DESC LIMIT 500
    """, (sport,))
    rows = cur.fetchall()
    con.close()
    total = wins = 0
    for selection, gh, ga in rows:
        pick = str(selection or "")
        hit = None
        if sport == "football":
            if "Peste 1.5" in pick:
                hit = (int(gh) + int(ga)) >= 2
            elif "Peste 2.5" in pick:
                hit = (int(gh) + int(ga)) >= 3
        elif sport == "handball":
            if "Over" in pick:
                hit = (int(gh) + int(ga)) >= 55
        elif sport == "basketball":
            if "Over" in pick:
                hit = (int(gh) + int(ga)) >= 158
        if hit is not None:
            total += 1
            if hit:
                wins += 1
    rate = round((wins / total) * 100, 1) if total else 0
    return wins, total, rate


def learning_adjustment(db_file, sport):
    wins, total, rate = winrate_stats(db_file, sport)
    if total < 10:
        return 0, "learning: date insuficiente"
    if rate >= 62:
        return 2, f"learning +2 | WR {rate}%"
    if rate < 48:
        return -3, f"learning -3 | WR {rate}%"
    return 0, f"learning neutru | WR {rate}%"


def db_form(db_file, sport, team_id):
    if not team_id:
        return 50, "DB empty"
    con = sqlite3.connect(db_file)
    cur = con.cursor()
    cur.execute("""
        SELECT home_id,away_id,gh,ga FROM matches
        WHERE sport=? AND (home_id=? OR away_id=?)
        AND gh IS NOT NULL AND ga IS NOT NULL
        ORDER BY date DESC LIMIT 5
    """, (sport, str(team_id), str(team_id)))
    rows = cur.fetchall()
    con.close()
    if not rows:
        return 50, "DB no history"
    wins = over = gf_total = ga_total = cnt = 0
    line = {"football": 3, "handball": 55, "basketball": 160, "tennis": 22}.get(sport, 3)
    for hid, aid, gh, ga in rows:
        if gh is None or ga is None:
            continue
        if str(hid) == str(team_id):
            gf, gc = int(gh), int(ga)
        else:
            gf, gc = int(ga), int(gh)
        cnt += 1
        gf_total += gf
        ga_total += gc
        if gf > gc:
            wins += 1
        if gf + gc >= line:
            over += 1
    if cnt == 0:
        return 50, "DB no finished"
    score = 50 + wins * 7 + over * 3 + int(((gf_total / cnt) - (ga_total / cnt)) * (6 if sport == "football" else 1))
    return max(40, min(95, score)), f"DB {cnt}m W{wins} O{over}"


def safe_get(obj, path, default=None):
    cur = obj
    for p in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(p, default)
    return cur


def score_num(x):
    if x is None:
        return None
    if isinstance(x, dict):
        for k in ["total", "points", "score", "current"]:
            if k in x and x[k] is not None:
                return score_num(x[k])
        return None
    try:
        return int(x)
    except Exception:
        return None


def api_sports_get(url, key):
    req = urllib.request.Request(url)
    req.add_header("x-apisports-key", key)
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    errors = data.get("errors")
    if errors:
        raise RuntimeError("API-SPORTS eroare: " + json.dumps(errors, ensure_ascii=False))
    return data


def normal_get(url):
    with urllib.request.urlopen(url, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, dict) and data.get("message"):
        raise RuntimeError("The Odds API eroare: " + str(data.get("message")))
    return data


def api_form(api_key, sport, team_id):
    if not team_id or sport == "tennis":
        return 50, "API no form"
    try:
        meta = SPORTS_API[sport]
        url = f"{meta['host']}{meta['fixtures']}?team={team_id}&last=5"
        payload = api_sports_get(url, api_key)
        rows = payload.get("response", [])
        if not rows:
            return 50, "API no history"
        wins = over = gf_total = ga_total = cnt = 0
        line = {"football": 3, "handball": 55, "basketball": 160}.get(sport, 3)
        for fx in rows:
            teams = fx.get("teams", {})
            if sport == "football":
                gh = score_num(safe_get(fx, ["goals", "home"]))
                ga = score_num(safe_get(fx, ["goals", "away"]))
            else:
                gh = score_num(safe_get(fx, ["scores", "home"]))
                ga = score_num(safe_get(fx, ["scores", "away"]))
            if gh is None or ga is None:
                continue
            hid = safe_get(teams, ["home", "id"])
            aid = safe_get(teams, ["away", "id"])
            if str(hid) == str(team_id):
                gf, gc = gh, ga
            elif str(aid) == str(team_id):
                gf, gc = ga, gh
            else:
                continue
            cnt += 1
            gf_total += gf
            ga_total += gc
            if gf > gc:
                wins += 1
            if gf + gc >= line:
                over += 1
        if cnt == 0:
            return 50, "API no finished"
        score = 50 + wins * 7 + over * 3 + int(((gf_total / cnt) - (ga_total / cnt)) * (6 if sport == "football" else 1))
        return max(40, min(95, score)), f"API {cnt}m W{wins} O{over}"
    except Exception:
        return 50, "API error"


def team_form(db_file, api_key, sport, team_id):
    s, n = db_form(db_file, sport, team_id)
    if s != 50:
        return s, n
    return api_form(api_key, sport, team_id)


def api_sports_odds_map(api_key, sport, date_str, progress=None):
    meta = SPORTS_API[sport]
    all_items = []
    for p in range(1, 9):
        if progress:
            progress(f"{sport}: cote pagina {p}/8")
        try:
            payload = api_sports_get(f"{meta['host']}{meta['odds']}?date={date_str}&page={p}", api_key)
            all_items.extend(payload.get("response", []))
        except Exception:
            pass
    odds = {}
    for item in all_items:
        fid = str(safe_get(item, ["fixture", "id"], safe_get(item, ["game", "id"], "")))
        h = d = a = "-"
        for bm in item.get("bookmakers", []):
            for bet in bm.get("bets", []):
                if bet.get("name") in ["Match Winner", "Winner", "Home/Away", "Home Away"]:
                    for v in bet.get("values", []):
                        name = str(v.get("value", ""))
                        odd = str(v.get("odd", "-"))
                        if name in ["Home", "1"]:
                            h = odd
                        elif name in ["Draw", "X"]:
                            d = odd
                        elif name in ["Away", "2"]:
                            a = odd
                    break
        if fid:
            odds[fid] = (h, d, a)
    return odds


def fetch_api_sports(db_file, api_key, sport, date_str, show_all, progress=None):
    meta = SPORTS_API[sport]
    url = f"{meta['host']}{meta['fixtures']}?date={date_str}&timezone=Europe/Bucharest"
    payload = api_sports_get(url, api_key)
    items = payload.get("response", [])
    odds = api_sports_odds_map(api_key, sport, date_str, progress)
    learn_adj, learn_note = learning_adjustment(db_file, sport)

    rows = []
    form_cache = {}
    skipped_bad = skipped_filter = 0

    for fx in items:
        league = safe_get(fx, ["league", "name"], "")
        if is_bad_league(sport, league):
            skipped_bad += 1
            continue
        if not is_allowed_league(sport, league, show_all):
            skipped_filter += 1
            continue

        if sport == "football":
            fid = str(safe_get(fx, ["fixture", "id"], ""))
            date_raw = safe_get(fx, ["fixture", "date"], "")
            status = safe_get(fx, ["fixture", "status", "short"], "NS")
            elapsed = safe_get(fx, ["fixture", "status", "elapsed"], 0) or 0
            gh = score_num(safe_get(fx, ["goals", "home"]))
            ga = score_num(safe_get(fx, ["goals", "away"]))
        else:
            fid = str(safe_get(fx, ["game", "id"], safe_get(fx, ["id"], "")))
            date_raw = safe_get(fx, ["game", "date"], safe_get(fx, ["date"], ""))
            status = safe_get(fx, ["status", "short"], safe_get(fx, ["status", "long"], "NS"))
            elapsed = safe_get(fx, ["status", "elapsed"], 0) or 0
            gh = score_num(safe_get(fx, ["scores", "home"]))
            ga = score_num(safe_get(fx, ["scores", "away"]))

        home = safe_get(fx, ["teams", "home"], {})
        away = safe_get(fx, ["teams", "away"], {})
        hname = home.get("name", "")
        aname = away.get("name", "")
        hid = home.get("id", hname)
        aid = away.get("id", aname)
        if not hname or not aname:
            continue

        c1, cx, c2 = odds.get(fid, ("-", "-", "-"))

        for tid, name in [(hid, hname), (aid, aname)]:
            if tid not in form_cache:
                if progress:
                    progress(f"{sport}: formă {name}")
                form_cache[tid] = team_form(db_file, api_key, sport, tid)

        hf, hnote = form_cache.get(hid, (50, "no"))
        af, anote = form_cache.get(aid, (50, "no"))
        rows.append(make_row(sport, date_str, date_raw, fid, league, hname, aname, hid, aid,
                              status, elapsed, gh, ga, c1, cx, c2, hf, af, hnote, anote,
                              learn_adj, learn_note))

    return rows, {"total": len(items), "bad": skipped_bad, "filtered": skipped_filter, "odds": len(odds)}


def fetch_tennis(db_file, odds_key, date_str, show_all, progress=None):
    if not odds_key:
        raise RuntimeError("Pentru tenis trebuie completată cheia The Odds API.")
    url = "https://api.the-odds-api.com/v4/sports/upcoming/odds?" + urllib.parse.urlencode({
        "apiKey": odds_key, "regions": "eu", "markets": "h2h", "oddsFormat": "decimal",
    })
    if progress:
        progress("tennis: The Odds API upcoming")
    payload = normal_get(url)
    learn_adj, learn_note = learning_adjustment(db_file, "tennis")
    rows = []
    total = 0
    for item in payload:
        sport_key = str(item.get("sport_key", ""))
        sport_title = str(item.get("sport_title", ""))
        if "tennis" not in sport_key.lower() and "tennis" not in sport_title.lower():
            continue
        total += 1
        hname = item.get("home_team") or ""
        aname = item.get("away_team") or ""
        if not hname or not aname:
            teams = item.get("teams", [])
            if len(teams) >= 2:
                hname, aname = teams[0], teams[1]
        c1 = c2 = "-"
        for bm in item.get("bookmakers", []):
            for m in bm.get("markets", []):
                if m.get("key") == "h2h":
                    for out in m.get("outcomes", []):
                        if out.get("name") == hname:
                            c1 = str(out.get("price", "-"))
                        elif out.get("name") == aname:
                            c2 = str(out.get("price", "-"))
                    break
            if c1 != "-" and c2 != "-":
                break
        fid = str(item.get("id", hname + aname))
        date_raw = item.get("commence_time", "")
        hf, hnote = db_form(db_file, "tennis", hname)
        af, anote = db_form(db_file, "tennis", aname)
        rows.append(make_row("tennis", date_str, date_raw, fid, sport_title, hname, aname, hname, aname,
                              "UPCOMING", 0, None, None, c1, "-", c2, hf, af, hnote, anote,
                              learn_adj, learn_note))
    return rows, {"total": total, "bad": 0, "filtered": 0, "odds": total}


def fetch_dashboard(db_file, api_sports_key, odds_key, sport, date_str, show_all, progress=None):
    init_db(db_file)
    if sport == "tennis":
        rows, meta = fetch_tennis(db_file, odds_key, date_str, show_all, progress)
    else:
        if not api_sports_key:
            raise RuntimeError("Pentru acest sport trebuie cheia API-SPORTS.")
        rows, meta = fetch_api_sports(db_file, api_sports_key, sport, date_str, show_all, progress)
    rows.sort(key=lambda r: r["AIConfidence"], reverse=True)
    save_rows(db_file, rows, sport)
    meta["shown"] = len(rows)
    return rows, meta
