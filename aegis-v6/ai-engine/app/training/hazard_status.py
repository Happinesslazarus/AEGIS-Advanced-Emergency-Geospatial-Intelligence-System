"""
Defines the validation status system for all 11 hazard training pipelines.

A hazard is only trained if its data and labels meet research-grade standards.
Every hazard gets a status (TRAINABLE / PARTIAL / NOT_TRAINABLE / UNSUPPORTED)
with a clear reason and a recommended fix.  This module is the single source
of truth for per-hazard leakage annotations and validation metadata.

Used by:
  - hazard_validator.py  (validation logic)
  - base_real_pipeline.py  (called inside every pipeline's run() method)
  - session_report.py  (summarises the full training session)

Design principles applied throughout this refactor
---------------------------------------------------
- Labels must come from an INDEPENDENT external source (real events, satellite
  detection, authoritative records).  Labels derived by thresholding the very
  same variables that are used as model input features are a tautology.
- Any hazard that cannot be made scientifically valid with currently available
  public data is marked UNSUPPORTED.  It appears in every session report with a
  clear reason and exact data requirement so the gap is never hidden.
- Region scope defaults to GLOBAL or MULTI-REGION.  UK-only is only acceptable
  when UK data are both sufficient (class balance) and scientifically valid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class HazardStatus(str, Enum):
    """What the validator determined about a hazard's data and labels.

    TRAINABLE    - Data and labels are clean.  Run full pipeline.
    PARTIAL      - Usable but imperfect (e.g. moderate feature/label
                   correlation, or mild class imbalance).  Train with
                   prominent warnings attached to any published metrics.
    NOT_TRAINABLE - Invalid data, missing labels, degenerate splits, or a
                   direct tautology between label derivation and feature
                   columns.  Skip cleanly.  Do not produce or save metrics.
    UNSUPPORTED  - No scientifically valid training path exists with currently
                   available public data regardless of data quality.  Training
                   is not attempted.  A required_dataset entry documents
                   exactly what would be needed to enable this hazard.
    """
    TRAINABLE = "TRAINABLE"
    PARTIAL = "PARTIAL"
    NOT_TRAINABLE = "NOT_TRAINABLE"
    UNSUPPORTED = "UNSUPPORTED"


class LeakageSeverity(str, Enum):
    """How badly the label definition overlaps with the feature set.

    NONE     - Labels come from an independent external source (e.g. recorded
               flood events from SEPA).  No shared variables.
    LOW      - Very indirect correlation only.  The label is based on a
               different temporal aggregation or spatial scale than the
               corresponding feature (e.g. 90-day SPI label vs 7-day
               antecedent rainfall feature).  Acceptable if lead_hours > 0.
    MODERATE - Labels use a lagged or persistent form of a feature variable
               (e.g. heatwave requires 3 consecutive days above threshold, so
               there is at least some temporal separation from the hourly
               feature).
    HIGH     - Label threshold is applied directly to variables also present
               as features, but with some indirect or aggregated form.
    SEVERE   - The exact variable that defines the label threshold is listed
               verbatim as a feature column.  The model reconstructs a rule
               rather than learning a generalizable pattern.
    """
    NONE = "none"
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    SEVERE = "severe"


@dataclass
class ValidationResult:
    """Full validation outcome for a single hazard.

    Populated by HazardValidator and attached to every pipeline result so that
    session_report.py can include it in the per-session JSON and CSV.
    """
    hazard: str
    status: HazardStatus
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    recommended_fix: str = ""
    label_integrity: str = "unknown"   # "clean" | "partial_tautology" | "tautology"
    leakage_severity: LeakageSeverity = LeakageSeverity.NONE
    tainted_columns: list[str] = field(default_factory=list)
    # Research metadata fields (declared by each pipeline via HazardConfig)
    region_scope: str = "UNKNOWN"      # "UK" | "MULTI-REGION" | "GLOBAL"
    label_source: str = "UNKNOWN"      # free-text description
    data_validity: str = "UNKNOWN"     # "independent" | "proxy" | "invalid"
    required_dataset: str = ""         # for UNSUPPORTED: what would fix this
    dissertation_suitability: str = "" # "strong" | "acceptable" | "unsupported"
    # Populated after training completes (only for TRAINABLE / PARTIAL)
    metrics: dict = field(default_factory=dict)
    sample_stats: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "hazard": self.hazard,
            "status": self.status.value,
            "label_integrity": self.label_integrity,
            "leakage_severity": self.leakage_severity.value,
            "tainted_columns": self.tainted_columns,
            "region_scope": self.region_scope,
            "label_source": self.label_source,
            "data_validity": self.data_validity,
            "required_dataset": self.required_dataset,
            "dissertation_suitability": self.dissertation_suitability,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "recommended_fix": self.recommended_fix,
            "metrics": self.metrics,
            "sample_stats": self.sample_stats,
        }


# ---------------------------------------------------------------------------
# Per-hazard leakage annotations (read-only ground truth)
#
# After the refactor, annotations reflect the *new* design for each hazard:
# - Fixed hazards have reduced severity because tainted columns are removed
#   from their feature sets.
# - UNSUPPORTED hazards are noted separately in UNSUPPORTED_HAZARDS below.
#
# Do not change severity entries here to make a hazard "pass" validation.
# Fix the label derivation or the feature set, then update the annotation.
# ---------------------------------------------------------------------------

HAZARD_LEAKAGE_ANNOTATIONS: dict[str, dict] = {

    "flood": {
        # Labels from SEPA / EA flood event archives — independent source.
        # Feature set includes river levels and rainfall, which are legitimate
        # predictors, not label constructors.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "region_scope": "MULTI-REGION",
        "label_source": (
            "SEPA Flood Data Archive + EA Recorded Flood Outlines (primary); "
            "GloFAS Global Flood Awareness System reanalysis events (global fallback)"
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "note": (
            "Primary labels come from recorded SEPA / Environment Agency flood "
            "event archives — an independent data source. No overlap between "
            "feature columns and the label derivation. GloFAS fallback provides "
            "global coverage when UK APIs are unreachable."
        ),
        "fallback_note": (
            "Precipitation-proxy and river-level-threshold fallback paths create "
            "tautologies (rainfall_24h / level_current used as both label criterion "
            "and feature). Any model trained on a fallback label is NOT_TRAINABLE."
        ),
        "recommended_fix": (
            "Ensure SEPA and Environment Agency APIs are reachable before training. "
            "Never use the precipitation-proxy or river-level-threshold fallback as "
            "the basis for a published model."
        ),
    },

    "drought": {
        # Labels upgraded from ERA5-derived SPI proxy (tautological with features)
        # to CSIC SPEI Global v2.9 computed from CRU TS4 OBSERVED station data
        # (Harris et al., 2020).  SPEI and ERA5 use entirely different underlying
        # datasets → LeakageSeverity.NONE.
        # ERA5-derived SPI (spi_30d, spi_90d) and soil_moisture are now REINSTATED
        # as features — they are no longer tainted because the label comes from a
        # completely different data source (CRU TS4, not ERA5).
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "spi_30d", "spi_90d",
            "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm",
            "level_current", "level_percentile",
        ],
        "region_scope": "GLOBAL",
        "label_source": (
            "CSIC SPEI Global Database v2.9 (Vicente-Serrano et al., 2010): "
            "SPEI-3 < -1.0 (WMO moderate drought) derived from CRU TS4 OBSERVED "
            "station precipitation and temperature — entirely independent of ERA5. "
            "24 globally distributed drought-prone locations. "
            "DOI: 10.20350/digitalCSIC/8508"
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "CSIC SPEI Global NetCDF (spei03.nc, ~150 MB): "
            "https://spei.csic.es/database.html  "
            "or: from app.training.data_fetch_spei import download_spei_dataset; "
            "download_spei_dataset(3)"
        ),
        "note": (
            "Labels upgraded from ERA5-derived SPI proxy to CSIC SPEI Global v2.9. "
            "SPEI is computed from CRU TS4 OBSERVED station data (Harris et al., 2020) "
            "which has zero overlap with the ERA5 reanalysis used for features. "
            "severity = NONE: there is no shared data source between labels and features. "
            "ERA5-derived SPI (spi_30d, spi_90d) and soil_moisture can now be "
            "legitimately included as features — they are not the label source. "
            "24 global sites span sub-Saharan Africa, Mediterranean, Middle East, "
            "South Asia, Australia, NE Brazil, SW USA, and Central America."
        ),
        "recommended_fix": (
            "Download spei03.nc from https://spei.csic.es/database.html and place "
            "at {ai-engine}/data/spei/spei03.nc.  The download_spei_dataset() "
            "function will attempt automatic download.  Consider also downloading "
            "spei12.nc for hydrological drought labels (12-month scale)."
        ),
    },

    "heatwave": {
        # Labels upgraded from ERA5 threshold proxy to officially declared
        # heatwave episodes from national meteorological services (Met Office
        # HHA Level 3+, Météo-France canicule rouge/orange, AEMET aviso rojo,
        # HHWS Italy, HNMS Greece).  Labels are independent event records.
        # consecutive_hot_days has been REINSTATED in features — it is no
        # longer a label constructor because declarations are made by forecasters
        # using factors beyond a raw temperature count.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": ["temperature_2m", "consecutive_hot_days"],
        "region_scope": "MULTI-REGION",
        "label_source": (
            "Formally declared heatwave episodes from national meteorological "
            "services: Met Office HHA Level 3+ (UK), Météo-France canicule "
            "orange/rouge, AEMET aviso rojo (Spain), Italian HHWS Level 3, "
            "HNMS Greece extreme heat advisories.  Static table in "
            "data_fetch_events.OFFICIAL_HEATWAVES (30+ episodes, 2019–2025)."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "note": (
            "Labels upgraded from ERA5 threshold proxy to formally declared "
            "heatwave episodes from European national meteorological services. "
            "Declarations are authoritative public health events that incorporate "
            "Tmax, Tmin, duration, humidity, and health-impact criteria — they "
            "are not a simple ERA5 threshold rule.  This removes all label-feature "
            "correlation: severity = NONE.  consecutive_hot_days has been "
            "reinstated as a feature because with independent event-based labels "
            "it represents genuine observed heat persistence rather than a "
            "reconstruction of the label formula.  Multi-region training "
            "(UK + Mediterranean + Central Europe, 27 stations) provides "
            "sufficient positive examples across all temporal splits."
        ),
        "recommended_fix": (
            "Extend the OFFICIAL_HEATWAVES static table annually with new "
            "declarations from Met Office HHA, Météo-France, and AEMET to "
            "maintain label coverage through recent years."
        ),
    },

    "severe_storm": {
        # Labels upgraded from ERA5 wind/pressure threshold proxy to officially
        # declared named storms from the Met Office / Met Éireann Named Storm
        # Archive (2015–2025, 60+ storms).  Labels are independent event records.
        # wind_speed_10m and wind_gusts_10m have been REINSTATED in features —
        # they are now legitimate predictors, not label constructors.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "pressure_msl", "pressure_change_3h", "pressure_change_6h",
            "wind_speed_10m",
        ],
        "region_scope": "GLOBAL",
        "label_source": (
            "IBTrACS v04r00 (Knapp et al., 2010; WMO authoritative global tropical "
            "cyclone archive): all named storms 2015–2023, WMO_WIND >= 34 knots, "
            "500 km spatial radius, 12 h lead window; 28 globally distributed sites "
            "across all 6 tropical cyclone basins.  "
            "Supplement: Met Office / Met Éireann Named Storm Archive for "
            "extratropical NW European storms (UK/Ireland/NL sites only). "
            "Source: NCEI — https://www.ncei.noaa.gov/products/international-best-track-archive"
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "IBTrACS v04r00 CSV files (auto-downloaded from NCEI ~5–30 MB each): "
            "from app.training.data_fetch_ibtracs import download_ibtracs_basin; "
            "download_ibtracs_basin('NA')  # repeat for WP, EP, NI, SI, SP"
        ),
        "note": (
            "Labels upgraded from ERA5 wind-gust / pressure-drop threshold proxy "
            "to IBTrACS WMO authoritative global tropical cyclone track archive. "
            "Track positions are from national meteorological agency best-track "
            "datasets aggregated by WMO — entirely independent of ERA5 reanalysis. "
            "severity = NONE: no shared data source between labels and features. "
            "wind_speed_10m and wind_gusts_10m reinstated as features — they are "
            "legitimate predictors of storm persistence, not label constructors. "
            "Expanded from UK-only (13 sites) to GLOBAL (28 sites covering all "
            "active tropical cyclone basins).  UK named storms supplement covers "
            "extratropical winter storms absent from IBTrACS."
        ),
        "recommended_fix": (
            "IBTrACS CSV files auto-download on first training run.  "
            "Update NAMED_STORMS in data_fetch_events.py annually for UK/IE/NL "
            "extratropical storm coverage.  For research use, consider raising "
            "min_wind_knots to 64 (hurricane force) to reduce label noise."
        ),
    },

    "wildfire": {
        # Labels upgraded from FWI threshold proxy to NASA FIRMS satellite active
        # fire pixel detections (VIIRS SNPP 375m / MODIS Collection 6.1 1km).
        # Satellite thermal anomaly detections are entirely independent of ERA5.
        # FWI sub-indices remain excluded from features.
        # Falls back to FWI-threshold proxy if FIRMS_MAP_KEY not set (demoted
        # to 'proxy' / PARTIAL in that code path).
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": ["fwi", "ffmc", "dmc", "dc", "isi", "bui"],
        "region_scope": "GLOBAL",
        "label_source": (
            "NASA FIRMS VIIRS SNPP 375m and MODIS SP 1km active fire pixel "
            "archive (https://firms.modaps.eosdis.nasa.gov/api/).  Satellite "
            "thermal anomaly detections are independent of ERA5 meteorological "
            "features.  Requires FIRMS_MAP_KEY environment variable.  "
            "Falls back to FWI-threshold proxy if key absent."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "NASA FIRMS MAP_KEY (free registration at "
            "https://firms.modaps.eosdis.nasa.gov/api/map_key/).  "
            "Set as FIRMS_MAP_KEY environment variable before training.  "
            "Without it, training falls back to FWI-threshold proxy labels "
            "and data_validity is demoted to 'proxy'."
        ),
        "note": (
            "Labels upgraded from FWI-threshold proxy (which used ERA5 "
            "temperature and humidity — moderate correlation with features) to "
            "NASA FIRMS satellite active fire pixel detections.  FIRMS detects "
            "thermal anomalies from polar-orbiting satellites (VIIRS 375m, "
            "MODIS 1km) — entirely independent of any meteorological variable. "
            "severity = NONE: zero overlap between label source (satellite "
            "thermal observations) and feature variables (ERA5 meteorology). "
            "FWI sub-indices remain excluded from features in both primary "
            "and fallback code paths to preserve this separation.  Global "
            "multi-region training (14 locations, Mediterranean + UK + Morocco) "
            "provides sufficient positive samples across all splits."
        ),
        "recommended_fix": (
            "Register for a free NASA FIRMS MAP_KEY and set FIRMS_MAP_KEY "
            "environment variable.  For retrospective training, VIIRS_SNPP_SP "
            "(standard processing, 5–7 day latency) provides highest quality "
            "historical records.  MODIS_SP (1km) is the fallback if VIIRS is "
            "unavailable for a given period."
        ),
    },

    "landslide": {
        # Labels come from NASA Global Landslide Catalog (GLC) / COOLR via the
        # NCCS ESRI FeatureServer REST API — queried live in _fetch_glc_events().
        # GLC records are compiled from news reports, scientific papers, and
        # disaster databases by NASA GSFC — entirely independent of ERA5.
        # With event-based labels, rainfall_24h and rainfall_72h are LEGITIMATE
        # PREDICTORS, not label constructors — severity = NONE.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": ["rainfall_24h", "rainfall_72h"],
        "region_scope": "GLOBAL",
        "label_source": (
            "NASA Global Landslide Catalog (GLC) / Cooperative Open Online "
            "Landslide Repository (COOLR) — ESRI FeatureServer REST API: "
            "https://maps.nccs.nasa.gov/arcgis/rest/services/ISERV/NASA_GLC/"
            "FeatureServer/0/query.  Event records with date + lat/lon matched "
            "to weather stations within 25 km.  No registration required."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "NASA GLC API is queried automatically — no registration required.  "
            "If the API is unreachable, the pipeline falls back to BGS rainfall "
            "thresholds and the validator blocks training as NOT_TRAINABLE.  "
            "The fallback is intentionally blocked to prevent tautological training."
        ),
        "note": (
            "Labels from NASA GLC/COOLR — compiled by NASA GSFC from news archives, "
            "scientific papers, and disaster databases: entirely independent of ERA5. "
            "severity = NONE: no shared data source between GLC event dates and ERA5 "
            "meteorological reanalysis used as features.  All rainfall and soil-moisture "
            "features are legitimate predictors of landslide triggering conditions.  "
            "The pipeline has a graceful fallback to BGS thresholds that explicitly "
            "marks itself as tautological so the validator blocks it — this prevents "
            "any accidental tautological training even in offline environments.  "
            "14 global sites cover Nepal, Colombia, Philippines, Japan, Norway, Italy, "
            "India, and UK — regions with highest GLC event density."
        ),
        "recommended_fix": (
            "No fix required — NASA GLC API auto-queries on training.  "
            "To improve UK coverage, add BGS BNLD data once bulk access is available. "
            "Consider raising _MATCH_RADIUS_DEG from 0.23 (~25km) to 0.45 (~50km) "
            "for regions where the GLC has coarser location precision."
        ),
    },

    "power_outage": {
        # Labels upgraded from weather-threshold tautology to:
        # (a) UK Named Storm Outage Records — embedded, Ofgem/SSEN/WPD/ENW/NIE press
        #     releases; 27 major storms 2015–2025 with customer counts and timestamps.
        # (b) EIA Form OE-417 — US federal NERC-mandated weather disturbance reporting,
        #     all weather-caused electric disturbances 2015–2024.
        # Both are OBSERVED utility operational records — independent of ERA5.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "wind_gusts_10m", "temperature_2m", "relative_humidity_2m",
            "level_current", "level_percentile", "rainfall_24h",
        ],
        "region_scope": "UK+US",
        "label_source": (
            "UK Named Storm Outage Records (Ofgem / SSEN / WPD / ENW / NIE, "
            "2015–2025): 27 major storm events with customer counts and timestamps. "
            "EIA Form OE-417 (US federal NERC reporting, 2015–2024): all weather-caused "
            "electric disturbance events.  Both are observed utility records — "
            "independent of ERA5 reanalysis."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "UK storm outage records are embedded (no download required). "
            "EIA OE-417 (US, optional): "
            "from app.training.data_fetch_outages import download_eia_oe417; "
            "download_eia_oe417()  — or manually from "
            "https://www.eia.gov/electricity/disturbances/"
        ),
        "note": (
            "Labels upgraded from tautological weather-threshold proxy (AUC=0.9999 "
            "was the model reconstructing its own label formula) to observed utility "
            "outage records.  UK storm outages curated from Ofgem disturbance "
            "notifications and network company press releases — independent of ERA5. "
            "EIA OE-417 provides US coverage under federal NERC reporting requirements. "
            "severity = NONE: no shared data source between label records and ERA5 features. "
            "All previously tainted wind/temperature/humidity features are now legitimate "
            "predictors of storm outage likelihood."
        ),
        "recommended_fix": (
            "UK storm records are always embedded.  For US coverage, download "
            "EIA OE-417 annual Excel files.  Update UK_STORM_OUTAGES list in "
            "data_fetch_outages.py each storm season with new named storm outages."
        ),
    },

    "water_supply_disruption": {
        # Labels upgraded from weather-threshold tautology to:
        # (a) GRDC measured daily discharge — Q10 low-flow (drought) and Q90
        #     high-flow (flood turbidity) labels at 22 global gauge stations.
        #     GRDC data is measured river telemetry from national agencies — independent.
        # (b) Curated static water supply disruption events — 20+ WHO/EA/USBR/ANA
        #     documented crisis events from 5 continents, 2015–2023.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "temperature_2m", "level_current", "level_percentile", "rainfall_24h",
        ],
        "region_scope": "GLOBAL",
        "label_source": (
            "GRDC (Global Runoff Data Centre, WMO) measured daily discharge: "
            "Q10 low-flow and Q90 high-flow labels at 22 global gauges. "
            "Curated static water supply disruption events (2015–2023): "
            "Cape Town Day Zero, UK 2018/2022 droughts, São Paulo Cantareira, "
            "Lake Mead shortage, Jordan/Iraq water crises, and more. "
            "All labels independent of ERA5 reanalysis."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "Static events are embedded (no download required). "
            "GRDC gauge data (optional, adds precision): free registration at "
            "https://grdc.bafg.de then: "
            "from app.training.data_fetch_grdc import download_grdc_station; "
            "download_grdc_station(6122100)  # Rhine at Cologne, etc."
        ),
        "note": (
            "Labels upgraded from weather-threshold tautology to observed hydrological "
            "records + official water authority crisis declarations.  GRDC discharge "
            "data comes from national hydrological agency stream-gauge telemetry — "
            "entirely independent of ERA5.  Static events curated from WHO/EA/USBR "
            "bulletins — not meteorological thresholds.  severity = NONE: no shared "
            "data source.  All previously tainted features (rainfall, temperature, "
            "soil moisture) are now legitimate predictors.  22 global training sites."
        ),
        "recommended_fix": (
            "Static events are always available.  For GRDC gauge data, register "
            "at grdc.bafg.de (free) and download discharge records for key training "
            "stations using download_grdc_station().  Consider adding GRDC_TRAINING_STATIONS "
            "entries for additional drought-vulnerable river basins."
        ),
    },

    "infrastructure_damage": {
        # Labels upgraded from weather-threshold tautology to EM-DAT global
        # disaster event records.  EM-DAT (CRED) is the world's most comprehensive
        # disaster database — curated from national agencies, UN OCHA, insurance
        # reports, and peer-reviewed literature.  Independent of ERA5 reanalysis.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "wind_gusts_10m", "rainfall_24h", "level_current",
            "level_percentile", "soil_moisture_0_to_7cm",
        ],
        "region_scope": "MULTI-REGION",
        "label_source": (
            "EM-DAT (Emergency Events Database, CRED / Université catholique de "
            "Louvain): globally validated disaster records (flood, storm, landslide, "
            "wildfire, transport, industrial accident) matched to training stations "
            "by lat/lon haversine (300km) or ISO country fallback.  "
            "Free registration: https://public.emdat.be"
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "EM-DAT export (requires free registration at https://public.emdat.be): "
            "download full Excel export and save to "
            "{ai-engine}/data/emdat/emdat_export.xlsx"
        ),
        "note": (
            "Labels upgraded from tautological weather-threshold proxy (AUC=0.9991 "
            "was the model reconstructing its label formula) to EM-DAT disaster event "
            "records.  EM-DAT data is curated by CRED from national disaster management "
            "agencies, UN OCHA, and peer-reviewed literature — entirely independent of "
            "ERA5 reanalysis.  severity = NONE: no shared data source.  All previously "
            "tainted features (wind, rainfall, soil moisture) are now legitimate "
            "predictors.  Multi-region training across 27 European + Turkey sites."
        ),
        "recommended_fix": (
            "Register at public.emdat.be (free) and download the full Excel export.  "
            "Place at {ai-engine}/data/emdat/emdat_export.xlsx.  "
            "EM-DAT requires academic or institutional affiliation for registration."
        ),
    },

    "public_safety_incident": {
        # Labels upgraded from weather-threshold tautology to:
        # (a) UK DfT Stats19 Road Safety Data — police-reported road injury
        #     accidents with adverse weather condition codes (2015–2023).
        # (b) US NHTSA FARS — all fatal road accidents with adverse atmospheric
        #     condition codes (2015–2022).
        # Both are observed police/government records — independent of ERA5.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],
        "previously_tainted": [
            "temperature_2m", "wind_gusts_10m", "snowfall",
            "visibility", "level_current",
        ],
        "region_scope": "UK+US",
        "label_source": (
            "UK DfT Stats19 Road Safety Data (2015–2023): police-reported road "
            "injury accidents with adverse weather condition codes "
            "{2,3,4,5,6,7,8} (rain, snow, fog, high winds). "
            "US NHTSA FARS (2015–2022): all fatal road accidents with adverse "
            "atmospheric condition codes {2,3,4,5,6,7,8,9,10,11,98}. "
            "80km spatial radius matching. Independent of ERA5 reanalysis."
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "required_dataset": (
            "Stats19 CSV files (free, ~5 MB/year): "
            "https://data.gov.uk/dataset/road-safety-data — or auto-downloaded via "
            "from app.training.data_fetch_road_accidents import download_stats19; "
            "download_stats19().  "
            "NHTSA FARS ZIP files (free): "
            "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars"
        ),
        "note": (
            "Labels upgraded from tautological weather-threshold proxy to observed "
            "road accident records from national transport safety databases.  "
            "Stats19 records are made by police officers at the scene — they represent "
            "OBSERVED weather impacts on public safety, not meteorological rules.  "
            "NHTSA FARS is collected under US federal highway safety legislation.  "
            "severity = NONE: both datasets are entirely independent of ERA5 reanalysis. "
            "All previously tainted features (temperature, wind, snow, visibility) are "
            "now legitimate physical predictors.  22 UK + US training sites."
        ),
        "recommended_fix": (
            "Stats19 auto-downloads from DfT data portal.  FARS requires manual "
            "download of annual ZIP files from NHTSA.  Both can be downloaded via "
            "the data_fetch_road_accidents module download functions."
        ),
    },

    "environmental_hazard": {
        # After fix: aqi, pm2_5, pm10, no2 removed from features.
        # Model uses only meteorological dispersion proxies to predict when
        # air quality exceedances will occur.  Label source (DEFRA/OpenAQ
        # measurements) is independent of the meteorological feature set.
        "severity": LeakageSeverity.NONE,
        "tainted_columns": [],  # Cleared — AQ measurements removed from features
        "previously_tainted": ["aqi", "pm2_5", "pm10", "no2"],
        "region_scope": "MULTI-REGION",
        "label_source": (
            "DEFRA UK-AIR air quality monitoring network hourly exceedance "
            "records (AQI >= 7, PM2.5 > 35 µg/m³, PM10 > 50 µg/m³, "
            "NO2 > 200 µg/m³); OpenAQ global database as supplementary source"
        ),
        "data_validity": "independent",
        "dissertation_suitability": "strong",
        "note": (
            "aqi, pm2_5, pm10, and no2 have been removed from the feature set. "
            "The model now uses only meteorological dispersion proxies "
            "(wind speed, mixing height proxy from temperature lapse, "
            "precipitation, boundary layer indicators) to predict when air "
            "quality exceedances will occur.  This is scientifically valid: "
            "atmospheric dispersion conditions DO influence pollution episodes "
            "without tautologically defining them (emissions vary independently "
            "of the weather).  DEFRA UK-AIR observations provide independent "
            "labels."
        ),
        "recommended_fix": (
            "Extend label source to include OpenAQ global measurements across "
            "multiple cities to improve class balance and geographic diversity. "
            "Add planetary boundary layer height (PBLH) as a feature if "
            "available from ERA5 — it is the primary physical control on "
            "pollution dispersion and is entirely independent of AQ observations."
        ),
    },
}


# ---------------------------------------------------------------------------
# Hazards formally marked UNSUPPORTED
#
# As of this refactor all 11 hazards have been enabled with scientifically
# valid independent label sources.  This frozenset is now empty — every
# hazard will proceed through full validation logic in HazardValidator.
#
# A hazard is UNSUPPORTED when NO scientifically valid training path exists
# with currently available public data regardless of data quality.
# It is NOT_TRAINABLE when data is missing or invalid but a valid path
# exists once data is acquired (see required_dataset in each annotation).
#
# To add a new unsupported hazard in future, add its key here.
# ---------------------------------------------------------------------------

UNSUPPORTED_HAZARDS: frozenset[str] = frozenset()
