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
"""

import os
import io
import csv

from flask import Flask, jsonify, request, render_template

from src import GeorgistModel, SCENARIOS, DEFAULT_PARAMS

app = Flask(__name__)

# Global model instance (stateful — one simulation per server)
_model: GeorgistModel = None


def get_model() -> GeorgistModel:
    global _model
    if _model is None:
        _model = GeorgistModel()
    return _model


def reset_model(**kwargs) -> GeorgistModel:
    global _model
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
    data = request.get_json() or {}
    params = {k: v for k, v in data.items() if k in VALID_PARAMS and v is not None}
    m = reset_model(**params)
    return jsonify({"status": "initialized", "state": m.get_state()})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Reset to default params (or pass custom params)."""
    data = request.get_json() or {}
    params = {k: v for k, v in data.items() if k in VALID_PARAMS and v is not None}
    m = reset_model(**params)
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
    data = request.get_json() or {}
    scenario_id = data.get("id", "balanced")

    if scenario_id not in SCENARIOS:
        return jsonify({"error": f"Unknown scenario: {scenario_id}", "available": list(SCENARIOS)}), 400

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
