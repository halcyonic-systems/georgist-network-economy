"""
Scenario Comparison — Gini Coefficient with Uncertainty Bands

Runs all 6 of Jane's scenarios N times each with different seeds.
Plots mean Gini ± 95% confidence interval over time.

What this reveals that the TSX never can:
- Which scenarios are highly path-dependent (wide bands)
- Which are structurally robust regardless of random variation (tight bands)
- When outcomes diverge — which round is the "point of no return"

Usage:
    python scripts/compare_scenarios.py
    python scripts/compare_scenarios.py --runs 50 --steps 60 --out output/scenarios.png
"""

import sys
import argparse
import time
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.model import GeorgistModel
from src.constants import SCENARIOS


# Colour palette — one per scenario, order matches SCENARIOS dict
PALETTE = {
    "balanced":               "#1a56db",
    "inequality":             "#dc2626",
    "stable-community":       "#059669",
    "high-churn":             "#d97706",
    "distinct-neighbourhoods": "#7c3aed",
    "declining-city":         "#64748b",
}


def run_scenario(scenario_id: str, runs: int, steps: int) -> np.ndarray:
    """
    Run one scenario N times.
    Returns array of shape (runs, steps) — Gini per step per run.
    """
    params = SCENARIOS[scenario_id]["params"]
    matrix = np.zeros((runs, steps))

    for r in range(runs):
        m = GeorgistModel(**params, seed=r * 31337)
        for s in range(steps):
            m.step()
        h = m.get_history()
        gini_series = h["gini_coefficient"]
        # Pad / truncate to exactly `steps` values
        n = min(len(gini_series), steps)
        matrix[r, :n] = gini_series[:n]
        if n < steps:
            matrix[r, n:] = gini_series[-1] if gini_series else 0.0

    return matrix


def plot(
    results: dict[str, np.ndarray],
    steps: int,
    runs: int,
    out_path: str,
    metric: str = "gini",
    metric_label: str = "Gini coefficient",
):
    fig, ax = plt.subplots(figsize=(12, 6))

    rounds = list(range(1, steps + 1))
    handles = []

    for scenario_id, matrix in results.items():
        title = SCENARIOS[scenario_id]["title"]
        color = PALETTE[scenario_id]

        mean = matrix.mean(axis=0)
        std  = matrix.std(axis=0)
        # 95% CI via t-distribution approximation (good enough for ABM)
        ci   = 1.96 * std / np.sqrt(runs)

        ax.plot(rounds, mean, color=color, linewidth=2, label=title)
        ax.fill_between(rounds, mean - ci, mean + ci, color=color, alpha=0.15)

        handles.append(mpatches.Patch(color=color, label=title))

    ax.set_xlabel("Round", fontsize=12)
    ax.set_ylabel(metric_label, fontsize=12)
    ax.set_title(
        f"Georgist Land Value Simulation — Scenario Comparison\n"
        f"{metric_label} — mean ± 95% CI across {runs} runs per scenario",
        fontsize=13, fontweight="bold",
    )
    ax.set_xlim(1, steps)
    ax.set_ylim(bottom=0)
    ax.legend(handles=handles, loc="upper left", fontsize=10, framealpha=0.9)
    ax.grid(axis="y", alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.text(
        0.5, -0.02,
        f"Generated with Python/Mesa — {runs} runs × {steps} steps × 6 scenarios = "
        f"{runs * steps * 6:,} simulation steps  |  "
        "github.com/halcyonic-systems/georgist-network-economy",
        ha="center", fontsize=9, color="#888",
    )

    plt.tight_layout()
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    print(f"  Saved → {out_path}")
    plt.show()


def main():
    parser = argparse.ArgumentParser(description="Compare all 6 scenarios with uncertainty bands")
    parser.add_argument("--runs",  type=int, default=50,  help="Runs per scenario")
    parser.add_argument("--steps", type=int, default=50,  help="Steps per run")
    parser.add_argument("--out",   type=str, default="output/scenario_comparison.png")
    parser.add_argument("--quick", action="store_true",   help="Fast preview (10 runs)")
    args = parser.parse_args()

    runs  = 10 if args.quick else args.runs
    steps = args.steps

    total_sims = runs * len(SCENARIOS)
    print(f"Scenario comparison")
    print(f"  Scenarios: {list(SCENARIOS.keys())}")
    print(f"  {runs} runs × {steps} steps × {len(SCENARIOS)} scenarios = {total_sims} simulations")
    print()

    results = {}
    t0 = time.time()

    for i, scenario_id in enumerate(SCENARIOS):
        title = SCENARIOS[scenario_id]["title"]
        print(f"  [{i+1}/{len(SCENARIOS)}] {title} ...", end="", flush=True)
        matrix = run_scenario(scenario_id, runs, steps)
        results[scenario_id] = matrix
        final_mean = matrix[:, -1].mean()
        final_std  = matrix[:, -1].std()
        print(f" Gini R{steps}: {final_mean:.3f} ± {final_std:.3f}")

    elapsed = time.time() - t0
    print(f"\n  Done in {elapsed:.1f}s")
    print()

    # Gini plot
    plot(results, steps, runs, args.out,
         metric="gini", metric_label="Gini coefficient")

    # Also save housing rate plot
    housing_out = args.out.replace(".png", "_housing.png")
    # Re-collect housing rate
    housing_results = {}
    for scenario_id in SCENARIOS:
        params = SCENARIOS[scenario_id]["params"]
        matrix = np.zeros((runs, steps))
        for r in range(runs):
            m = GeorgistModel(**params, seed=r * 31337)
            for s in range(steps):
                m.step()
            h = m.get_history()
            series = h["housing_rate"]
            n = min(len(series), steps)
            matrix[r, :n] = series[:n]
            if n < steps:
                matrix[r, n:] = series[-1] if series else 0.0
        housing_results[scenario_id] = matrix

    plot(housing_results, steps, runs, housing_out,
         metric="housing_rate", metric_label="Housing rate (fraction occupied)")


if __name__ == "__main__":
    main()
