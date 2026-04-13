"""
File: unsupported_hazard.py  [DEPRECATED — kept for import compatibility only]

Previously hosted stub pipeline classes for four hazards that were formally
UNSUPPORTED because no scientifically valid training path existed with
publicly available open data.

As of the global-first architecture refactor (2026-04-09), all four hazards
have been enabled with independent, non-tautological label sources:

  power_outage            → train_power_outage_real.py
                            Labels: UK Named Storm Outage Records (embedded) +
                            EIA Form OE-417 (US federal NERC reporting)

  water_supply_disruption → train_water_supply_disruption_real.py
                            Labels: GRDC measured discharge Q10/Q90 +
                            curated WHO/EA/USBR water supply disruption events

  infrastructure_damage   → train_infrastructure_damage_real.py
                            Labels: EM-DAT global disaster catalog (CRED)

  public_safety_incident  → train_public_safety_incident_real.py
                            Labels: UK DfT Stats19 + US NHTSA FARS road accidents

train_all.py now imports directly from the real pipeline modules.
UNSUPPORTED_HAZARDS frozenset in hazard_status.py is now empty.

This file is retained only so that any external scripts that import these
class names by name from unsupported_hazard continue to work — they are
re-exported from the real modules below.
"""

# Re-export from real pipelines for backwards compatibility
from app.training.train_power_outage_real import PowerOutageRealPipeline           # noqa: F401
from app.training.train_water_supply_disruption_real import WaterSupplyDisruptionRealPipeline  # noqa: F401
from app.training.train_infrastructure_damage_real import InfrastructureDamageRealPipeline     # noqa: F401
from app.training.train_public_safety_incident_real import PublicSafetyIncidentRealPipeline    # noqa: F401

__all__ = [
    "PowerOutageRealPipeline",
    "WaterSupplyDisruptionRealPipeline",
    "InfrastructureDamageRealPipeline",
    "PublicSafetyIncidentRealPipeline",
]
