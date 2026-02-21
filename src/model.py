"""
Georgist Land Value Simulation — Mesa Model

Replicates Jane's React/TSX prototype in Mesa 3.
Faithfully implements her 7-step round pipeline and 5-outcome auction.

Mesa advantages over TSX:
- DataCollector: Gini coefficient, housing rate, avg wealth tracked over all rounds
- Seed param for reproducible runs
- CSV export of full time-series (not just current snapshot)
"""

import mesa
import random
import string
from typing import Optional, List, Dict, Any

from .agents import Leaseholder, ParcelState
from .constants import DEFAULT_PARAMS


def _gini(values: List[float]) -> float:
    """Compute Gini coefficient from a list of values."""
    if not values or len(values) == 1:
        return 0.0
    s = sorted(values)
    n = len(s)
    cumsum = sum((i + 1) * v for i, v in enumerate(s))
    total = sum(s)
    if total == 0:
        return 0.0
    return (2 * cumsum) / (n * total) - (n + 1) / n


class GeorgistModel(mesa.Model):
    """
    Georgist Land Value Simulation.

    7-step pipeline per round:
    1. Update community scores
    2. Increment rounds_vacant for empty parcels
    3. Identify expired leases
    4. Collect agents (expired + unhoused + immigrants), sort by wealth
    5. Sort parcels by market value (highest first)
    6. Run auctions
    7. Final score recalc + DataCollector

    Auction (5 outcomes, Jane's spec):
    - Vacant lot → wealthiest eligible wins at market_value
    - No challenger → defender keeps at market_value
    - Challenger > defender → challenger wins at max(market, defender+1)
    - Challenger = defender → defender wins at challenger.wealth
    - Challenger < defender → defender wins at max(market, challenger+1)
    """

    def __init__(
        self,
        immigration_rate: int = DEFAULT_PARAMS["immigration_rate"],
        min_lease_length: int = DEFAULT_PARAMS["min_lease_length"],
        max_lease_length: int = DEFAULT_PARAMS["max_lease_length"],
        max_wealth: int = DEFAULT_PARAMS["max_wealth"],
        vacancy_decay: bool = DEFAULT_PARAMS["vacancy_decay"],
        environment_weight: float = DEFAULT_PARAMS["environment_weight"],
        community_weight: float = DEFAULT_PARAMS["community_weight"],
        seed: Optional[int] = None,
    ):
        import numpy as np
        rng = np.random.default_rng(seed) if seed is not None else np.random.default_rng()
        super().__init__(rng=rng)

        self.immigration_rate = immigration_rate
        self.min_lease_length = min_lease_length
        self.max_lease_length = max_lease_length
        self.max_wealth = max_wealth
        self.vacancy_decay = vacancy_decay
        self.environment_weight = environment_weight
        self.community_weight = community_weight

        self.grid_width = 10
        self.grid_height = 10

        # Initialize parcels (row-major: index = row * 10 + col)
        self.parcels: List[ParcelState] = []
        for row in range(self.grid_height):
            for col in range(self.grid_width):
                env_score = col + 1  # Column 0→1, column 9→10 (Jane's spec)
                self.parcels.append(ParcelState(environment_score=env_score))

        self.housed_agents: Dict[int, Leaseholder] = {}   # parcel_index → agent
        self.unhoused_agents: List[Leaseholder] = []
        self.current_round = 0

        self.datacollector = mesa.DataCollector(
            model_reporters={
                "round": lambda m: m.current_round,
                "housing_rate": lambda m: len(m.housed_agents) / 100,
                "unhoused_count": lambda m: len(m.unhoused_agents),
                "population": lambda m: len(m.housed_agents) + len(m.unhoused_agents),
                "avg_land_value": lambda m: m._mean_market_value(),
                "avg_lease_price": lambda m: m._mean_lease_price(),
                "avg_wealth_housed": lambda m: m._avg_wealth(housed=True),
                "avg_wealth_unhoused": lambda m: m._avg_wealth(housed=False),
                "gini_coefficient": lambda m: m._gini_all_agents(),
            }
        )

    # =========================================================================
    # Grid utilities
    # =========================================================================

    def _index_to_coords(self, index: int):
        return index // self.grid_width, index % self.grid_width

    def _coords_to_index(self, row: int, col: int) -> int:
        return row * self.grid_width + col

    def _is_valid(self, row: int, col: int) -> bool:
        return 0 <= row < self.grid_height and 0 <= col < self.grid_width

    # =========================================================================
    # Community score (Jane's 2-ring algorithm)
    # =========================================================================

    def _calc_community_score(self, idx: int) -> float:
        row, col = self._index_to_coords(idx)
        score = 0.0
        # Ring 1: 8 immediate neighbours, +1 each
        for dr in [-1, 0, 1]:
            for dc in [-1, 0, 1]:
                if dr == 0 and dc == 0:
                    continue
                nr, nc = row + dr, col + dc
                if self._is_valid(nr, nc) and not self.parcels[self._coords_to_index(nr, nc)].is_vacant:
                    score += 1.0
        # Ring 2: outer ring up to 16 cells, +0.5 each
        for dr in [-2, -1, 0, 1, 2]:
            for dc in [-2, -1, 0, 1, 2]:
                if abs(dr) <= 1 and abs(dc) <= 1:
                    continue
                nr, nc = row + dr, col + dc
                if self._is_valid(nr, nc) and not self.parcels[self._coords_to_index(nr, nc)].is_vacant:
                    score += 0.5
        return score

    def _update_all_community_scores(self) -> None:
        for i, parcel in enumerate(self.parcels):
            parcel.community_score = self._calc_community_score(i)

    # =========================================================================
    # Value calculations
    # =========================================================================

    def _weighted_value(self, idx: int) -> float:
        p = self.parcels[idx]
        return p.environment_score * self.environment_weight + p.community_score * self.community_weight

    def _max_weighted_value(self) -> float:
        return 10 * self.environment_weight + 16 * self.community_weight

    # =========================================================================
    # Metrics
    # =========================================================================

    def _mean_lease_price(self) -> float:
        prices = [p.lease_price for p in self.parcels if p.lease_price is not None]
        return sum(prices) / len(prices) if prices else 0.0

    def _mean_market_value(self) -> float:
        return sum(self._weighted_value(i) for i in range(100)) / 100

    def _avg_wealth(self, housed: bool) -> float:
        if housed:
            agents = list(self.housed_agents.values())
        else:
            agents = self.unhoused_agents
        if not agents:
            return 0.0
        return sum(a.wealth for a in agents) / len(agents)

    def _gini_all_agents(self) -> float:
        all_agents = list(self.housed_agents.values()) + self.unhoused_agents
        if not all_agents:
            return 0.0
        return _gini([float(a.wealth) for a in all_agents])

    # =========================================================================
    # Agent creation
    # =========================================================================

    def _new_agent_id(self, idx: int) -> str:
        suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))
        return f"r{self.current_round}-a{idx}-{suffix}"

    def _create_immigrants(self) -> List[Leaseholder]:
        return [
            Leaseholder(
                id=self._new_agent_id(i),
                wealth=random.randint(1, self.max_wealth),
                round_entered=self.current_round,
            )
            for i in range(self.immigration_rate)
        ]

    # =========================================================================
    # 7-step pipeline
    # =========================================================================

    def step(self) -> None:
        self.current_round += 1

        # Step 1: Community scores
        self._update_all_community_scores()

        # Step 2: Vacancy counters
        for parcel in self.parcels:
            if parcel.is_vacant:
                parcel.rounds_vacant += 1
            else:
                parcel.rounds_vacant = 0

        # Step 3: Identify expired leases
        expired_agents = []
        lots_for_auction = []
        expired_indices = set()

        for idx, parcel in enumerate(self.parcels):
            if parcel.occupant is not None and parcel.occupant.lease_expires == self.current_round:
                agent = parcel.occupant
                expired_agents.append((agent, idx))
                parcel.add_event(self.current_round, "lease_expired", {
                    "agent_id": agent.id,
                    "agent_wealth": agent.wealth,
                    "lease_price": parcel.lease_price,
                    "market_value": self._weighted_value(idx),
                })
                lots_for_auction.append({
                    "index": idx,
                    "market_value": self._weighted_value(idx),
                    "defender": agent,
                })
                expired_indices.add(idx)
                self.housed_agents.pop(idx, None)
                parcel.occupant = None
                parcel.lease_price = None

        # Vacant lots also go to auction
        for idx, parcel in enumerate(self.parcels):
            if parcel.is_vacant and idx not in expired_indices:
                mv = self._weighted_value(idx)
                if self.vacancy_decay and parcel.rounds_vacant > 0:
                    mv = max(1.0, mv - parcel.rounds_vacant * 0.5)
                lots_for_auction.append({
                    "index": idx,
                    "market_value": mv,
                    "defender": None,
                })

        # Step 4: Collect agents needing placement
        agents_to_place = []
        for agent, prev_idx in expired_agents:
            agents_to_place.append({"agent": agent, "source": "expired_lease", "prev_idx": prev_idx})
        for agent in self.unhoused_agents:
            agents_to_place.append({"agent": agent, "source": "unhoused", "prev_idx": None})
        self.unhoused_agents = []
        for agent in self._create_immigrants():
            agents_to_place.append({"agent": agent, "source": "immigrant", "prev_idx": None})

        # Step 5 & 6: Sort then run auctions
        lots_for_auction.sort(key=lambda x: x["market_value"], reverse=True)
        agents_to_place.sort(key=lambda x: x["agent"].wealth, reverse=True)

        placed_ids = set()

        for lot in lots_for_auction:
            idx = lot["index"]
            market_value = lot["market_value"]
            defender = lot["defender"]

            eligible = [
                e for e in agents_to_place
                if e["agent"].id not in placed_ids
                and e["agent"].wealth >= market_value
            ]

            if not eligible:
                if defender:
                    self.parcels[idx].add_event(self.current_round, "priced_out", {
                        "agent_id": defender.id,
                        "market_value": market_value,
                    })
                continue

            winner, lease_price = self._run_auction(market_value, defender, eligible)

            if winner:
                lease_length = random.randint(self.min_lease_length, self.max_lease_length)
                winner.assign_lease(self.current_round, lease_length)

                parcel = self.parcels[idx]
                parcel.occupant = winner
                parcel.lease_price = lease_price
                parcel.rounds_vacant = 0

                self.housed_agents[idx] = winner
                placed_ids.add(winner.id)

                event_type = "auction_won" if defender else "occupied"
                parcel.add_event(self.current_round, event_type, {
                    "agent_id": winner.id,
                    "agent_wealth": winner.wealth,
                    "lease_price": lease_price,
                    "market_value": market_value,
                    "lease_length": lease_length,
                })

        # Step 6 continued: unplaced → unhoused
        for entry in agents_to_place:
            if entry["agent"].id not in placed_ids:
                entry["agent"].clear_lease()
                self.unhoused_agents.append(entry["agent"])

        # Step 7: Final recalc + DataCollector
        self._update_all_community_scores()
        self.datacollector.collect(self)

    # =========================================================================
    # Auction
    # =========================================================================

    def _run_auction(
        self,
        market_value: float,
        defender: Optional[Leaseholder],
        eligible: List[dict],
    ):
        if not defender:
            # Vacant lot — wealthiest eligible wins at market value
            return eligible[0]["agent"], market_value

        # Find challenger (wealthiest who is not the defender)
        challenger_entry = next(
            (e for e in eligible if e["agent"].id != defender.id), None
        )

        if not challenger_entry:
            # No challenger — defender keeps at market value
            return defender, market_value

        challenger = challenger_entry["agent"]

        if challenger.wealth > defender.wealth:
            return challenger, max(market_value, defender.wealth + 1)
        elif challenger.wealth == defender.wealth:
            return defender, float(challenger.wealth)
        else:
            return defender, max(market_value, challenger.wealth + 1)

    # =========================================================================
    # State export
    # =========================================================================

    def get_state(self) -> Dict[str, Any]:
        parcels_data = []
        for i, parcel in enumerate(self.parcels):
            row, col = self._index_to_coords(i)
            wv = self._weighted_value(i)
            display_val = parcel.lease_price if parcel.occupant and parcel.lease_price else wv
            parcels_data.append({
                "id": i,
                "row": row,
                "col": col,
                "environment_score": parcel.environment_score,
                "community_score": round(parcel.community_score, 2),
                "market_value": round(wv, 2),
                "display_value": round(display_val, 2),
                "lease_price": round(parcel.lease_price, 2) if parcel.lease_price else None,
                "rounds_vacant": parcel.rounds_vacant,
                "occupant": {
                    "id": parcel.occupant.id,
                    "wealth": parcel.occupant.wealth,
                    "lease_start": parcel.occupant.lease_start,
                    "lease_length": parcel.occupant.lease_length,
                    "lease_expires": parcel.occupant.lease_expires,
                    "round_entered": parcel.occupant.round_entered,
                } if parcel.occupant else None,
            })

        unhoused_data = [
            {"id": a.id, "wealth": a.wealth, "round_entered": a.round_entered}
            for a in self.unhoused_agents
        ]

        all_agents = list(self.housed_agents.values()) + self.unhoused_agents
        wealth_all = [a.wealth for a in all_agents]

        return {
            "round": self.current_round,
            "parcels": parcels_data,
            "unhoused": unhoused_data,
            "stats": {
                "population": len(all_agents),
                "housed": len(self.housed_agents),
                "unhoused_count": len(self.unhoused_agents),
                "housing_rate": round(len(self.housed_agents) / 100, 3),
                "avg_land_value": round(self._mean_market_value(), 2),
                "avg_lease_price": round(self._mean_lease_price(), 2),
                "avg_wealth_housed": round(self._avg_wealth(housed=True), 2),
                "avg_wealth_unhoused": round(self._avg_wealth(housed=False), 2),
                "gini_coefficient": round(self._gini_all_agents(), 3),
                "max_wealth": max(wealth_all) if wealth_all else 0,
                "min_wealth": min(wealth_all) if wealth_all else 0,
            },
            "params": {
                "immigration_rate": self.immigration_rate,
                "min_lease_length": self.min_lease_length,
                "max_lease_length": self.max_lease_length,
                "max_wealth": self.max_wealth,
                "vacancy_decay": self.vacancy_decay,
                "environment_weight": self.environment_weight,
                "community_weight": self.community_weight,
            },
            "max_value": self._max_weighted_value(),
        }

    def get_history(self) -> Dict[str, Any]:
        """Export DataCollector time-series as JSON."""
        df = self.datacollector.get_model_vars_dataframe()
        if df.empty:
            return {col: [] for col in [
                "round", "housing_rate", "unhoused_count", "population",
                "avg_land_value", "avg_lease_price",
                "avg_wealth_housed", "avg_wealth_unhoused", "gini_coefficient"
            ]}
        records = df.reset_index()
        return {col: records[col].tolist() for col in records.columns}
