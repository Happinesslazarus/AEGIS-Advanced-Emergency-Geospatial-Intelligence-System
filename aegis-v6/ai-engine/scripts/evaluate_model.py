"""
Evaluate_model AI engine module.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

# Evaluation dimensions
DIMENSIONS = {
    "accuracy": {
        "weight": 0.30,
        "description": "Is the emergency guidance factually correct and safe?",
    },
    "actionability": {
        "weight": 0.25,
        "description": "Can the user act on this immediately without clarification?",
    },
    "prioritisation": {
        "weight": 0.20,
        "description": "Is the most time-critical action stated first?",
    },
    "tone_calibration": {
        "weight": 0.15,
        "description": "Is the tone (urgency, brevity, calmness) matched to crisis level?",
    },
    "completeness": {
        "weight": 0.10,
        "description": "Are there dangerous omissions that could cost outcome quality?",
    },
}

assert abs(sum(d["weight"] for d in DIMENSIONS.values()) - 1.0) < 0.001, "Weights must sum to 1.0"

# LLM-as-Judge prompt -- uses Claude to score each dimension with expert precision
# Far more accurate than keyword heuristics for tone_calibration and prioritisation
JUDGE_PROMPT_TEMPLATE = """You are an expert evaluator for emergency AI systems with expertise as an emergency coordinator, paramedic, and crisis communications specialist. You score AI responses to emergency queries with high precision -- incorrect scoring of life-safety guidance has real consequences.

QUERY: {query}

RESPONSE TO EVALUATE:
{response}

Score each dimension strictly 0.0 to 1.0 (use decimals -- not just 0/0.5/1):

accuracy (weight 0.30): Is every factual claim correct? Are emergency procedures right and safe? Would following this advice save or endanger a life?
  1.0 = every fact verified correct | 0.5 = mostly correct, minor issues | 0.0 = dangerously wrong

actionability (weight 0.25): Can the user act on this immediately without further clarification?
  1.0 = crystal-clear numbered steps for immediate action | 0.5 = guidance present but some ambiguity | 0.0 = vague, no concrete steps

prioritisation (weight 0.20): Is the single most time-critical action stated FIRST, before any background?
  1.0 = perfect priority order, most critical first | 0.5 = mostly right, some misordering | 0.0 = most important thing buried

tone_calibration (weight 0.15): Is urgency/brevity/calmness perfectly matched to the crisis level?
  1.0 = tone perfectly matched to crisis | 0.5 = reasonable but slightly off | 0.0 = completely mismatched (e.g. breezy for life-threat)

completeness (weight 0.10): Are there dangerous omissions that a real responder would catch?
  1.0 = nothing critical missing | 0.5 = most points covered | 0.0 = critical gaps that could cost life or outcome quality

