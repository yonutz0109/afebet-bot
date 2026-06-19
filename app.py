"""
ADAM Web — Flask backend.
Accesibil de pe orice telefon/PC printr-un link web, odată deployat.
"""
import os
import json
import csv
import io
from pathlib import Path
from flask import Flask, render_template, request, jsonify, session, Response

import adam_engine as eng

APP_DIR = Path(__file__).resolve().parent
DB_FILE = APP_DIR / "adam_history.db"

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "adam-dev-secret-change-in-prod")

# Cache simplu în memorie pentru ultimele rezultate (per sesiune simplificat: global)
LAST_RESULTS = {"rows": [], "meta": {}, "sport": "football", "date": ""}


def get_keys():
    """Cheile API vin din variabile de mediu (setate pe server), nu de la utilizator."""
    return {
        "api_sports": os.environ.get("API_SPORTS_KEY", ""),
        "odds": os.environ.get("ODDS_API_KEY", ""),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/update", methods=["POST"])
def api_update():
    data = request.get_json(force=True)
    sport = data.get("sport", "football")
    date_str = data.get("date", "")
    show_all = data.get("show_all", True)

    keys = get_keys()
    try:
        rows, meta = eng.fetch_dashboard(
            str(DB_FILE), keys["api_sports"], keys["odds"],
            sport, date_str, show_all
        )
        LAST_RESULTS["rows"] = rows
        LAST_RESULTS["meta"] = meta
        LAST_RESULTS["sport"] = sport
        LAST_RESULTS["date"] = date_str
        return jsonify({"ok": True, "rows": rows, "meta": meta})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/backfill", methods=["POST"])
def api_backfill():
    from datetime import datetime, timedelta
    data = request.get_json(force=True)
    sport = data.get("sport", "football")
    date_str = data.get("date", "")
    keys = get_keys()

    try:
        base_date = datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        base_date = datetime.now()

    dates = [base_date.strftime("%Y-%m-%d"), (base_date - timedelta(days=1)).strftime("%Y-%m-%d")]
    ok_count = err_count = 0
    last_error = ""

    for d in dates:
        try:
            eng.fetch_dashboard(str(DB_FILE), keys["api_sports"], keys["odds"], sport, d, True)
            ok_count += 1
        except Exception as e:
            err_count += 1
            last_error = str(e)

    return jsonify({"ok": ok_count > 0, "ok_count": ok_count, "err_count": err_count, "last_error": last_error})


@app.route("/api/stats")
def api_stats():
    sport = request.args.get("sport", "football")
    eng.init_db(str(DB_FILE))
    wins, total, rate = eng.winrate_stats(str(DB_FILE), sport)
    return jsonify({"wins": wins, "total": total, "rate": rate})


@app.route("/api/export.csv")
def export_csv():
    rows = LAST_RESULTS.get("rows", [])
    if not rows:
        return Response("Nu există date. Rulează UPDATE întâi.", status=400)
    output = io.StringIO()
    cols = list(rows[0].keys())
    writer = csv.DictWriter(output, fieldnames=cols, delimiter=";")
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=adam_export.csv"}
    )


@app.route("/api/test", methods=["POST"])
def api_test():
    data = request.get_json(force=True)
    sport = data.get("sport", "football")
    date_str = data.get("date", "")
    keys = get_keys()
    try:
        if sport == "tennis":
            if not keys["odds"]:
                raise RuntimeError("Lipsește The Odds API key pentru tenis (setează pe server).")
            rows, meta = eng.fetch_tennis(str(DB_FILE), keys["odds"], date_str, True)
        else:
            if not keys["api_sports"]:
                raise RuntimeError("Lipsește API-SPORTS key (setează pe server).")
            rows, meta = eng.fetch_api_sports(str(DB_FILE), keys["api_sports"], sport, date_str, True)
        return jsonify({"ok": True, "total": meta.get("total"), "shown": len(rows), "odds": meta.get("odds")})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


if __name__ == "__main__":
    eng.init_db(str(DB_FILE))
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
