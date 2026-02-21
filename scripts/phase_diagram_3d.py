"""
Interactive 3D Phase Surface — Immigration Rate × Max Wealth × Gini

Same data as phase_diagram.py, rendered as an interactive Plotly 3D surface.
Saves as a self-contained HTML file — no server required.

This is the "explore interactively" artifact linked from the newsletter,
not the inline figure. A 2D heatmap reads better as a static Substack image;
this is for readers who want to rotate the landscape themselves.

Usage:
    python scripts/phase_diagram_3d.py
    python scripts/phase_diagram_3d.py --runs 3 --quick --out output/phase_3d.html
"""

import sys
import argparse
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.model import GeorgistModel


def run_single(immigration_rate: int, max_wealth: int, steps: int, seed: int) -> dict:
    m = GeorgistModel(immigration_rate=immigration_rate, max_wealth=max_wealth, seed=seed)
    for _ in range(steps):
        m.step()
    h = m.get_history()
    return {
        "gini": h["gini_coefficient"][-1] if h["gini_coefficient"] else 0.0,
        "housing_rate": h["housing_rate"][-1] if h["housing_rate"] else 0.0,
    }


def sweep(imm_values, wealth_values, steps, runs_per_combo):
    n_imm    = len(imm_values)
    n_wealth = len(wealth_values)
    gini_grid    = np.zeros((n_imm, n_wealth))
    housing_grid = np.zeros((n_imm, n_wealth))

    total = n_imm * n_wealth * runs_per_combo
    done  = 0
    t0    = time.time()

    for i, imm in enumerate(imm_values):
        for j, wealth in enumerate(wealth_values):
            gini_samples    = []
            housing_samples = []
            for run in range(runs_per_combo):
                seed   = i * 10000 + j * 100 + run
                result = run_single(imm, wealth, steps, seed)
                gini_samples.append(result["gini"])
                housing_samples.append(result["housing_rate"])
                done += 1
            gini_grid[i, j]    = np.mean(gini_samples)
            housing_grid[i, j] = np.mean(housing_samples)
            elapsed   = time.time() - t0
            remaining = (elapsed / done) * (total - done) if done else 0
            print(f"\r  {done}/{total}  [{elapsed:.0f}s elapsed, ~{remaining:.0f}s remaining]",
                  end="", flush=True)

    print()
    return gini_grid, housing_grid


def build_html(gini_grid, housing_grid, imm_values, wealth_values, steps, runs, out_path):
    try:
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots
        import plotly.io as pio
    except ImportError:
        print("  plotly not installed — run: pip install plotly")
        print("  Falling back to saving numpy arrays as CSV.")
        np.savetxt(out_path.replace(".html", "_gini.csv"), gini_grid, delimiter=",")
        return

    W = np.array(wealth_values)
    I = np.array(imm_values)

    fig = make_subplots(
        rows=1, cols=2,
        specs=[[{"type": "surface"}, {"type": "surface"}]],
        subplot_titles=["Gini Coefficient", "Housing Rate"],
        horizontal_spacing=0.05,
    )

    fig.add_trace(go.Surface(
        z=gini_grid,
        x=W, y=I,
        colorscale="RdYlGn_r",
        cmin=0, cmax=0.6,
        colorbar=dict(title="Gini", x=0.45, len=0.8),
        name="Gini",
    ), row=1, col=1)

    fig.add_trace(go.Surface(
        z=housing_grid,
        x=W, y=I,
        colorscale="RdYlGn",
        cmin=0, cmax=1,
        colorbar=dict(title="Housing rate", x=1.02, len=0.8),
        name="Housing rate",
    ), row=1, col=2)

    camera = dict(eye=dict(x=1.6, y=-1.6, z=1.2))

    axis_style = dict(
        tickfont=dict(size=10),
        title_font=dict(size=11),
    )

    fig.update_layout(
        title=dict(
            text=(
                f"<b>Georgist Land Value Simulation — Parameter Space</b><br>"
                f"<sup>Mean over {runs} runs × {steps} rounds each  ·  "
                f"{len(imm_values) * len(wealth_values) * runs:,} total simulations  ·  "
                "github.com/halcyonic-systems/georgist-network-economy</sup>"
            ),
            x=0.5, xanchor="center",
        ),
        scene=dict(
            xaxis=dict(title="Max wealth", **axis_style),
            yaxis=dict(title="Immigration rate", **axis_style),
            zaxis=dict(title="Gini", **axis_style),
            camera=camera,
        ),
        scene2=dict(
            xaxis=dict(title="Max wealth", **axis_style),
            yaxis=dict(title="Immigration rate", **axis_style),
            zaxis=dict(title="Housing rate", **axis_style),
            camera=camera,
        ),
        height=650,
        margin=dict(l=0, r=0, t=100, b=0),
    )

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    pio.write_html(fig, out_path, full_html=True, include_plotlyjs=True)
    print(f"  Saved → {out_path}")
    print(f"  Open in browser: open {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Interactive 3D phase surface (Plotly HTML)")
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--runs",  type=int, default=5)
    parser.add_argument("--out",   type=str, default="output/phase_3d.html")
    parser.add_argument("--quick", action="store_true", help="Coarse grid, 3 runs")
    args = parser.parse_args()

    if args.quick:
        imm_values    = list(range(2, 18, 4))
        wealth_values = list(range(10, 55, 10))
        runs = 3
    else:
        imm_values    = list(range(1, 21, 2))
        wealth_values = list(range(10, 55, 5))
        runs = args.runs

    total = len(imm_values) * len(wealth_values) * runs
    print(f"3D phase surface")
    print(f"  {len(imm_values)} × {len(wealth_values)} combos × {runs} runs = {total} simulations")
    print()

    gini_grid, housing_grid = sweep(imm_values, wealth_values, args.steps, runs)
    print()
    build_html(gini_grid, housing_grid, imm_values, wealth_values, args.steps, runs, args.out)


if __name__ == "__main__":
    main()
