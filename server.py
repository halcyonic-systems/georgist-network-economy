"""
Flask server for Georgist Land Value Simulation

Flat file (RSC ABM pattern) — no blueprints.

Endpoints:
  GET  /                       Dashboard
  POST /api/init               Initialize with params
  POST /api/step               Advance N steps
  GET  /api/state              Full grid + agents + stats
  GET  /api/history            DataCollector time-series
  POST /api/scenario           Load preset by name
  GET  /api/scenarios          List all presets
  POST /api/reset              Reset to defaults
  GET  /api/export/csv         Full time-series CSV (Mesa advantage)
  GET  /api/parcel/<id>        Single parcel + history
  GET  /api/runs               List all saved prior runs
  GET  /api/runs/<run_id>      Retrieve a specific saved run
"""

import os
import io
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, render_template

from src import GeorgistModel, SCENARIOS, DEFAULT_PARAMS

app = Flask(__name__)

RESULTS_DIR = Path("results")
MAX_SAVED_RUNS = 20

# Global model instance (stateful — one simulation per server)
_model: GeorgistModel = None
_current_scenario_id: str = None  # track which scenario is loaded


def get_model() -> GeorgistModel:
    global _model
    if _model is None:
        _model = GeorgistModel()
    return _model


def _save_run_if_worthwhile():
    """Auto-save current run to disk before reset, if it has history."""
    global _model, _current_scenario_id
    if _model is None:
        return
    history = _model.get_history()
    rounds = history.get("round", [])
    if not rounds:
        return  # Nothing ran — don't save

    RESULTS_DIR.mkdir(exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    scenario_id = _current_scenario_id or "custom"
    filename = f"{ts}_{scenario_id}.json"

    scenario_title = (
        SCENARIOS[scenario_id]["title"] if scenario_id in SCENARIOS else "Custom"
    )
    final_stats = _model.get_state()["stats"]

    payload = {
        "id": filename,
        "scenario_id": scenario_id,
        "scenario_title": scenario_title,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "rounds": _model.current_round,
        "params": _model.get_state()["params"],
        "final_stats": final_stats,
        "history": history,
    }

    with open(RESULTS_DIR / filename, "w") as f:
        json.dump(payload, f)

    # Prune oldest runs beyond MAX_SAVED_RUNS
    runs = sorted(RESULTS_DIR.glob("*.json"))
    for old in runs[:-MAX_SAVED_RUNS]:
        old.unlink()


def reset_model(**kwargs) -> GeorgistModel:
    global _model
    _save_run_if_worthwhile()
    _model = GeorgistModel(**kwargs)
    return _model


# =============================================================================
# Pages
# =============================================================================

@app.route("/")
def index():
    return render_template("index.html")


# =============================================================================
# API
# =============================================================================

VALID_PARAMS = {
    "immigration_rate", "min_lease_length", "max_lease_length",
    "max_wealth", "vacancy_decay", "environment_weight", "community_weight", "seed",
}


@app.route("/api/init", methods=["POST"])
def api_init():
    """Initialize model with params. Resets any prior run."""
    global _current_scenario_id
    data = request.get_json() or {}
    params = {k: v for k, v in data.items() if k in VALID_PARAMS and v is not None}
    m = reset_model(**params)       # saves current run first (uses existing scenario id)
    _current_scenario_id = None     # then clear for the new run
    return jsonify({"status": "initialized", "state": m.get_state()})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Reset to default params (or pass custom params)."""
    global _current_scenario_id
    data = request.get_json() or {}
    params = {k: v for k, v in data.items() if k in VALID_PARAMS and v is not None}
    m = reset_model(**params)       # saves current run first (uses existing scenario id)
    _current_scenario_id = None     # then clear for the new run
    return jsonify({"status": "reset", "state": m.get_state()})


@app.route("/api/step", methods=["POST"])
def api_step():
    """Advance N steps (default 1)."""
    data = request.get_json() or {}
    steps = max(1, int(data.get("steps", 1)))
    m = get_model()
    for _ in range(steps):
        m.step()
    return jsonify(m.get_state())


@app.route("/api/state")
def api_state():
    """Full grid + agents + stats."""
    return jsonify(get_model().get_state())


@app.route("/api/history")
def api_history():
    """DataCollector time-series (Mesa advantage over TSX)."""
    return jsonify(get_model().get_history())


@app.route("/api/scenario", methods=["POST"])
def api_scenario():
    """Load a preset scenario by id."""
    global _current_scenario_id
    data = request.get_json() or {}
    scenario_id = data.get("id", "balanced")

    if scenario_id not in SCENARIOS:
        return jsonify({"error": f"Unknown scenario: {scenario_id}", "available": list(SCENARIOS)}), 400

    _current_scenario_id = scenario_id
    s = SCENARIOS[scenario_id]
    m = reset_model(**s["params"])
    return jsonify({
        "scenario": s["id"],
        "title": s["title"],
        "description": s["description"],
        "state": m.get_state(),
    })


@app.route("/api/scenarios")
def api_scenarios():
    """List all scenario presets."""
    return jsonify([
        {"id": s["id"], "title": s["title"], "description": s["description"], "params": s["params"]}
        for s in SCENARIOS.values()
    ])


@app.route("/api/export/csv")
def api_export_csv():
    """Full time-series CSV export (key Mesa advantage — TSX can't do this)."""
    history = get_model().get_history()
    if not history.get("round"):
        return jsonify({"error": "No data yet — run some steps first"}), 400

    output = io.StringIO()
    columns = list(history.keys())
    writer = csv.writer(output)
    writer.writerow(columns)

    n_rows = len(history[columns[0]])
    for i in range(n_rows):
        writer.writerow([
            round(history[col][i], 4) if isinstance(history[col][i], float) else history[col][i]
            for col in columns
        ])

    output.seek(0)
    return output.getvalue(), 200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=georgist_timeseries.csv",
    }


@app.route("/api/parcel/<int:parcel_id>")
def api_parcel(parcel_id: int):
    """Single parcel details + event history."""
    if not (0 <= parcel_id < 100):
        return jsonify({"error": "Parcel ID must be 0–99"}), 400
    m = get_model()
    parcel = m.parcels[parcel_id]
    row, col = m._index_to_coords(parcel_id)
    return jsonify({
        "id": parcel_id,
        "row": row,
        "col": col,
        "environment_score": parcel.environment_score,
        "community_score": round(parcel.community_score, 2),
        "market_value": round(m._weighted_value(parcel_id), 2),
        "lease_price": parcel.lease_price,
        "rounds_vacant": parcel.rounds_vacant,
        "occupant": {
            "id": parcel.occupant.id,
            "wealth": parcel.occupant.wealth,
            "lease_expires": parcel.occupant.lease_expires,
        } if parcel.occupant else None,
        "history": parcel.history[-50:],  # last 50 events
    })


@app.route("/api/runs")
def api_runs():
    """List all saved prior runs, newest first."""
    RESULTS_DIR.mkdir(exist_ok=True)
    runs = []
    for f in sorted(RESULTS_DIR.glob("*.json"), reverse=True):
        try:
            with open(f) as fh:
                data = json.load(fh)
            runs.append({
                "id": data["id"],
                "scenario_id": data["scenario_id"],
                "scenario_title": data["scenario_title"],
                "timestamp": data["timestamp"],
                "rounds": data["rounds"],
                "final_gini": data["final_stats"].get("gini_coefficient"),
                "final_housing_rate": data["final_stats"].get("housing_rate"),
                "final_population": data["final_stats"].get("population"),
            })
        except Exception:
            continue
    return jsonify(runs)


@app.route("/api/runs/<run_id>")
def api_run_detail(run_id: str):
    """Retrieve full history for a saved run."""
    # Sanitize — only allow filename characters
    safe_id = Path(run_id).name
    path = RESULTS_DIR / safe_id
    if not path.exists():
        return jsonify({"error": "Run not found"}), 404
    with open(path) as f:
        return jsonify(json.load(f))


@app.route("/api/defaults")
def api_defaults():
    return jsonify(DEFAULT_PARAMS)


# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    get_model()
    print("=" * 58)
    print("  Georgist Land Value Simulation")
    print("  Python/Mesa replica of Jane's TSX prototype")
    print("=" * 58)
    print()
    print("  Dashboard: http://localhost:5000")
    print()
    print("  Key endpoints:")
    print("    POST /api/scenario   Load a preset")
    print("    POST /api/step       Advance N steps")
    print("    GET  /api/history    Time-series (Mesa advantage)")
    print("    GET  /api/export/csv Full CSV export")
    print()

    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)
