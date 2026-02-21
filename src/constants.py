"""
Constants and scenario presets for the Georgist Land Value Simulation.

Scenarios match Jane's 6 exactly by name, description, and parameters.
"""

DEFAULT_PARAMS = {
    "immigration_rate": 10,
    "min_lease_length": 5,
    "max_lease_length": 15,
    "max_wealth": 26,
    "vacancy_decay": True,
    "environment_weight": 1.0,
    "community_weight": 1.0,
}

# Jane's 6 scenarios — names and params match her TSX spec exactly
SCENARIOS = {
    "balanced": {
        "id": "balanced",
        "title": "Balanced Market",
        "description": "Moderate settings across the board. A good starting point to observe natural market dynamics without extreme pressures.",
        "params": {
            "immigration_rate": 10,
            "min_lease_length": 5,
            "max_lease_length": 15,
            "max_wealth": 26,
            "vacancy_decay": True,
            "environment_weight": 1.0,
            "community_weight": 1.0,
        },
    },
    "inequality": {
        "id": "inequality",
        "title": "Extreme Inequality",
        "description": "Demonstrates a radically free market with maximum diversity along all parameters. High wealth ceiling and doubled land value multipliers create intense competition.",
        "params": {
            "immigration_rate": 10,
            "min_lease_length": 1,
            "max_lease_length": 25,
            "max_wealth": 50,
            "vacancy_decay": False,
            "environment_weight": 2.0,
            "community_weight": 2.0,
        },
    },
    "stable-community": {
        "id": "stable-community",
        "title": "Stable Community",
        "description": "Long leases, low immigration, and less wealth inequality. Creates neighbourhoods where tenants stay longer and price changes happen slowly.",
        "params": {
            "immigration_rate": 5,
            "min_lease_length": 15,
            "max_lease_length": 25,
            "max_wealth": 25,
            "vacancy_decay": True,
            "environment_weight": 1.0,
            "community_weight": 1.0,
        },
    },
    "high-churn": {
        "id": "high-churn",
        "title": "High Churn (Short-Term Rentals)",
        "description": "Simulates a market dominated by short-term leases like Airbnb or corporate housing. Very short leases (1–3 rounds) create constant turnover and fierce competition every few rounds.",
        "params": {
            "immigration_rate": 15,
            "min_lease_length": 1,
            "max_lease_length": 3,
            "max_wealth": 40,
            "vacancy_decay": False,
            "environment_weight": 1.5,
            "community_weight": 1.5,
        },
    },
    "distinct-neighbourhoods": {
        "id": "distinct-neighbourhoods",
        "title": "Distinct Neighbourhoods",
        "description": "Higher environmental weight relative to community score creates strips of desirability that more accurately mimic the demand you might see in a city with various neighbourhoods of differing quality.",
        "params": {
            "immigration_rate": 10,
            "min_lease_length": 1,
            "max_lease_length": 10,
            "max_wealth": 30,
            "vacancy_decay": True,
            "environment_weight": 1.8,
            "community_weight": 0.2,
        },
    },
    "declining-city": {
        "id": "declining-city",
        "title": "Declining City (Rust Belt)",
        "description": "Low immigration and strong vacancy decay simulate population decline. Environment matters little; community is everything. Watch neighbourhoods hollow out.",
        "params": {
            "immigration_rate": 3,
            "min_lease_length": 5,
            "max_lease_length": 15,
            "max_wealth": 20,
            "vacancy_decay": True,
            "environment_weight": 0.5,
            "community_weight": 2.0,
        },
    },
}
