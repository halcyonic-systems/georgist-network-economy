# Georgist Land Value Simulation

Enter a scenario, hit Run. Watch the market find its equilibrium.

A Python/Mesa replica of a Georgist land value simulation originally prototyped by Jane Doe as a React/TSX Claude artifact.
**Built as a companion artifact for "On Scientific Freedom" (Halcyonic Systems, 2026).**

🔗 **[Live Demo](https://georgist-network-economy-production.up.railway.app)**

---

## What it models

A 10×10 grid of land parcels. Each round, agents immigrate, bid at auction, and hold leases until they expire. Land value emerges from two sources:

- **Environment** — fixed by column (1–10, left to right). Inherent site quality.
- **Community** — dynamic. Occupied neighbours make your lot more valuable.

**Market value = (env × env_weight) + (community × comm_weight)**

Every round, parcels re-auction from highest to lowest value. The wealthiest eligible agents bid first. Lease price is determined by the 5-outcome auction (see Guide tab).

---

## The TSX → Mesa handoff

Jane prototyped this simulation as a React/TSX Claude artifact — a fully interactive model built through conversation with an AI, no prior coding experience required.
This Mesa version demonstrates what a production-grade Python handoff looks like. Four things Python/Mesa adds that the TSX can't do:

1. **DataCollector time-series** — every metric (Gini coefficient, housing rate, avg wealth by class, land value) tracked across every round. The TSX has no persistent history.
2. **Reproducible seeds** — set a seed, share the number, get the exact same run. Critical for peer review.
3. **CSV export** — one click downloads the full run as a spreadsheet for analysis in R, Stata, or Excel.
4. **Mesa ecosystem** — connects to the standard Python ABM stack: NetworkX, pandas, standard visualisation libraries.

---

## 6 scenarios

| Scenario | Description |
|----------|-------------|
| **Balanced Market** | Moderate settings. Natural market dynamics. |
| **Extreme Inequality** | High wealth ceiling, doubled value multipliers. Intense competition. |
| **Stable Community** | Long leases, low immigration. Slow price changes. |
| **High Churn** | Short-term leases. Constant turnover, fierce competition every few rounds. |
| **Distinct Neighbourhoods** | High env weight creates strips of desirability. |
| **Declining City (Rust Belt)** | Low immigration, strong vacancy decay. Neighbourhoods hollow out. |

---

## Run locally

```bash
git clone https://github.com/halcyonic-systems/georgist-network-economy
cd georgist-network-economy
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python server.py
# Open http://localhost:5000
```

### Smoke test
```bash
python3 -c "from src.model import GeorgistModel; m = GeorgistModel(); [m.step() for _ in range(10)]; print('OK —', m.current_round, 'rounds,', len(m.housed_agents), 'housed')"
```

---

## Tech stack

- **Mesa 3** — Python ABM framework
- **Flask** — REST API
- **Chart.js** — time-series visualisation (no build step)
- **Railway** — deployment

---

## Attribution

- Original TSX prototype: Jane Doe
- Mesa replica: Shingai Thornton / Halcyonic Systems
- "On Scientific Freedom" commentary: Shingai Thornton (Halcyonic Systems, 2026)
