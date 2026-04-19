"""
Module: autonomous/__init__.py

Package initialiser for the autonomous module.
Contains: llm_engine — LLM-based emergency response query handler.
"""
from .llm_engine import AEGISLLMEngine

__all__ = ["AEGISLLMEngine"]
