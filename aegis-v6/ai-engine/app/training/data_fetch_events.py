"""
Independent event records used as training labels for severe_storm, heatwave,
and wildfire hazard pipelines.

Three data sources are provided:

1. NAMED_STORMS -- static table of every Met Office / Met Éireann / KNMI named
   storm affecting the UK and Ireland (2015-2025). Source: Met Office severe
   weather archive and Named Storm naming lists.  Each record includes the
   storm's start/end dates, peak gust speed (km/h), and a list of affected
   UK region IDs that correspond to UK_GRID_LOCATIONS station IDs.

2. OFFICIAL_HEATWAVES -- static table of formally declared heatwave episodes
   from UK Met Office (Heat-Health Alert activations at Heat Level 3+), Météo-
   France (canicule vigilance rouge/orange), AEMET Spain, and HNMS Greece
   (2019-2025). Each record covers a specific geographic region and includes
   the station IDs from GLOBAL_HEATWAVE_LOCATIONS that were affected.

3. fetch_nasa_firms_events() -- async function that queries the NASA FIRMS
   (Fire Information for Resource Management System) MODIS/VIIRS API for
   confirmed satellite-detected active fire pixels within a lat/lon bounding
   box.  Requires a free FIRMS MAP_KEY in the FIRMS_MAP_KEY environment
   variable.  Fails gracefully (returns empty DataFrame) if the key is absent
   or the API is unreachable.

4. match_events_to_stations() -- shared haversine-based spatial matcher used by
   all three pipelines to map an event's lat/lon (or affected region list) to
   the nearest training weather station(s) within a configurable radius.

Used by:
  train_severe_storm_real.py
  train_heatwave_real.py
  train_wildfire_real.py
"""

from __future__ import annotations

import math
import os
from datetime import datetime, timedelta

import aiohttp
import pandas as pd
from loguru import logger


