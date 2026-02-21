"""
Phase Diagram — Immigration Rate × Max Wealth → Gini Coefficient

Sweeps two parameters across their meaningful ranges, runs each combination
N times, plots mean Gini at round 50 as a 2D heatmap.

The TSX shows you one point in this space.
This shows the whole landscape — including the phase transition where the
market flips from competitive equilibrium to chronic housing crisis.

Usage:
    python scripts/phase_diagram.py
    python scripts/phase_diagram.py --steps 50 --runs 5 --out output/phase.png
"""

import sys
import argparse
import time
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

# Allow import from project root
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.model import GeorgistModel


def run_single(immigration_rate: int, max_wealth: int, steps: int, seed: int) -> dict:
    """Run one simulation, return metrics at final step."""
    m = GeorgistModel(
        immigration_rate=immigration_rate,
        max_wealth=max_wealth,
        seed=seed,
    )
    for _ in range(steps):
        m.step()
    h = m.get_history()
    return {
        "gini": h["gini_coefficient"][-1] if h["gini_coefficient"] else 0.0,
        "housing_rate": h["housing_rate"][-1] if h["housing_rate"] else 0.0,
    }


def sweep(
    imm_values: list,
    wealth_values: list,
    steps: int,
    runs_per_combo: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Sweep immigration_rate × max_wealth.
    Returns (gini_grid, housing_grid) shaped (len(imm), len(wealth)).
    """
    n_imm = len(imm_values)
    n_wealth = len(wealth_values)
    gini_grid = np.zeros((n_imm, n_wealth))
    housing_grid = np.zeros((n_imm, n_wealth))

    total = n_imm * n_wealth * runs_per_combo
    done = 0
    t0 = time.time()

    for i, imm in enumerate(imm_values):
        for j, wealth in enumerate(wealth_values):
            gini_samples = []
            housing_samples = []
            for run in range(runs_per_combo):
                seed = i * 10000 + j * 100 + run
                result = run_single(imm, wealth, steps, seed)
                gini_samples.append(result["gini"])
                housing_samples.append(result["housing_rate"])
                done += 1

            gini_grid[i, j] = np.mean(gini_samples)
            housing_grid[i, j] = np.mean(housing_samples)

            elapsed = time.time() - t0
            remaining = (elapsed / done) * (total - done) if done else 0
            print(
                f"\r  {done}/{total} runs  [{elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining]",
                end="", flush=True,
            )

    print()
    return gini_grid, housing_grid


def plot(
    gini_grid: np.ndarray,
    housing_grid: np.ndarray,
    imm_values: list,
    wealth_values: list,
    steps: int,
    runs_per_combo: int,
    out_path: str,
):
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle(
        f"Georgist Land Value Simulation — Parameter Space\n"
        f"Mean over {runs_per_combo} runs × {steps} rounds each  |  "
        f"{len(imm_values) * len(wealth_values) * runs_per_combo} total simulations",
        fontsize=13, fontweight="bold", y=1.01,
    )

    # --- Gini heatmap ---
    ax = axes[0]
    im = ax.imshow(
        gini_grid,
        origin="lower",
        aspect="auto",
        cmap="RdYlGn_r",
        vmin=0, vmax=0.6,
        extent=[
            wealth_values[0] - 0.5, wealth_values[-1] + 0.5,
            imm_values[0] - 0.5,   imm_values[-1] + 0.5,
        ],
    )
    plt.colorbar(im, ax=ax, label="Gini coefficient")
    ax.set_xlabel("Max wealth ceiling", fontsize=11)
    ax.set_ylabel("Immigration rate (agents/round)", fontsize=11)
    ax.set_title("Wealth Inequality (Gini)", fontsize=12, fontweight="bold")
    ax.set_xticks(wealth_values[::2])
    ax.set_yticks(imm_values[::2])

    # Annotate cells
    for i in range(len(imm_values)):
        for j in range(len(wealth_values)):
            ax.text(
                wealth_values[j], imm_values[i],
                f"{gini_grid[i, j]:.2f}",
                ha="center", va="center", fontsize=7,
                color="white" if gini_grid[i, j] > 0.35 else "black",
            )

    # --- Housing rate heatmap ---
    ax = axes[1]
    im2 = ax.imshow(
        housing_grid,
        origin="lower",
        aspect="auto",
        cmap="RdYlGn",
        vmin=0, vmax=1,
        extent=[
            wealth_values[0] - 0.5, wealth_values[-1] + 0.5,
            imm_values[0] - 0.5,   imm_values[-1] + 0.5,
        ],
    )
    plt.colorbar(im2, ax=ax, label="Housing rate (fraction of 100 parcels)")
    ax.set_xlabel("Max wealth ceiling", fontsize=11)
    ax.set_ylabel("Immigration rate (agents/round)", fontsize=11)
    ax.set_title("Housing Rate", fontsize=12, fontweight="bold")
    ax.set_xticks(wealth_values[::2])
    ax.set_yticks(imm_values[::2])

    for i in range(len(imm_values)):
        for j in range(len(wealth_values)):
            ax.text(
                wealth_values[j], imm_values[i],
                f"{housing_grid[i, j]:.0%}",
                ha="center", va="center", fontsize=7,
                color="white" if housing_grid[i, j] < 0.5 else "black",
            )

    fig.text(
        0.5, -0.02,
        "Generated with Python/Mesa — "
        "github.com/halcyonic-systems/georgist-network-economy",
        ha="center", fontsize=9, color="#888",
    )

    plt.tight_layout()
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    print(f"  Saved → {out_path}")
    plt.show()


def main():
    parser = argparse.ArgumentParser(description="Phase diagram: immigration × wealth → Gini")
    parser.add_argument("--steps", type=int, default=50, help="Steps per simulation")
    parser.add_argument("--runs", type=int, default=5, help="Runs per parameter combo")
    parser.add_argument("--out", type=str, default="output/phase_diagram.png")
    parser.add_argument("--quick", action="store_true", help="Fast preview (coarse grid, 3 runs)")
    args = parser.parse_args()

    if args.quick:
        imm_values  = list(range(2, 18, 3))   # 6 values
        wealth_values = list(range(10, 55, 8)) # 6 values
        runs = 3
    else:
        imm_values  = list(range(1, 21, 2))    # 10 values: 1,3,5,...19
        wealth_values = list(range(10, 55, 5)) # 9 values: 10,15,...50
        runs = args.runs

    total = len(imm_values) * len(wealth_values) * runs
    print(f"Phase diagram sweep")
    print(f"  immigration_rate: {imm_values}")
    print(f"  max_wealth:       {wealth_values}")
    print(f"  {len(imm_values)} × {len(wealth_values)} combos × {runs} runs = {total} simulations")
    print(f"  {args.steps} steps each")
    print()

    gini_grid, housing_grid = sweep(imm_values, wealth_values, args.steps, runs)

    print()
    print(f"  Gini range:        {gini_grid.min():.3f} – {gini_grid.max():.3f}")
    print(f"  Housing rate range: {housing_grid.min():.1%} – {housing_grid.max():.1%}")
    print()

    plot(gini_grid, housing_grid, imm_values, wealth_values, args.steps, runs, args.out)


if __name__ == "__main__":
    main()
