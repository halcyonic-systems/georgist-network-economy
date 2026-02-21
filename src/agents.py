"""
Agent classes for the Georgist Land Value Simulation.

Matches Jane's specification:
- Agents have wealth, track when they entered, and hold leases
- No complex behaviors — agents are passive participants in auctions
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Leaseholder:
    """
    An economic actor seeking housing.

    Attributes:
        id: Unique identifier (format: r{round}-a{idx}-{random})
        wealth: Bidding capacity (1 to max_wealth)
        round_entered: Immigration round
        lease_start: Round current lease began (None if unhoused)
        lease_length: Duration of current lease (None if unhoused)
    """
    id: str
    wealth: int
    round_entered: int
    lease_start: Optional[int] = None
    lease_length: Optional[int] = None

    @property
    def is_housed(self) -> bool:
        return self.lease_start is not None

    @property
    def lease_expires(self) -> Optional[int]:
        if self.lease_start is None or self.lease_length is None:
            return None
        return self.lease_start + self.lease_length

    def assign_lease(self, start_round: int, length: int) -> None:
        self.lease_start = start_round
        self.lease_length = length

    def clear_lease(self) -> None:
        self.lease_start = None
        self.lease_length = None


@dataclass
class ParcelState:
    """
    State of a single parcel on the 10×10 grid.

    Attributes:
        environment_score: Fixed value based on column (1–10)
        community_score: Dynamic value based on neighbors (0–16)
        occupant: Current leaseholder or None
        lease_price: Price locked at lease formation
        rounds_vacant: Consecutive rounds without occupant
        history: Event log for this parcel
    """
    environment_score: float
    community_score: float = 0.0
    occupant: Optional[Leaseholder] = None
    lease_price: Optional[float] = None
    rounds_vacant: int = 0
    history: list = field(default_factory=list)

    @property
    def market_value(self) -> float:
        return self.environment_score + self.community_score

    @property
    def display_value(self) -> float:
        if self.occupant and self.lease_price is not None:
            return self.lease_price
        return self.market_value

    @property
    def is_vacant(self) -> bool:
        return self.occupant is None

    def add_event(self, round_num: int, event_type: str, details: dict) -> None:
        self.history.append({
            "round": round_num,
            "type": event_type,
            "details": details,
        })