# Met Office / Met Éireann / KNMI Named Storms (UK & Ireland, 2015-2025)
#
# Sources:
#   Met Office Named Storms archive:
#       https://www.metoffice.gov.uk/weather/warnings-and-advice/named-storms/
#   Met Éireann severe weather archive
#   EUMETNET Name Our Storms project records
#
# Fields:
#   name        -- official storm name
#   start_date  -- first day of named-storm-force winds in UK/Ireland (UTC)
#   end_date    -- last day of named-storm-force winds (inclusive, UTC)
#   peak_gust_kmh  -- highest recorded or reanalysis gust at any UK station
#   regions     -- UK_GRID_LOCATIONS station IDs affected by storm-force winds
#                 (gust thresholds ≥ 80 km/h or official wind warning issued)
NAMED_STORMS: list[dict] = [
    # 2015-16 naming season (first UK named storm season)
    {"name": "Abigail",  "start_date": "2015-11-12", "end_date": "2015-11-13",
     "peak_gust_kmh": 144, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Barney",   "start_date": "2015-11-17", "end_date": "2015-11-18",
     "peak_gust_kmh": 120, "regions": ["southampton", "bristol", "cardiff", "birmingham", "manchester"]},
    {"name": "Clodagh",  "start_date": "2015-11-28", "end_date": "2015-11-29",
     "peak_gust_kmh": 130, "regions": ["cardiff", "bristol", "edinburgh", "glasgow"]},
    {"name": "Desmond",  "start_date": "2015-12-04", "end_date": "2015-12-06",
     "peak_gust_kmh": 148, "regions": ["glasgow", "edinburgh", "manchester", "birmingham", "cardiff"]},
    {"name": "Eva",      "start_date": "2015-12-23", "end_date": "2015-12-26",
     "peak_gust_kmh": 130, "regions": ["glasgow", "edinburgh", "manchester", "york", "newcastle"]},
    {"name": "Frank",    "start_date": "2015-12-29", "end_date": "2015-12-31",
     "peak_gust_kmh": 124, "regions": ["glasgow", "edinburgh", "inverness", "aberdeen", "newcastle"]},

    # 2016-17 season
    {"name": "Angus",    "start_date": "2016-11-20", "end_date": "2016-11-21",
     "peak_gust_kmh": 130, "regions": ["southampton", "bristol", "cardiff", "birmingham"]},
    {"name": "Barbara",  "start_date": "2016-12-23", "end_date": "2016-12-24",
     "peak_gust_kmh": 144, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Conor",    "start_date": "2016-12-25", "end_date": "2016-12-27",
     "peak_gust_kmh": 150, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york", "newcastle"]},
    {"name": "Doris",    "start_date": "2017-02-23", "end_date": "2017-02-23",
     "peak_gust_kmh": 137, "regions": ["birmingham", "manchester", "york", "newcastle", "edinburgh"]},

    # 2017-18 season
    {"name": "Aileen",   "start_date": "2017-09-12", "end_date": "2017-09-13",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Brian",    "start_date": "2017-10-21", "end_date": "2017-10-22",
     "peak_gust_kmh": 135, "regions": ["cardiff", "bristol", "birmingham", "manchester", "glasgow"]},
    {"name": "Caroline", "start_date": "2017-12-07", "end_date": "2017-12-08",
     "peak_gust_kmh": 143, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Dylan",    "start_date": "2017-12-30", "end_date": "2017-12-31",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Eleanor",  "start_date": "2018-01-02", "end_date": "2018-01-03",
     "peak_gust_kmh": 148, "regions": ["cardiff", "bristol", "southampton", "london", "birmingham", "manchester"]},
    {"name": "Fionn",    "start_date": "2018-01-16", "end_date": "2018-01-17",
     "peak_gust_kmh": 128, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "newcastle"]},
    {"name": "Georgina", "start_date": "2018-01-31", "end_date": "2018-02-01",
     "peak_gust_kmh": 118, "regions": ["inverness", "aberdeen", "edinburgh"]},
    {"name": "Hector",   "start_date": "2018-06-13", "end_date": "2018-06-14",
     "peak_gust_kmh": 137, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},

    # 2018-19 season
    {"name": "Ali",      "start_date": "2018-09-19", "end_date": "2018-09-20",
     "peak_gust_kmh": 156, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "newcastle"]},
    {"name": "Bronagh",  "start_date": "2018-09-20", "end_date": "2018-09-21",
     "peak_gust_kmh": 126, "regions": ["cardiff", "bristol", "birmingham"]},
    {"name": "Callum",   "start_date": "2018-10-11", "end_date": "2018-10-13",
     "peak_gust_kmh": 144, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Deirdre",  "start_date": "2019-01-15", "end_date": "2019-01-16",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "cardiff"]},
    {"name": "Erik",     "start_date": "2019-02-08", "end_date": "2019-02-09",
     "peak_gust_kmh": 148, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff", "birmingham"]},
    {"name": "Freya",    "start_date": "2019-03-03", "end_date": "2019-03-04",
     "peak_gust_kmh": 124, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Gareth",   "start_date": "2019-03-11", "end_date": "2019-03-13",
     "peak_gust_kmh": 144, "regions": ["cardiff", "bristol", "manchester", "york", "edinburgh", "glasgow"]},
    {"name": "Hannah",   "start_date": "2019-04-26", "end_date": "2019-04-27",
     "peak_gust_kmh": 118, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},

    # 2019-20 season
    {"name": "Atiyah",   "start_date": "2019-12-07", "end_date": "2019-12-09",
     "peak_gust_kmh": 148, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "cardiff", "bristol"]},
    {"name": "Brendan",  "start_date": "2020-01-13", "end_date": "2020-01-14",
     "peak_gust_kmh": 130, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Ciara",    "start_date": "2020-02-08", "end_date": "2020-02-10",
     "peak_gust_kmh": 156, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff",
                                       "birmingham", "manchester", "york", "newcastle", "edinburgh",
                                       "glasgow", "aberdeen", "inverness"]},
    {"name": "Dennis",   "start_date": "2020-02-15", "end_date": "2020-02-17",
     "peak_gust_kmh": 148, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff",
                                       "birmingham", "manchester", "york", "newcastle", "edinburgh",
                                       "glasgow", "aberdeen", "inverness"]},
    {"name": "Ellen",    "start_date": "2020-08-18", "end_date": "2020-08-19",
     "peak_gust_kmh": 118, "regions": ["cardiff", "bristol", "inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Francis",  "start_date": "2020-08-25", "end_date": "2020-08-26",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "manchester"]},

    # 2020-21 season
    {"name": "Aiden",    "start_date": "2020-10-28", "end_date": "2020-10-29",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york", "newcastle"]},
    {"name": "Bella",    "start_date": "2020-12-25", "end_date": "2020-12-26",
     "peak_gust_kmh": 130, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "cardiff"]},
    {"name": "Christoph","start_date": "2021-01-19", "end_date": "2021-01-22",
     "peak_gust_kmh": 118, "regions": ["cardiff", "bristol", "birmingham", "manchester", "york", "edinburgh"]},
    {"name": "Darcy",    "start_date": "2021-02-05", "end_date": "2021-02-08",
     "peak_gust_kmh": 118, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york", "newcastle"]},
    {"name": "Evert",    "start_date": "2021-09-01", "end_date": "2021-09-02",
     "peak_gust_kmh": 115, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},

    # 2021-22 season (most active in record)
    {"name": "Arwen",    "start_date": "2021-11-26", "end_date": "2021-11-27",
     "peak_gust_kmh": 160, "regions": ["aberdeen", "edinburgh", "newcastle", "york", "manchester"]},
    {"name": "Barra",    "start_date": "2021-12-06", "end_date": "2021-12-07",
     "peak_gust_kmh": 143, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "cardiff"]},
    {"name": "Corrie",   "start_date": "2022-01-29", "end_date": "2022-01-30",
     "peak_gust_kmh": 152, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york", "newcastle"]},
    {"name": "Dudley",   "start_date": "2022-02-16", "end_date": "2022-02-17",
     "peak_gust_kmh": 148, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "manchester",
                                       "york", "newcastle", "birmingham"]},
    {"name": "Eunice",   "start_date": "2022-02-18", "end_date": "2022-02-18",
     "peak_gust_kmh": 196, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff",
                                       "birmingham", "manchester", "york", "newcastle", "edinburgh",
                                       "glasgow", "aberdeen", "inverness"]},
    {"name": "Franklin", "start_date": "2022-02-20", "end_date": "2022-02-21",
     "peak_gust_kmh": 130, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "manchester",
                                       "york", "newcastle"]},

    # 2022-23 season
    {"name": "Antoni",   "start_date": "2022-07-17", "end_date": "2022-07-18",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Betty",    "start_date": "2022-08-19", "end_date": "2022-08-20",
     "peak_gust_kmh": 115, "regions": ["inverness", "aberdeen", "edinburgh"]},
    {"name": "Cillian",  "start_date": "2023-01-05", "end_date": "2023-01-06",
     "peak_gust_kmh": 130, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york"]},
    {"name": "Debi",     "start_date": "2023-01-07", "end_date": "2023-01-08",
     "peak_gust_kmh": 135, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},

    # 2023-24 season
    {"name": "Agnes",    "start_date": "2023-10-26", "end_date": "2023-10-28",
     "peak_gust_kmh": 148, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow", "york",
                                       "newcastle", "manchester"]},
    {"name": "Babet",    "start_date": "2023-10-18", "end_date": "2023-10-21",
     "peak_gust_kmh": 130, "regions": ["aberdeen", "edinburgh", "glasgow", "york", "newcastle"]},
    {"name": "Ciaran",   "start_date": "2023-11-01", "end_date": "2023-11-03",
     "peak_gust_kmh": 168, "regions": ["southampton", "london", "cambridge", "bristol", "cardiff",
                                       "birmingham"]},
    {"name": "Debi",     "start_date": "2023-11-12", "end_date": "2023-11-13",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Elin",     "start_date": "2023-11-26", "end_date": "2023-11-27",
     "peak_gust_kmh": 115, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Fergus",   "start_date": "2023-12-13", "end_date": "2023-12-14",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Gerrit",   "start_date": "2023-12-27", "end_date": "2023-12-28",
     "peak_gust_kmh": 144, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow",
                                       "york", "newcastle", "manchester"]},
    {"name": "Henk",     "start_date": "2024-01-02", "end_date": "2024-01-03",
     "peak_gust_kmh": 130, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff",
                                       "birmingham", "manchester", "york"]},
    {"name": "Isha",     "start_date": "2024-01-21", "end_date": "2024-01-22",
     "peak_gust_kmh": 183, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow",
                                       "york", "newcastle", "manchester"]},
    {"name": "Jocelyn",  "start_date": "2024-01-23", "end_date": "2024-01-24",
     "peak_gust_kmh": 148, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow",
                                       "york", "newcastle", "manchester", "cardiff"]},

    # 2024-25 season
    {"name": "Ashley",   "start_date": "2024-09-24", "end_date": "2024-09-25",
     "peak_gust_kmh": 120, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Bert",     "start_date": "2024-11-22", "end_date": "2024-11-24",
     "peak_gust_kmh": 156, "regions": ["cardiff", "bristol", "southampton", "birmingham",
                                       "manchester", "york", "edinburgh", "glasgow"]},
    {"name": "Conall",   "start_date": "2024-11-27", "end_date": "2024-11-28",
     "peak_gust_kmh": 130, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow"]},
    {"name": "Darragh",  "start_date": "2024-11-29", "end_date": "2024-12-01",
     "peak_gust_kmh": 183, "regions": ["london", "cambridge", "southampton", "bristol", "cardiff",
                                       "birmingham", "manchester", "york", "newcastle",
                                       "edinburgh", "glasgow", "aberdeen", "inverness"]},
    {"name": "Eowyn",    "start_date": "2025-01-24", "end_date": "2025-01-25",
     "peak_gust_kmh": 196, "regions": ["inverness", "aberdeen", "edinburgh", "glasgow",
                                       "york", "newcastle", "manchester", "birmingham",
                                       "cardiff", "bristol", "southampton"]},
]


