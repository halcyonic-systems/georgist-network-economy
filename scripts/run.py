"""
Reproducibility Receipt — Run a scenario and get a verifiable output

Runs the simulation with a fixed seed, exports full time-series CSV,
and prints a reproducibility receipt: everything needed to recreate
exactly the same run.

Share the receipt with a collaborator. They run the same command.
They get the same output. That's what peer review looks like.

Usage:
    python scripts/run.py
    python scripts/run.py --scenario inequality --seed 42 --steps 52
    python scripts/run.py --scenario declining-city --seed 99 --steps 100 --out results/
"""

import sys
import argparse
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import mesa

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.model import GeorgistModel
from src.constants import SCENARIOS


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def run(scenario_id: str, seed: int, steps: int, out_dir: str) -> dict:
    """Run simulation, export CSV, return receipt dict."""
    scenario = SCENARIOS[scenario_id]
    params   = scenario["params"]

    m = GeorgistModel(**params, seed=seed)

    t0 = time.time()
    for _ in range(steps):
        m.step()
    elapsed = time.time() - t0

    # Export time-series CSV
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    csv_path = Path(out_dir) / f"{scenario_id}_seed{seed}_r{steps}_{ts}.csv"

    history = m.get_history()
    columns = list(history.keys())
    n_rows  = len(history[columns[0]])

    with open(csv_path, "w") as f:
        f.write(",".join(columns) + "\n")
        for i in range(n_rows):
            row = []
            for col in columns:
                v = history[col][i]
                row.append(f"{v:.6f}" if isinstance(v, float) else str(v))
            f.write(",".join(row) + "\n")

    csv_hash = sha256_file(str(csv_path))

    # Final state summary
    final = {col: history[col][-1] for col in columns if history[col]}

    receipt = {
        "scenario_id":   scenario_id,
        "scenario_title": scenario["title"],
        "seed":          seed,
        "steps":         steps,
        "params":        params,
        "mesa_version":  mesa.__version__,
        "python":        platform.python_version(),
        "platform":      platform.system(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "elapsed_s":     round(elapsed, 3),
        "output_csv":    str(csv_path),
        "sha256":        csv_hash,
        "final_round":   final.get("round"),
        "final_gini":    round(final.get("gini_coefficient", 0), 4),
        "final_housing": round(final.get("housing_rate", 0), 4),
        "final_population": final.get("population"),
    }

    return receipt


def print_receipt(r: dict):
    w = 60
    print()
    print("=" * w)
    print(f"  REPRODUCIBILITY RECEIPT")
    print("=" * w)
    print(f"  Scenario : {r['scenario_title']}")
    print(f"  Seed     : {r['seed']}")
    print(f"  Steps    : {r['steps']}")
    print(f"  Mesa     : {r['mesa_version']}")
    print(f"  Python   : {r['python']}  ({r['platform']})")
    print(f"  Run time : {r['elapsed_s']}s")
    print()
    print(f"  Parameters:")
    for k, v in r["params"].items():
        print(f"    {k:<25} {v}")
    print()
    print(f"  Final state (round {r['final_round']}):")
    print(f"    Gini coefficient   {r['final_gini']:.4f}")
    print(f"    Housing rate       {r['final_housing']:.1%}")
    print(f"    Population         {r['final_population']}")
    print()
    print(f"  Output CSV : {r['output_csv']}")
    print(f"  SHA-256    : {r['sha256']}")
    print("=" * w)
    print()
    print("  To reproduce this exact run:")
    print(f"    python scripts/run.py \\")
    print(f"      --scenario {r['scenario_id']} \\")
    print(f"      --seed {r['seed']} \\")
    print(f"      --steps {r['steps']}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Run a scenario and print a reproducibility receipt")
    parser.add_argument("--scenario", type=str, default="balanced",
                        choices=list(SCENARIOS.keys()),
                        help="Scenario to run")
    parser.add_argument("--seed",  type=int, default=42,   help="Random seed")
    parser.add_argument("--steps", type=int, default=52,   help="Number of rounds")
    parser.add_argument("--out",   type=str, default="results/", help="Output directory")
    parser.add_argument("--json",  action="store_true", help="Also write receipt as JSON")
    args = parser.parse_args()

    print(f"Running {SCENARIOS[args.scenario]['title']} · seed={args.seed} · {args.steps} steps …")
    receipt = run(args.scenario, args.seed, args.steps, args.out)
    print_receipt(receipt)

    if args.json:
        json_path = Path(args.out) / f"receipt_{args.scenario}_seed{args.seed}.json"
        with open(json_path, "w") as f:
            json.dump(receipt, f, indent=2)
        print(f"  Receipt JSON → {json_path}")


if __name__ == "__main__":
    main()