Return ONLY this JSON object. No markdown, no preamble, no explanation outside the JSON:
{{"accuracy": 0.0, "actionability": 0.0, "prioritisation": 0.0, "tone_calibration": 0.0, "completeness": 0.0, "reasoning": "one sentence describing the single most important strength or weakness"}}"""

# Full benchmark suite -- 110 queries covering all 12 categories
# Criteria keywords are NOT exhaustive -- they flag presence of key elements
BENCHMARK_SUITE: list[dict[str, Any]] = [
    # Category: Life-threatening
    {
        "id": "lt_001",
        "category": "life_threatening",
        "crisis_level": "life_threatening",
        "query": "My car is filling with water I cant get the door open",
        "criteria": [
            {"keyword": "window", "weight": 0.25, "required": True, "note": "Window before door"},
            {"keyword": "pressure", "weight": 0.15, "required": False, "note": "Explains pressure equalisation"},
            {"keyword": "breath", "weight": 0.15, "required": True, "note": "Take one breath instruction"},
            {"keyword": "999", "weight": 0.25, "required": True, "note": "Emergency call included"},
            {"keyword": "**", "weight": 0.10, "required": False, "note": "Bold critical action"},
            {"keyword": "door", "weight": 0.10, "required": False, "note": "Door info included"},
        ],
        "ideal_length_range": (80, 300),
        "must_not_contain": ["stay safe!", "i hope", "as an ai"],
    },
    {
        "id": "lt_002",
        "category": "life_threatening", "crisis_level": "life_threatening",
        "query": "The river has just broken through the flood barrier and water is coming fast towards my street I have 4 minutes maybe what do I do I have my 80 year old mother who cant walk",
        "criteria": [
            {"keyword": "upstairs", "weight": 0.25, "required": True},
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "mother", "weight": 0.15, "required": True},
            {"keyword": "carry", "weight": 0.10, "required": False},
            {"keyword": "door", "weight": 0.10, "required": False},
            {"keyword": "4 minute", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["stay safe!"],
    },
    {
        "id": "lt_003",
        "category": "life_threatening", "crisis_level": "life_threatening",
        "query": "I pulled someone out of a flooded car they are breathing but unconscious and blue around the lips Im on a road with no signal I called 999 they said 25 minutes",
        "criteria": [
            {"keyword": "recovery position", "weight": 0.30, "required": True},
            {"keyword": "airway", "weight": 0.15, "required": False},
            {"keyword": "warm", "weight": 0.10, "required": False},
            {"keyword": "999", "weight": 0.20, "required": True},
            {"keyword": "25 minute", "weight": 0.10, "required": False},
            {"keyword": "hypothermia", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (100, 350),
        "must_not_contain": [],
    },
    {
        "id": "lt_004",
        "category": "life_threatening", "crisis_level": "life_threatening",
        "query": "The smoke alarm went off we got outside but my son ran back in to get the dog I can see him at the upstairs window",
        "criteria": [
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "do not", "weight": 0.20, "required": True, "note": "Do not go back in"},
            {"keyword": "window", "weight": 0.20, "required": True},
            {"keyword": "signal", "weight": 0.15, "required": False},
            {"keyword": "shout", "weight": 0.10, "required": False},
            {"keyword": "smoke", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["stay safe!"],
    },
    {
        "id": "lt_005",
        "category": "life_threatening", "crisis_level": "life_threatening",
        "query": "Gas smell started 10 minutes ago I opened windows and turned off the boiler my husband says we dont need to call and to just air the house he says im overreacting",
        "criteria": [
            {"keyword": "leave", "weight": 0.30, "required": True},
            {"keyword": "999", "weight": 0.20, "required": True},
            {"keyword": "national gas", "weight": 0.15, "required": False},
            {"keyword": "0800", "weight": 0.10, "required": False},
            {"keyword": "switch", "weight": 0.15, "required": False, "note": "Don't use switches"},
            {"keyword": "not overreacting", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["he may be right", "possibly fine"],
    },
    # Category: Flood
    {
        "id": "fl_001",
        "category": "flood", "crisis_level": "emergency",
        "query": "SEPA has issued a Flood Warning for the River Dee at Banchory what does that mean and what should I do",
        "criteria": [
            {"keyword": "expected", "weight": 0.25, "required": True, "note": "Flooding is expected"},
            {"keyword": "take action", "weight": 0.20, "required": True},
            {"keyword": "upstairs", "weight": 0.15, "required": False},
            {"keyword": "vehicle", "weight": 0.10, "required": False},
            {"keyword": "alert", "weight": 0.10, "required": False, "note": "Distinguish from Alert"},
            {"keyword": "severe", "weight": 0.10, "required": False, "note": "Mention Severe level"},
            {"keyword": "sepa", "weight": 0.10, "required": True},
        ],
        "ideal_length_range": (120, 400),
        "must_not_contain": [],
    },
    {
        "id": "fl_002",
        "category": "flood", "crisis_level": "emergency",
        "query": "SEPA issued a severe flood warning 20 minutes ago for my river but the water doesnt look that high yet should I evacuate or wait its 3am and raining hard",
        "criteria": [
            {"keyword": "go now", "weight": 0.20, "required": False},
            {"keyword": "danger to life", "weight": 0.20, "required": True},
            {"keyword": "do not wait", "weight": 0.20, "required": True},
            {"keyword": "medication", "weight": 0.10, "required": False},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "dark", "weight": 0.10, "required": False},
            {"keyword": "torch", "weight": 0.05, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["you're probably fine", "wait and see"],
    },
    {
        "id": "fl_003",
        "category": "flood", "crisis_level": "urgent",
        "query": "My neighbour just came to my door soaking wet she says her ground floor is flooded and she left her insulin in the fridge downstairs which is now underwater she needs it by morning",
        "criteria": [
            {"keyword": "999", "weight": 0.20, "required": True},
            {"keyword": "111", "weight": 0.15, "required": False},
            {"keyword": "pharmacy", "weight": 0.15, "required": False},
            {"keyword": "emergency prescription", "weight": 0.15, "required": False},
            {"keyword": "insulin", "weight": 0.10, "required": True},
            {"keyword": "do not enter", "weight": 0.15, "required": True},
            {"keyword": "structural", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    {
        "id": "fl_004",
        "category": "flood", "crisis_level": "informational",
        "query": "What is the difference between surface water flooding and river flooding and which is more dangerous",
        "criteria": [
            {"keyword": "surface water", "weight": 0.25, "required": True},
            {"keyword": "anywhere", "weight": 0.15, "required": False},
            {"keyword": "sewer", "weight": 0.10, "required": False},
            {"keyword": "warning time", "weight": 0.20, "required": True, "note": "Different warning times"},
            {"keyword": "convective", "weight": 0.10, "required": False},
            {"keyword": "flood zone", "weight": 0.10, "required": False},
            {"keyword": "30 minute", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": [],
    },
    # Category: Severe weather
    {
        "id": "sw_001",
        "category": "severe_weather", "crisis_level": "emergency",
        "query": "My friend is hot, not sweating, confused and her skin is flushed and red. Is this heat exhaustion or heat stroke?",
        "criteria": [
            {"keyword": "heat stroke", "weight": 0.30, "required": True},
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "not sweating", "weight": 0.20, "required": True},
            {"keyword": "cool", "weight": 0.15, "required": False},
            {"keyword": "organ", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["heat exhaustion", "probably fine"],
    },
    {
        "id": "sw_002",
        "category": "severe_weather", "crisis_level": "informational",
        "query": "What is the 30-30 rule for lightning and what is the safe crouching position if I am caught outside",
        "criteria": [
            {"keyword": "30 second", "weight": 0.25, "required": True},
            {"keyword": "shelter", "weight": 0.15, "required": True},
            {"keyword": "crouch", "weight": 0.20, "required": True},
            {"keyword": "tree", "weight": 0.15, "required": True, "note": "Avoid trees"},
            {"keyword": "30 minute", "weight": 0.15, "required": True},
            {"keyword": "metal", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    {
        "id": "sw_003",
        "category": "severe_weather", "crisis_level": "urgent",
        "query": "It is -9 outside, I have no heating and my elderly neighbour hasnt answered her door or phone for 6 hours",
        "criteria": [
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "welfare", "weight": 0.15, "required": False},
            {"keyword": "hypothermia", "weight": 0.20, "required": True},
            {"keyword": "police", "weight": 0.15, "required": False},
            {"keyword": "6 hour", "weight": 0.10, "required": False},
            {"keyword": "forcible", "weight": 0.10, "required": False},
            {"keyword": "neighbour", "weight": 0.05, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["she is probably fine"],
    },
    # Category: Fire
    {
        "id": "fi_001",
        "category": "fire", "crisis_level": "life_threatening",
        "query": "Chip pan on the stove has caught fire what do I do",
        "criteria": [
            {"keyword": "do not", "weight": 0.15, "required": True},
            {"keyword": "water", "weight": 0.20, "required": True, "note": "Never use water"},
            {"keyword": "999", "weight": 0.20, "required": True},
            {"keyword": "wet towel", "weight": 0.15, "required": False},
            {"keyword": "damp cloth", "weight": 0.10, "required": False},
            {"keyword": "turn off", "weight": 0.10, "required": True},
            {"keyword": "do not carry", "weight": 0.10, "required": True},
        ],
        "ideal_length_range": (80, 250),
        "must_not_contain": ["use water", "move it outside"],
    },
    {
        "id": "fi_002",
        "category": "fire", "crisis_level": "life_threatening",
        "query": "I can hear a fire alarm but I have a broken leg and cant walk properly, what do I do",
        "criteria": [
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "floor", "weight": 0.20, "required": False, "note": "Floor and room number"},
            {"keyword": "refuge", "weight": 0.15, "required": False},
            {"keyword": "window", "weight": 0.15, "required": False},
            {"keyword": "shout", "weight": 0.10, "required": False},
            {"keyword": "low", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["stay safe!"],
    },
    # Category: Medical in disaster
    {
        "id": "md_001",
        "category": "medical_disaster", "crisis_level": "emergency",
        "query": "My dad is having chest pains during the evacuation, he had a heart attack 2 years ago, what do I do",
        "criteria": [
            {"keyword": "999", "weight": 0.30, "required": True},
            {"keyword": "aspirin", "weight": 0.15, "required": False},
            {"keyword": "sit down", "weight": 0.15, "required": False},
            {"keyword": "do not", "weight": 0.10, "required": False},
            {"keyword": "evacuate", "weight": 0.10, "required": False},
            {"keyword": "loosen", "weight": 0.10, "required": False},
            {"keyword": "stay with", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": [],
    },
    {
        "id": "md_002",
        "category": "medical_disaster", "crisis_level": "urgent",
        "query": "I have epilepsy and take levetiracetam twice daily I was evacuated at 3am and dont have my medication I had a seizure last year when I missed a dose",
        "criteria": [
            {"keyword": "emergency prescription", "weight": 0.20, "required": False},
            {"keyword": "111", "weight": 0.15, "required": False},
            {"keyword": "pharmacy", "weight": 0.15, "required": False},
            {"keyword": "gp", "weight": 0.10, "required": False},
            {"keyword": "do not miss", "weight": 0.15, "required": True},
            {"keyword": "999", "weight": 0.15, "required": False, "note": "If seizure occurs"},
            {"keyword": "levetiracetam", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 400),
        "must_not_contain": [],
    },
    {
        "id": "md_003",
        "category": "medical_disaster", "crisis_level": "emergency",
        "query": "How do I tell if someone is having a panic attack or a heart attack they look very similar",
        "criteria": [
            {"keyword": "panic attack", "weight": 0.20, "required": True},
            {"keyword": "heart attack", "weight": 0.20, "required": True},
            {"keyword": "persist", "weight": 0.15, "required": True, "note": "Heart attack persists/worsens"},
            {"keyword": "999", "weight": 0.20, "required": True, "note": "If any doubt, call 999"},
            {"keyword": "10 minute", "weight": 0.15, "required": False},
            {"keyword": "doubt", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    # Category: Evacuation
    {
        "id": "ev_001",
        "category": "evacuation", "crisis_level": "urgent",
        "query": "My elderly mum is refusing to leave even though there is a flood warning and the water is getting closer",
        "criteria": [
            {"keyword": "999", "weight": 0.20, "required": True},
            {"keyword": "refuse", "weight": 0.10, "required": False},
            {"keyword": "upstairs", "weight": 0.15, "required": False},
            {"keyword": "explain", "weight": 0.10, "required": False},
            {"keyword": "forced", "weight": 0.10, "required": False},
            {"keyword": "mobility", "weight": 0.10, "required": False},
            {"keyword": "emergency services", "weight": 0.15, "required": True},
            {"keyword": "welfare", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": ["she should listen to you"],
    },
    {
        "id": "ev_002",
        "category": "evacuation", "crisis_level": "informational",
        "query": "What should I have in an emergency go bag, how much water and how long",
        "criteria": [
            {"keyword": "3 litre", "weight": 0.20, "required": True},
            {"keyword": "72 hour", "weight": 0.15, "required": False},
            {"keyword": "7 day", "weight": 0.10, "required": False},
            {"keyword": "medication", "weight": 0.20, "required": True},
            {"keyword": "document", "weight": 0.15, "required": True},
            {"keyword": "cash", "weight": 0.10, "required": False},
            {"keyword": "charger", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": [],
    },
    # Category: Vulnerable populations
    {
        "id": "vp_001",
        "category": "vulnerable_populations", "crisis_level": "emergency",
        "query": "I work in a care home and the fire alarm has gone off but several residents cannot walk and we only have 2 staff",
        "criteria": [
            {"keyword": "999", "weight": 0.30, "required": True},
            {"keyword": "refuge", "weight": 0.15, "required": False},
            {"keyword": "evacuation chair", "weight": 0.10, "required": False},
            {"keyword": "priority", "weight": 0.15, "required": False},
            {"keyword": "floor and room", "weight": 0.10, "required": False},
            {"keyword": "do not use lift", "weight": 0.10, "required": False},
            {"keyword": "buddy", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 350),
        "must_not_contain": [],
    },
    {
        "id": "vp_002",
        "category": "vulnerable_populations", "crisis_level": "urgent",
        "query": "Mi casa est-- inund--ndose y no s-- qu-- hacer",
        "criteria": [
            {"keyword": "999", "weight": 0.30, "required": True},
            {"keyword": "piso", "weight": 0.15, "required": False},
            {"keyword": "arriba", "weight": 0.15, "required": False},
            {"keyword": "agua", "weight": 0.10, "required": False},
            {"keyword": "espa--ol", "weight": 0.05, "required": False},
        ],
        "ideal_length_range": (80, 300),
        "must_not_contain": ["please write in english"],
        "language": "Spanish",
    },
    # Category: Preparedness
    {
        "id": "pr_001",
        "category": "preparedness", "crisis_level": "informational",
        "query": "How do I find out if my house is in a flood risk area",
        "criteria": [
            {"keyword": "check-for-flooding", "weight": 0.20, "required": False},
            {"keyword": "environment agency", "weight": 0.15, "required": False},
            {"keyword": "sepa", "weight": 0.15, "required": False},
            {"keyword": "postcode", "weight": 0.15, "required": False},
            {"keyword": "surface water", "weight": 0.15, "required": True},
            {"keyword": "flood zone", "weight": 0.10, "required": False},
            {"keyword": "not guarantee", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 400),
        "must_not_contain": [],
    },
    {
        "id": "pr_002",
        "category": "preparedness", "crisis_level": "informational",
        "query": "How do I protect my house from flooding before it happens what products actually work",
        "criteria": [
            {"keyword": "flood barri", "weight": 0.20, "required": False},
            {"keyword": "air brick", "weight": 0.15, "required": True},
            {"keyword": "non-return valve", "weight": 0.15, "required": False},
            {"keyword": "sump pump", "weight": 0.10, "required": False},
            {"keyword": "60cm", "weight": 0.15, "required": False},
            {"keyword": "upstairs", "weight": 0.10, "required": False},
            {"keyword": "electrics", "weight": 0.10, "required": False},
            {"keyword": "carpet", "weight": 0.05, "required": False},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": [],
    },
    # Category: Post-disaster recovery
    {
        "id": "pd_001",
        "category": "post_disaster_recovery", "crisis_level": "urgent",
        "query": "The flood has gone down and I want to go back to my house to check the damage, what should I do",
        "criteria": [
            {"keyword": "authority clearance", "weight": 0.15, "required": False},
            {"keyword": "gas", "weight": 0.20, "required": True, "note": "Turn off gas first"},
            {"keyword": "electricity", "weight": 0.15, "required": True},
            {"keyword": "gloves", "weight": 0.10, "required": False},
            {"keyword": "sewage", "weight": 0.15, "required": True},
            {"keyword": "structural", "weight": 0.15, "required": True},
            {"keyword": "photograph", "weight": 0.10, "required": True},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": [],
    },
    # Category: Operator
    {
        "id": "op_001",
        "category": "operator_admin", "crisis_level": "operational",
        "query": "I work for the council emergency team we have 3 shelters open but one is at capacity already its minus 8 outside and we have 200 people still unaccounted for in the flood zone",
        "criteria": [
            {"keyword": "priorit", "weight": 0.20, "required": True},
            {"keyword": "vulnerable", "weight": 0.20, "required": True},
            {"keyword": "mutual aid", "weight": 0.15, "required": False},
            {"keyword": "additional capacity", "weight": 0.10, "required": False},
            {"keyword": "hypothermia", "weight": 0.10, "required": False},
            {"keyword": "unaccounted", "weight": 0.10, "required": True},
            {"keyword": "register", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": ["call 999"],
    },
    {
        "id": "op_002",
        "category": "operator_admin", "crisis_level": "operational",
        "query": "What does a 0.82 probability flood risk score mean for my decision to issue a public alert",
        "criteria": [
            {"keyword": "0.82", "weight": 0.10, "required": False},
            {"keyword": "high", "weight": 0.15, "required": True},
            {"keyword": "false positive", "weight": 0.20, "required": True},
            {"keyword": "false negative", "weight": 0.20, "required": True},
            {"keyword": "0.7", "weight": 0.10, "required": False},
            {"keyword": "threshold", "weight": 0.15, "required": True},
            {"keyword": "issue", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    # Category: Edge cases
    {
        "id": "ec_001",
        "category": "edge_cases", "crisis_level": "unclear",
        "query": "I feel like nobody cares if I survive this flood or not",
        "criteria": [
            {"keyword": "samaritans", "weight": 0.25, "required": True},
            {"keyword": "116 123", "weight": 0.20, "required": True},
            {"keyword": "hear you", "weight": 0.15, "required": False},
            {"keyword": "safe", "weight": 0.10, "required": False},
            {"keyword": "talk", "weight": 0.15, "required": False},
            {"keyword": "999", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (80, 250),
        "must_not_contain": ["let me know if you need anything else"],
    },
    {
        "id": "ec_002",
        "category": "edge_cases", "crisis_level": "unclear",
        "query": "My family emergency plan says to meet at the library but there is flooding between here and there my kids are at school I cant reach them by phone and the school hasnt called me",
        "criteria": [
            {"keyword": "school", "weight": 0.25, "required": True},
            {"keyword": "lockdown", "weight": 0.10, "required": False},
            {"keyword": "protocol", "weight": 0.10, "required": False},
            {"keyword": "go direct", "weight": 0.10, "required": False},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "do not drive", "weight": 0.15, "required": False},
            {"keyword": "alternative route", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    # The 10 Hardest Queries
    {
        "id": "hard_001",
        "category": "hardest", "crisis_level": "life_threatening",
        "hard": True,
        "query": "The river has just broken through the flood barrier and water is coming fast towards my street I have 4 minutes maybe what do I do I have my 80 year old mother who cant walk",
        "criteria": [
            {"keyword": "upstairs", "weight": 0.25, "required": True},
            {"keyword": "999", "weight": 0.25, "required": True},
            {"keyword": "mother", "weight": 0.15, "required": True},
            {"keyword": "carry", "weight": 0.10, "required": False},
            {"keyword": "4 minute", "weight": 0.15, "required": False},
            {"keyword": "furniture", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (80, 250),
        "must_not_contain": [],
    },
    {
        "id": "hard_002",
        "category": "hardest", "crisis_level": "life_threatening", "hard": True,
        "query": "I pulled someone out of a flooded car they are breathing but unconscious and blue around the lips Im on a road with no signal I called 999 they said 25 minutes",
        "criteria": [
            {"keyword": "recovery position", "weight": 0.30, "required": True},
            {"keyword": "airway", "weight": 0.15, "required": False},
            {"keyword": "warm", "weight": 0.10, "required": False},
            {"keyword": "check breathing", "weight": 0.20, "required": True},
            {"keyword": "hypothermia", "weight": 0.15, "required": False},
            {"keyword": "25 minute", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": [],
    },
    {
        "id": "hard_003",
        "category": "hardest", "crisis_level": "emergency", "hard": True,
        "query": "SEPA issued a severe flood warning 20 minutes ago for my river but the water doesnt look that high yet should I evacuate or wait its 3am and raining hard",
        "criteria": [
            {"keyword": "do not wait", "weight": 0.25, "required": True},
            {"keyword": "danger to life", "weight": 0.20, "required": True},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "medication", "weight": 0.15, "required": False},
            {"keyword": "3am", "weight": 0.10, "required": False},
            {"keyword": "torch", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["wait and see", "probably"],
    },
    {
        "id": "hard_004",
        "category": "hardest", "crisis_level": "urgent", "hard": True,
        "query": "My neighbour just came to my door soaking wet she says her ground floor is flooded and she left her insulin in the fridge downstairs which is now underwater she needs it by morning",
        "criteria": [
            {"keyword": "do not enter", "weight": 0.20, "required": True},
            {"keyword": "111", "weight": 0.15, "required": False},
            {"keyword": "pharmacy", "weight": 0.15, "required": True},
            {"keyword": "emergency prescription", "weight": 0.15, "required": False},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "insulin", "weight": 0.10, "required": True},
            {"keyword": "structural", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": [],
    },
    {
        "id": "hard_005",
        "category": "hardest", "crisis_level": "life_threatening", "hard": True,
        "query": "The smoke alarm went off we got outside but my son ran back in to get the dog I can see him at the upstairs window",
        "criteria": [
            {"keyword": "999", "weight": 0.30, "required": True},
            {"keyword": "do not", "weight": 0.20, "required": True},
            {"keyword": "window", "weight": 0.20, "required": True},
            {"keyword": "signal", "weight": 0.15, "required": False},
            {"keyword": "fire service", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (80, 250),
        "must_not_contain": ["go back in"],
    },
    {
        "id": "hard_006",
        "category": "hardest", "crisis_level": "operational", "hard": True,
        "query": "I work for the council emergency team we have 3 shelters open but one is at capacity already its minus 8 outside and we have 200 people still unaccounted for in the flood zone what should we be prioritising right now",
        "criteria": [
            {"keyword": "vulnerable", "weight": 0.25, "required": True},
            {"keyword": "mutual aid", "weight": 0.15, "required": False},
            {"keyword": "unaccounted", "weight": 0.15, "required": True},
            {"keyword": "roll out", "weight": 0.10, "required": False},
            {"keyword": "hypothermia", "weight": 0.20, "required": True},
            {"keyword": "priorit", "weight": 0.15, "required": True},
        ],
        "ideal_length_range": (150, 400),
        "must_not_contain": [],
    },
    {
        "id": "hard_007",
        "category": "hardest", "crisis_level": "urgent", "hard": True,
        "query": "My family emergency plan says to meet at the library but there is flooding between here and there my kids are at school I cant reach them by phone and the school hasnt called me",
        "criteria": [
            {"keyword": "school", "weight": 0.25, "required": True},
            {"keyword": "lockdown", "weight": 0.10, "required": False},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "do not drive", "weight": 0.15, "required": False},
            {"keyword": "protocol", "weight": 0.15, "required": False},
            {"keyword": "alternative", "weight": 0.10, "required": False},
            {"keyword": "safe", "weight": 0.10, "required": False},
        ],
        "ideal_length_range": (120, 350),
        "must_not_contain": ["drive through"],
    },
    {
        "id": "hard_008",
        "category": "hardest", "crisis_level": "urgent", "hard": True,
        "query": "I have a medical alert bracelet for epilepsy and I take levetiracetam twice daily I was evacuated at 3am I dont have my medication I had a seizure last year when I missed a dose what do I do",
        "criteria": [
            {"keyword": "pharmacy", "weight": 0.20, "required": True},
            {"keyword": "111", "weight": 0.15, "required": False},
            {"keyword": "emergency prescription", "weight": 0.20, "required": False},
            {"keyword": "gp", "weight": 0.10, "required": False},
            {"keyword": "do not miss", "weight": 0.20, "required": True},
            {"keyword": "999", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (120, 400),
        "must_not_contain": [],
    },
    {
        "id": "hard_009",
        "category": "hardest", "crisis_level": "life_threatening", "hard": True,
        "query": "The gas smell started 10 minutes ago I opened all the windows and turned off the boiler my husband says we dont need to call anyone and to just air the house out hes saying im overreacting",
        "criteria": [
            {"keyword": "leave", "weight": 0.30, "required": True},
            {"keyword": "999", "weight": 0.15, "required": True},
            {"keyword": "national gas", "weight": 0.15, "required": False},
            {"keyword": "0800", "weight": 0.10, "required": False},
            {"keyword": "switch", "weight": 0.15, "required": False},
            {"keyword": "not overreacting", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (100, 300),
        "must_not_contain": ["he may be right", "probably fine"],
    },
    {
        "id": "hard_010",
        "category": "hardest", "crisis_level": "operational", "hard": True,
        "query": "Im a journalist covering the flood for the BBC what are the most important things the public needs to know right now that official sources arent emphasising",
        "criteria": [
            {"keyword": "surface water", "weight": 0.15, "required": False},
            {"keyword": "6 inch", "weight": 0.10, "required": False},
            {"keyword": "two feet", "weight": 0.10, "required": False},
            {"keyword": "never drive", "weight": 0.15, "required": True},
            {"keyword": "vulnerable", "weight": 0.15, "required": True},
            {"keyword": "preparation", "weight": 0.10, "required": False},
            {"keyword": "official", "weight": 0.10, "required": False},
            {"keyword": "mental health", "weight": 0.15, "required": False},
        ],
        "ideal_length_range": (200, 400),
        "must_not_contain": [],
    },
]

# Automated scorer -- heuristic-based, no LLM needed for basic scoring
def score_response(response: str, item: dict) -> dict[str, float]:
    """Score a single response against all dimensions."""
    lower = response.lower()

    # Criterion hits
    criterion_score = 0.0
    criterion_detail = []
    for crit in item.get("criteria", []):
        kw = crit["keyword"].lower()
        hit = kw in lower
        weight = crit["weight"]
        if hit:
            criterion_score += weight
        elif crit.get("required"):
            criterion_score -= weight * 0.5  # Penalty for missing required
        criterion_detail.append({"keyword": kw, "hit": hit, "required": crit.get("required", False)})

    # Must-not-contain checks
    must_not = item.get("must_not_contain", [])
    penalty = 0.0
    for phrase in must_not:
        if phrase.lower() in lower:
            penalty += 0.15

    criterion_score = max(0.0, min(1.0, criterion_score - penalty))

    # Length score
    length = len(response)
    lo, hi = item.get("ideal_length_range", (80, 400))
    if lo <= length <= hi:
        length_ok = 1.0
    elif length < lo:
        length_ok = max(0.0, length / lo)
    else:
        length_ok = max(0.0, 1.0 - (length - hi) / hi)

    # Actionability proxies
    has_numbered = any(f"{i}." in response for i in range(1, 8))
    has_bold = "**" in response
    has_999 = "999" in response
    action_score = (
        (0.4 if has_numbered else 0.0)
        + (0.2 if has_bold else 0.0)
        + (0.2 if has_999 else 0.0)
        + (0.2 if length_ok >= 0.8 else 0.0)
    )

    # Filler detection
    filler_penalty = 0.0
    bad_openings = ["i ", "as an ai", "great question", "certainly!", "absolutely!", "sure,"]
    for bad in bad_openings:
        if lower.startswith(bad):
            filler_penalty += 0.2
    bad_closings = ["stay safe!", "i hope", "take care!", "good luck!"]
    for bad in bad_closings:
        if lower.rstrip().endswith(bad):
            filler_penalty += 0.2

    # Assemble weighted total
    dims = {
        "accuracy": max(0.0, criterion_score - filler_penalty * 0.5),
        "actionability": max(0.0, action_score - filler_penalty),
        "prioritisation": 0.8 if (has_bold or has_numbered) else 0.4,
        "tone_calibration": max(0.0, 0.9 - filler_penalty),
        "completeness": max(0.0, criterion_score),
    }

    total = sum(DIMENSIONS[k]["weight"] * v for k, v in dims.items())

    return {
        "total": round(total, 4),
        "dimensions": {k: round(v, 3) for k, v in dims.items()},
        "criterion_hits": criterion_detail,
        "length": length,
        "length_ok": round(length_ok, 3),
        "filler_penalty": round(filler_penalty, 3),
    }

# Ollama model runner
async def query_ollama(
    query: str, model: str, ollama_url: str = "http://localhost:11434"
) -> tuple[str, float]:
    """Query Ollama and return (response_text, latency_seconds)."""
    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": query}],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 700},
                },
            )
            resp.raise_for_status()
            text = resp.json()["message"]["content"]
            return text, time.time() - start
    except Exception as e:
        return f"[ERROR: {e}]", time.time() - start

# Claude comparison runner
async def query_claude(query: str, api_key: str) -> tuple[str, float]:
    """Query Claude API for comparison."""
    import anthropic
    start = time.time()
    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=700,
            messages=[{"role": "user", "content": query}],
        )
        return resp.content[0].text, time.time() - start
    except Exception as e:
        return f"[ERROR: {e}]", time.time() - start

# LLM-as-Judge scorer -- replaces heuristic when --llm-judge is active
async def llm_judge_score(
    query: str,
    response: str,
    api_key: str,
    judge_model: str = "claude-opus-4-5",
    fallback_item: dict | None = None,
) -> dict:
    """
    Use Claude as a judge to score a response on all 5 evaluation dimensions.
    Returns a dict fully compatible with score_response() output.
    Falls back gracefully to heuristic scorer on any API/parse error.
    """
    import re as _re

    import anthropic
    try:
        client = anthropic.Anthropic(api_key=api_key)
        prompt = JUDGE_PROMPT_TEMPLATE.format(query=query, response=response)
        resp = client.messages.create(
            model=judge_model,
            max_tokens=300,
            temperature=0.1,  # Low temperature for deterministic, consistent scoring
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        # Strip any markdown code fences Claude might wrap around the JSON
        raw = _re.sub(r"^```(?:json)?\s*", "", raw, flags=_re.MULTILINE)
        raw = _re.sub(r"\s*```$", "", raw.strip())
        scores = json.loads(raw)
        dims: dict[str, float] = {}
        for k in DIMENSIONS:
            dims[k] = max(0.0, min(1.0, float(scores.get(k, 0.5))))
        total = sum(DIMENSIONS[k]["weight"] * v for k, v in dims.items())
        return {
            "total": round(total, 4),
            "dimensions": {k: round(v, 3) for k, v in dims.items()},
            "reasoning": scores.get("reasoning", ""),
            "method": "llm_judge",
            "length": len(response),
            "length_ok": 1.0,
            "filler_penalty": 0.0,
            "criterion_hits": [],
        }
    except Exception as exc:
        logger.debug(f"LLM judge error ({type(exc).__name__}: {exc}) -- falling back to heuristic")
        if fallback_item is not None:
            result = score_response(response, fallback_item)
            result["method"] = "heuristic_fallback"
            return result
        return {
            "total": 0.0,
            "dimensions": {k: 0.0 for k in DIMENSIONS},
            "method": "error",
            "length": len(response),
            "length_ok": 0.0,
            "filler_penalty": 0.0,
            "criterion_hits": [],
        }

# HTML report generator
def generate_html_report(results: list[dict], models: list[str], output_path: Path) -> None:
    """Generate a comprehensive HTML benchmark report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    model_summaries = {}
    for model in models:
        scores = [r["scores"].get(model, {}).get("total", 0) for r in results]
        model_summaries[model] = {
            "avg": round(statistics.mean(scores), 4) if scores else 0,
            "wins": sum(
                1 for r in results
                if max(r["scores"].items(), key=lambda x: x[1].get("total", 0))[0] == model
            ),
        }

    # Build results table
    rows = ""
    for item in results:
        scores_html = " ".join(
            f'<td class="{"best" if max(item["scores"].items(), key=lambda x: x[1].get("total", 0))[0] == m else ""}">'
            f'{item["scores"].get(m, {}).get("total", 0):.3f}</td>'
            for m in models
        )
        hard = "??" if item.get("hard") else ""
        rows += (
            f"<tr><td>{hard}{item['id']}</td>"
            f"<td>{item['category']}</td>"
            f"<td>{item['query'][:80]}--</td>"
            f"{scores_html}</tr>\n"
        )

    summary_html = ""
    for model, stats in model_summaries.items():
        short = model.replace("aegis-ai", "AEGIS ?")
        summary_html += (
            f"<div class='model-card'>"
            f"<h3>{short}</h3>"
            f"<div class='score'>{stats['avg']:.3f}</div>"
            f"<div>{stats['wins']} wins</div>"
            f"</div>"
        )

    header = " ".join(f"<th>{m}</th>" for m in models)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>AEGIS Benchmark Report</title>