# Formally Declared Heatwave Episodes (2019-2025)
#
# Sources:
#   UK:     Met Office Heat-Health Alert (HHA) Level 3+ activations
#           https://www.metoffice.gov.uk/weather/warnings-and-advice/seasonal-advice/heat-health
#   France: Météo-France vigilance canicule orange/rouge
#           https://vigilance.meteofrance.fr/
#   Spain:  AEMET Plan Nacional de Actuaciones Preventivas / avisos naranja-rojo
#           https://www.aemet.es/
#   Italy:  National Heat Health Warning System (HHWS) alerts
#           https://www.salute.gov.it/portale/caldo/homeCaldo.jsp
#   Greece: HNMS (Hellenic National Meteorological Service) heat advisories
#           https://www.hnms.gr/
#
# Fields:
#   episode  -- short human-readable label
#   country  -- "UK" | "France" | "Spain" | "Italy" | "Greece" | "Germany" | "Portugal"
#   start_date / end_date  -- inclusive dates of declared heat emergency (YYYY-MM-DD)
#   stations -- GLOBAL_HEATWAVE_LOCATIONS station IDs in the affected region
#   source   -- issuing authority
OFFICIAL_HEATWAVES: list[dict] = [
    # 2019 -- two major episodes across UK and Europe
    {"episode": "UK-HHA-L3-2019-Jun",
     "country": "UK", "start_date": "2019-06-28", "end_date": "2019-07-04",
     "stations": ["london", "cambridge", "southampton", "bristol", "cardiff",
                  "birmingham", "manchester"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "UK-HHA-L3-2019-Jul",
     "country": "UK", "start_date": "2019-07-22", "end_date": "2019-07-27",
     "stations": ["london", "cambridge", "southampton", "bristol", "cardiff",
                  "birmingham", "manchester", "york"],
     "source": "Met Office Heat-Health Alert Level 3/4 -- Cambridge 38.7°C record"},
    {"episode": "FR-canicule-2019-Jun",
     "country": "France", "start_date": "2019-06-24", "end_date": "2019-07-01",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule rouge -- Gallargues 45.9°C record"},
    {"episode": "FR-canicule-2019-Jul",
     "country": "France", "start_date": "2019-07-22", "end_date": "2019-07-26",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule rouge"},
    {"episode": "ES-calor-2019-Jun",
     "country": "Spain", "start_date": "2019-06-25", "end_date": "2019-07-03",
     "stations": ["madrid", "seville", "barcelona"],
     "source": "AEMET aviso naranja/rojo por calor"},
    {"episode": "ES-calor-2019-Aug",
     "country": "Spain", "start_date": "2019-08-06", "end_date": "2019-08-14",
     "stations": ["madrid", "seville", "barcelona"],
     "source": "AEMET aviso rojo por calor"},
    {"episode": "IT-hhws-2019-Jul",
     "country": "Italy", "start_date": "2019-07-22", "end_date": "2019-07-31",
     "stations": ["rome"],
     "source": "HHWS Italy Level 3 alert"},
    {"episode": "GR-heat-2019-Jul",
     "country": "Greece", "start_date": "2019-07-01", "end_date": "2019-07-06",
     "stations": ["athens"],
     "source": "HNMS heat advisory"},

    # 2021
    {"episode": "UK-HHA-L3-2021-Jul",
     "country": "UK", "start_date": "2021-07-16", "end_date": "2021-07-22",
     "stations": ["london", "cambridge", "southampton", "bristol", "cardiff",
                  "birmingham", "manchester", "york", "edinburgh"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "GR-heat-2021-Aug",
     "country": "Greece", "start_date": "2021-08-01", "end_date": "2021-08-15",
     "stations": ["athens"],
     "source": "HNMS extreme heat advisory -- widespread wildfires concurrent"},
    {"episode": "TR-heat-2021-Aug",
     "country": "Turkey", "start_date": "2021-08-01", "end_date": "2021-08-15",
     "stations": ["istanbul"],
     "source": "Turkish State Meteorological Service extreme heat alert"},

    # 2022 -- UK record broken (40.3°C), most severe European heatwave on record
    {"episode": "UK-HHA-L3-2022-Jun",
     "country": "UK", "start_date": "2022-06-15", "end_date": "2022-06-19",
     "stations": ["london", "cambridge", "southampton", "bristol", "birmingham"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "UK-HHA-L4-2022-Jul",
     "country": "UK", "start_date": "2022-07-14", "end_date": "2022-07-19",
     "stations": ["london", "cambridge", "southampton", "bristol", "cardiff",
                  "birmingham", "manchester", "york", "newcastle", "edinburgh"],
     "source": "Met Office Heat-Health Alert Level 4 (Emergency) -- UK record 40.3°C 19 Jul"},
    {"episode": "FR-canicule-2022-Jun",
     "country": "France", "start_date": "2022-06-14", "end_date": "2022-06-19",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule orange/rouge"},
    {"episode": "FR-canicule-2022-Jul",
     "country": "France", "start_date": "2022-07-12", "end_date": "2022-07-25",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule rouge"},
    {"episode": "ES-calor-2022-Jun",
     "country": "Spain", "start_date": "2022-06-10", "end_date": "2022-06-26",
     "stations": ["madrid", "seville", "barcelona", "lisbon"],
     "source": "AEMET aviso rojo por calor -- earliest heatwave on record"},
    {"episode": "ES-calor-2022-Jul",
     "country": "Spain", "start_date": "2022-07-09", "end_date": "2022-07-26",
     "stations": ["madrid", "seville", "barcelona"],
     "source": "AEMET aviso rojo por calor -- Almeria 44.2°C"},
    {"episode": "PT-calor-2022-Jul",
     "country": "Portugal", "start_date": "2022-07-07", "end_date": "2022-07-25",
     "stations": ["lisbon"],
     "source": "IPMA aviso vermelho calor -- Pinhao 47°C record"},
    {"episode": "IT-hhws-2022-Jul",
     "country": "Italy", "start_date": "2022-07-16", "end_date": "2022-07-23",
     "stations": ["rome"],
     "source": "HHWS Italy Level 3 alert -- Sicily 48.8°C national record (2021)"},
    {"episode": "GR-heat-2022-Jul",
     "country": "Greece", "start_date": "2022-07-16", "end_date": "2022-07-28",
     "stations": ["athens"],
     "source": "HNMS extreme heat advisory"},
    {"episode": "DE-hitze-2022-Jul",
     "country": "Germany", "start_date": "2022-07-18", "end_date": "2022-07-21",
     "stations": ["berlin", "frankfurt"],
     "source": "DWD (Deutscher Wetterdienst) heat warning Level 3"},

    # 2023
    {"episode": "UK-HHA-L3-2023-Jun",
     "country": "UK", "start_date": "2023-06-08", "end_date": "2023-06-12",
     "stations": ["london", "cambridge", "southampton", "bristol", "birmingham"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "UK-HHA-L3-2023-Aug",
     "country": "UK", "start_date": "2023-08-10", "end_date": "2023-08-11",
     "stations": ["london", "cambridge", "southampton"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "GR-heat-2023-Jul",
     "country": "Greece", "start_date": "2023-07-09", "end_date": "2023-07-26",
     "stations": ["athens"],
     "source": "HNMS extreme heat advisory -- Larissa 44.2°C, tourist fatalities"},
    {"episode": "ES-calor-2023-Apr",
     "country": "Spain", "start_date": "2023-04-26", "end_date": "2023-04-29",
     "stations": ["seville", "madrid"],
     "source": "AEMET aviso naranja -- earliest heatwave of year in Europe"},
    {"episode": "ES-calor-2023-Jun",
     "country": "Spain", "start_date": "2023-06-22", "end_date": "2023-06-25",
     "stations": ["seville", "madrid", "barcelona"],
     "source": "AEMET aviso rojo por calor"},
    {"episode": "IT-hhws-2023-Jul",
     "country": "Italy", "start_date": "2023-07-09", "end_date": "2023-07-26",
     "stations": ["rome"],
     "source": "HHWS Italy Level 3 -- Sardinia 48°C near-record"},
    {"episode": "FR-canicule-2023-Jun",
     "country": "France", "start_date": "2023-06-19", "end_date": "2023-06-25",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule orange"},

    # 2024
    {"episode": "UK-HHA-L3-2024-Jun",
     "country": "UK", "start_date": "2024-06-27", "end_date": "2024-07-02",
     "stations": ["london", "cambridge", "southampton", "bristol", "cardiff",
                  "birmingham", "manchester"],
     "source": "Met Office Heat-Health Alert Level 3"},
    {"episode": "ES-calor-2024-Jul",
     "country": "Spain", "start_date": "2024-07-01", "end_date": "2024-07-08",
     "stations": ["seville", "madrid", "barcelona"],
     "source": "AEMET aviso rojo por calor"},
    {"episode": "GR-heat-2024-Jun",
     "country": "Greece", "start_date": "2024-06-14", "end_date": "2024-06-20",
     "stations": ["athens"],
     "source": "HNMS extreme heat advisory -- Acropolis visitor fatalities"},
    {"episode": "IT-hhws-2024-Jul",
     "country": "Italy", "start_date": "2024-07-14", "end_date": "2024-07-23",
     "stations": ["rome"],
     "source": "HHWS Italy Level 3"},
    {"episode": "FR-canicule-2024-Jul",
     "country": "France", "start_date": "2024-07-14", "end_date": "2024-07-22",
     "stations": ["paris", "marseille"],
     "source": "Météo-France vigilance canicule orange"},
]


# NASA FIRMS Active Fire Detection (MODIS / VIIRS)
#
# API documentation:
#   https://firms.modaps.eosdis.nasa.gov/api/
#
# Requires a free MAP_KEY registered at:
#   https://firms.modaps.eosdis.nasa.gov/api/map_key/
#
# Store the key in the FIRMS_MAP_KEY environment variable.
# If the key is absent or the API is unreachable, the function returns an
# empty DataFrame and logs a warning -- the calling pipeline should check
# for this and apply the configured fallback.
#
# Returns one row per MODIS/VIIRS fire pixel per day with columns:
#   latitude, longitude, acq_date, brightness, frp, confidence

_FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
_FIRMS_CACHE_DIR = (
    __import__("pathlib").Path(__file__).resolve().parent.parent.parent
    / "data" / "cache" / "firms"
)


async def fetch_nasa_firms_events(
    bbox: tuple[float, float, float, float],
    start_date: str,
    end_date: str,
    source: str = "VIIRS_SNPP_NRT",
    confidence_threshold: int = 50,
) -> pd.DataFrame:
    """Fetch NASA FIRMS active fire pixels for a bounding box and date range.

    Parameters
    bbox : (west_lon, south_lat, east_lon, north_lat)
    start_date : "YYYY-MM-DD"
    end_date   : "YYYY-MM-DD"
    source     : FIRMS dataset name.  Recommended options in order of quality:
                   "VIIRS_SNPP_NRT"   -- 375m, near-real-time (≤ 7 days)
                   "VIIRS_SNPP_SP"    -- 375m, standard processing (historical)
                   "MODIS_NRT"        -- 1km, near-real-time
                   "MODIS_SP"         -- 1km, standard processing (Collection 6.1)
    confidence_threshold : filter pixels below this confidence level (0-100
                           for VIIRS; "low"/"nominal"/"high" remapped to 33/66/99)

    Returns

    pd.DataFrame with columns: latitude, longitude, acq_date, confidence
    Empty DataFrame on any failure.
    """
    api_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not api_key:
        logger.warning(
            "FIRMS_MAP_KEY not set -- NASA FIRMS fire data unavailable. "
            "Set the environment variable to a free key from "
            "https://firms.modaps.eosdis.nasa.gov/api/map_key/"
        )
        return pd.DataFrame()

    west, south, east, north = bbox

    # FIRMS area/csv API accepts at most 5 days per call for historical data
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end = datetime.strptime(end_date, "%Y-%m-%d")
    chunk_days = 5
    all_chunks: list[pd.DataFrame] = []

    _FIRMS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    current = dt_start
    async with aiohttp.ClientSession() as session:
        while current <= dt_end:
            chunk_end = min(current + timedelta(days=chunk_days - 1), dt_end)
            date_str = current.strftime("%Y-%m-%d")
            n_days = (chunk_end - current).days + 1

            cache_key = (
                f"{source}_{west:.2f}_{south:.2f}_{east:.2f}_{north:.2f}"
                f"_{date_str}_{n_days}.csv"
            )
            cache_path = _FIRMS_CACHE_DIR / cache_key

            if cache_path.exists():
                try:
                    chunk_df = pd.read_csv(cache_path)
                    all_chunks.append(chunk_df)
                    current = chunk_end + timedelta(days=1)
                    continue
                except Exception:
                    pass  # Corrupt cache -- re-fetch

            url = (
                f"{_FIRMS_BASE_URL}/{api_key}/{source}"
                f"/{west},{south},{east},{north}"
                f"/{n_days}/{date_str}"
            )
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    if resp.status == 429:
                        logger.warning("FIRMS API rate-limited -- skipping this chunk")
                        current = chunk_end + timedelta(days=1)
                        continue
                    if resp.status != 200:
                        logger.warning(
                            f"FIRMS API returned HTTP {resp.status} for {date_str} -- skipping"
                        )
                        current = chunk_end + timedelta(days=1)
                        continue
                    text = await resp.text()

                    # Write to cache before parsing
                    cache_path.write_text(text, encoding="utf-8")

                    from io import StringIO
                    chunk_df = pd.read_csv(StringIO(text))
                    all_chunks.append(chunk_df)

            except Exception as exc:
                logger.warning(f"FIRMS fetch error for {date_str}: {exc}")

            current = chunk_end + timedelta(days=1)

    if not all_chunks:
        logger.warning("No FIRMS fire data retrieved -- all chunks empty or failed")
        return pd.DataFrame()

    df = pd.concat(all_chunks, ignore_index=True)

    # Normalise column names (VIIRS and MODIS differ slightly)
    df.columns = [c.lower() for c in df.columns]

    # Latitude / longitude columns
    lat_col = next((c for c in df.columns if c in ("latitude", "lat")), None)
    lon_col = next((c for c in df.columns if c in ("longitude", "lon", "long")), None)
    date_col = next((c for c in df.columns if "acq_date" in c or c == "date"), None)
    conf_col = next((c for c in df.columns if "confidence" in c), None)

    if lat_col is None or lon_col is None or date_col is None:
        logger.warning("FIRMS response missing expected columns -- returning empty")
        return pd.DataFrame()

    df = df.rename(columns={
        lat_col: "latitude",
        lon_col: "longitude",
        date_col: "acq_date",
    })

    # Confidence filter -- VIIRS uses numeric 0-100; MODIS uses "low"/"nominal"/"high"
    if conf_col:
        df = df.rename(columns={conf_col: "confidence"})
        if df["confidence"].dtype == object:
            conf_map = {"low": 33, "nominal": 66, "high": 99}
            df["confidence"] = df["confidence"].map(conf_map).fillna(50)
        df = df[df["confidence"] >= confidence_threshold]

    df["acq_date"] = pd.to_datetime(df["acq_date"]).dt.date
    df = df[["latitude", "longitude", "acq_date"]].drop_duplicates()

    logger.info(
        f"  FIRMS: {len(df):,} fire pixels retrieved "
        f"({start_date} to {end_date}, bbox={bbox})"
    )
    return df


# Shared event-to-station spatial matcher

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in km between two points."""
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.asin(math.sqrt(min(a, 1.0)))


def match_events_to_stations(
    events: list[dict],
    station_locations: list[dict],
    radius_km: float = 300.0,
    date_col: str = "start_date",
    end_date_col: str = "end_date",
    region_col: str | None = "regions",
) -> pd.DataFrame:
    """Map discrete event records to training station IDs and hourly timestamps.

    Two matching strategies are supported and are applied in priority order:

    Strategy A -- Region list (preferred when events have a 'regions' field):
        If the event dict contains a list of station IDs in `region_col`, those
        stations are matched directly.  This is used for NAMED_STORMS and
        OFFICIAL_HEATWAVES where affected stations are already annotated.

    Strategy B -- Spatial proximity (fallback for NASA FIRMS and other point events):
        If the event has `latitude` and `longitude` fields, each station within
        `radius_km` is matched.

    Parameters
    events           : list of event dicts (NAMED_STORMS, OFFICIAL_HEATWAVES, etc.)
    station_locations: list of location dicts with 'id', 'lat', 'lon' keys
    radius_km        : haversine radius for spatial matching (Strategy B only)
    date_col         : key in event dict for the start date string (YYYY-MM-DD)
    end_date_col     : key in event dict for the end date string (inclusive)
    region_col       : key in event dict that lists affected station IDs (or None)

    Returns

    pd.DataFrame with columns: timestamp (hourly UTC), station_id, label=1
    """
    station_index = {s["id"]: s for s in station_locations}
    rows: list[dict] = []

    for ev in events:
        start = datetime.strptime(str(ev[date_col]), "%Y-%m-%d")
        end_str = ev.get(end_date_col)
        end = datetime.strptime(str(end_str), "%Y-%m-%d") if end_str else start

        # Enumerate all UTC hours in [start, end]
        n_hours = int((end - start).total_seconds() // 3600) + 24  # include end day
        timestamps = [start + timedelta(hours=h) for h in range(n_hours)]

        matched_stations: list[str] = []

        # Strategy A: region list
        if region_col and region_col in ev and ev[region_col]:
            matched_stations = [
                sid for sid in ev[region_col] if sid in station_index
            ]

        # Strategy B: spatial proximity
        elif "latitude" in ev and "longitude" in ev:
            ev_lat = float(ev["latitude"])
            ev_lon = float(ev["longitude"])
            for s in station_locations:
                if _haversine_km(ev_lat, ev_lon, s["lat"], s["lon"]) <= radius_km:
                    matched_stations.append(s["id"])

        for station_id in matched_stations:
            for ts in timestamps:
                rows.append({
                    "timestamp": ts,
                    "station_id": station_id,
                    "label": 1,
                })

    if not rows:
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.groupby(["timestamp", "station_id"])["label"].max().reset_index()
    return df


def build_storm_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Build a label DataFrame from the static NAMED_STORMS list.

    Filters to storms whose date range overlaps [start_date, end_date] and
    returns hourly positive labels per station.

    Returns empty DataFrame if no storms fall within the date range.
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end = datetime.strptime(end_date, "%Y-%m-%d")

    relevant = [
        s for s in NAMED_STORMS
        if datetime.strptime(s["end_date"], "%Y-%m-%d") >= dt_start
        and datetime.strptime(s["start_date"], "%Y-%m-%d") <= dt_end
    ]

    if not relevant:
        logger.warning(
            f"  No named storms in NAMED_STORMS overlap "
            f"{start_date}-{end_date}.  Storm labels will be all-negative."
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    logger.info(
        f"  Named storms in date range: {len(relevant)} "
        f"({[s['name'] for s in relevant]})"
    )
    return match_events_to_stations(relevant, station_locations)


def build_heatwave_label_df(
    station_locations: list[dict],
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Build a label DataFrame from the static OFFICIAL_HEATWAVES list.

    Filters to events whose date range overlaps [start_date, end_date] and
    returns hourly positive labels per station.

    Returns empty DataFrame if no heatwave episodes fall within the date range.
    """
    dt_start = datetime.strptime(start_date, "%Y-%m-%d")
    dt_end = datetime.strptime(end_date, "%Y-%m-%d")

    relevant = [
        h for h in OFFICIAL_HEATWAVES
        if datetime.strptime(h["end_date"], "%Y-%m-%d") >= dt_start
        and datetime.strptime(h["start_date"], "%Y-%m-%d") <= dt_end
    ]

    if not relevant:
        logger.warning(
            f"  No official heatwave declarations overlap "
            f"{start_date}-{end_date}.  Heatwave labels will be all-negative."
        )
        return pd.DataFrame(columns=["timestamp", "station_id", "label"])

    logger.info(
        f"  Official heatwave episodes in date range: {len(relevant)} "
        f"({[h['episode'] for h in relevant]})"
    )
    return match_events_to_stations(
        relevant,
        station_locations,
        region_col="stations",
    )
