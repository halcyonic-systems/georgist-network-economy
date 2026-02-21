# Georgist Network Economy — Claude Context

## What this is

Python/Mesa replica of Jane's Georgist land value simulation (originally a React/TSX Claude artifact).
Companion artifact for "On Scientific Freedom" commentary piece — demonstrates the TSX → Mesa handoff.

**Narrative**: Jane prototyped this in a Claude artifact. This is what the Python handoff looks like.

## Project structure

```
src/
  agents.py      — Leaseholder + ParcelState dataclasses
  model.py       — GeorgistModel: 7-step pipeline, 5-outcome auction, DataCollector
  constants.py   — SCENARIOS dict (Jane's 6, exact names/params)
server.py        — Flat Flask REST API
templates/
  index.html     — Single-page dashboard (grid + charts + guide + scenarios)
requirements.txt
railway.json     — Deploy on Railway
```

## Running locally

```bash
source venv/bin/activate
python server.py
# Open http://localhost:5000
```

## Smoke test

```bash
source venv/bin/activate
python3 -c "from src.model import GeorgistModel; m = GeorgistModel(); [m.step() for _ in range(10)]; print('OK —', m.current_round, 'rounds,', len(m.housed_agents), 'housed')"
```

## Key mechanics

- **Grid**: 10×10. Environment score = column+1 (fixed). Community score = 2-ring (max 16).
- **Value**: `(env × env_weight) + (community × comm_weight)`
- **Auction**: 5 outcomes (vacant → wealthiest; no challenger → defender keeps; challenger > defender → challenger wins; equal → defender; challenger < defender → defender)
- **Pipeline**: 7 steps per round (community → vacancies → expired → collect → sort → auction → datacollector)

## Mesa advantages over TSX (surface in UI + README)

1. **DataCollector** — time-series across every round (Gini, housing rate, avg wealth, land value)
2. **Seed param** — reproducible runs for peer review
3. **CSV export** — full run download for external analysis
4. **Mesa ecosystem** — connects to standard Python ABM stack

## Scenarios (Jane's 6 exact)

| ID | Title |
|----|-------|
| balanced | Balanced Market |
| inequality | Extreme Inequality |
| stable-community | Stable Community |
| high-churn | High Churn (Short-Term Rentals) |
| distinct-neighbourhoods | Distinct Neighbourhoods |
| declining-city | Declining City (Rust Belt) |

## Deploy

```bash
# Railway (preferred)
railway up
# or workflow_dispatch from GitHub Actions
```

## Python env

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