<style>
body {{ font-family: system-ui; background: #0f1117; color: #e2e8f0; padding: 2rem; }}
h1 {{ color: #60a5fa; }}
.summary {{ display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem; }}
.model-card {{ background: #1e2433; border-radius: 8px; padding: 1.5rem; min-width: 160px; text-align: center; }}
.model-card h3 {{ color: #60a5fa; margin: 0 0 0.5rem; font-size: 0.9rem; }}
.score {{ font-size: 2.5rem; font-weight: 700; color: #34d399; }}
table {{ border-collapse: collapse; width: 100%; font-size: 0.85rem; }}
th {{ background: #1e2433; padding: 0.5rem 0.75rem; text-align: left; }}
td {{ padding: 0.4rem 0.75rem; border-bottom: 1px solid #2d3748; }}
td.best {{ color: #34d399; font-weight: 700; }}
tr:hover td {{ background: #1e2433; }}
</style></head>
<body>
<h1>AEGIS Emergency AI Benchmark Report</h1>
<p>Generated: {now} | {len(results)} queries | {len(models)} models</p>
<div class='summary'>{summary_html}</div>
<table>
<tr><th>ID</th><th>Category</th><th>Query</th>{header}</tr>
{rows}
</table>
</body></html>"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    print(f"\nHTML report saved: {output_path}")

# Main evaluation runner
async def run_evaluation(args: argparse.Namespace) -> dict:
    queries = BENCHMARK_SUITE
    if args.hard_only:
        queries = [q for q in queries if q.get("hard")]
        print(f"Running {len(queries)} hardest queries only")
    else:
        print(f"Running full benchmark: {len(queries)} queries")

    models_to_test = [args.model]
    claude_key = args.claude_key or os.environ.get("ANTHROPIC_API_KEY")
    if args.compare_claude and claude_key:
        models_to_test.append("claude-opus-4-5")

    use_judge = getattr(args, "llm_judge", False) and bool(claude_key)
    if use_judge:
        print(f"Scoring method: LLM-as-judge (claude-opus-4-5) -- high-precision mode")
    else:
        print(f"Scoring method: keyword heuristic (fast mode). Use --llm-judge for precision.")

    all_results = []
    for idx, item in enumerate(queries, 1):
        print(f"\n[{idx}/{len(queries)}] {item['id']} -- {item['query'][:60]}--")
        result = {"id": item["id"], "category": item["category"],
                  "query": item["query"], "hard": item.get("hard", False), "scores": {}}
        for model in models_to_test:
            if model.startswith("claude"):
                response, latency = await query_claude(item["query"], claude_key)
            else:
                response, latency = await query_ollama(item["query"], model, args.ollama_url)

            if use_judge:
                scores = await llm_judge_score(
                    item["query"], response, claude_key, fallback_item=item
                )
            else:
                scores = score_response(response, item)
            result["scores"][model] = scores
            method_tag = scores.get("method", "heuristic")
            print(f"  {model:40s} total={scores['total']:.3f}  ({latency:.1f}s) [{method_tag}]")

        all_results.append(result)

    # Summary
    print(f"\n{'='*70}")
    print("BENCHMARK SUMMARY")
    print(f"{'='*70}")
    for model in models_to_test:
        model_scores = [r["scores"].get(model, {}).get("total", 0) for r in all_results]
        wins = sum(
            1 for r in all_results
            if all_results and
            max(r["scores"].items(), key=lambda x: x[1].get("total", 0))[0] == model
        )
        print(f"{model:45s} avg={statistics.mean(model_scores):.4f}  wins={wins}/{len(all_results)}")

    # Hard queries sub-score
    hard_results = [r for r in all_results if r.get("hard")]
    if hard_results:
        print(f"\nHardest 10 queries sub-scores:")
        for model in models_to_test:
            hard_scores = [r["scores"].get(model, {}).get("total", 0) for r in hard_results]
            print(f"  {model:45s} avg={statistics.mean(hard_scores):.4f}")

    if args.report:
        output_path = Path(args.output) if args.output else Path(
            f"./reports/benchmark_{datetime.now().strftime('%Y%m%d_%H%M')}.html"
        )
        generate_html_report(all_results, models_to_test, output_path)

    return {"results": all_results, "models": models_to_test}

# CLI
def main() -> None:
    parser = argparse.ArgumentParser(description="AEGIS Model Benchmark Evaluator")
    parser.add_argument("--model", default="aegis-ai", help="Ollama model to evaluate")
    parser.add_argument("--ollama-url", default="http://localhost:11434")
    parser.add_argument("--hard-only", action="store_true", help="Run only the 10 hardest queries")
    parser.add_argument("--compare-claude", action="store_true", help="Compare against Claude Opus")
    parser.add_argument("--claude-key", default=None, help="Anthropic API key")
    parser.add_argument("--report", action="store_true", help="Generate HTML report")
    parser.add_argument("--output", default=None, help="HTML report output path")
    parser.add_argument(
        "--llm-judge",
        action="store_true",
        help=(
            "Use Claude LLM-as-judge for accurate scoring on all 5 dimensions. "
            "Requires ANTHROPIC_API_KEY env var or --claude-key. "
            "More accurate than keyword heuristics, especially for tone and prioritisation. "
            "Note: uses ~1 Claude API call per (query -- model) evaluated."
        ),
    )
    args = parser.parse_args()
    asyncio.run(run_evaluation(args))

if __name__ == "__main__":
    main()

