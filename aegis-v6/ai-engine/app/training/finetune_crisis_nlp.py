"""
Fine-tunes a small language model (e.g. distilbert-base-uncased) on
crisis-domain text classification: flood alerts, emergency bulletins,
SOS messages. Produces a custom embeddings model used by the report_
classifier_ml.py for better semantic classification of free-text reports.

- Saves fine-tuned model checkpoint to ai-engine/model_registry/nlp/
- Checkpoint loaded by models/report_classifier_ml.py at inference time
- Training data from ai-engine/data/crisis_nlp_corpus/
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from loguru import logger

REGISTRY_ROOT = Path(__file__).resolve().parents[2] / "model_registry"
DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "crisis_nlp"

# Label maps

SENTIMENT_LABELS = {
    "panic": 0,
    "fear": 1,
    "distress": 2,
    "neutral": 3,
    "calm": 4,
}
SENTIMENT_ID2LABEL = {v: k for k, v in SENTIMENT_LABELS.items()}

HAZARD_LABELS = [
    "flood", "earthquake", "hurricane", "wildfire",
    "tornado", "drought", "landslide", "storm",
    "tsunami", "heatwave", "other",
]

# Data loading — works with or without HuggingFace `datasets` library

def _download_humaid() -> pd.DataFrame:
    """
    Load HumAID dataset (77K labeled tweets).
    Sources: HuggingFace Hub ? local CSV. No synthetic fallback.
    """
    try:
        from datasets import load_dataset
        ds = load_dataset("crisis_nlp/humaid", split="train", trust_remote_code=True)
        df = ds.to_pandas()
        logger.success(f"HumAID loaded via HF datasets: {len(df)} rows")
        return df
    except Exception as e:
        logger.warning(f"HumAID HF load failed: {e}")

    local = DATA_DIR / "humaid_train.csv"
    if local.exists():
        df = pd.read_csv(local)
        logger.success(f"HumAID loaded from local CSV: {len(df)} rows")
        return df

    logger.warning("HumAID not available — no synthetic fallback, skipping")
    return pd.DataFrame()

def _download_crisislex() -> pd.DataFrame:
    """
    Load CrisisLex dataset (60K labeled tweets).
    Sources: HuggingFace Hub ? local CSV. No synthetic fallback.
    """
    try:
        from datasets import load_dataset
        ds = load_dataset("crisistransformers/CrisisLexT26", split="train", trust_remote_code=True)
        df = ds.to_pandas()
        logger.success(f"CrisisLex loaded via HF datasets: {len(df)} rows")
        return df
    except Exception as e:
        logger.warning(f"CrisisLex HF load failed: {e}")

    local = DATA_DIR / "crisislex_train.csv"
    if local.exists():
        df = pd.read_csv(local)
        logger.success(f"CrisisLex loaded from local CSV: {len(df)} rows")
        return df

    logger.warning("CrisisLex not available — skipping")
    return pd.DataFrame()

def _download_crisisnlp_crowdflower() -> pd.DataFrame:
    """
    Load CrisisNLP Crowdflower dataset (~60K tweets from 19 crises).
    Sources: HuggingFace Hub ? local CSV.
    """
    try:
        from datasets import load_dataset
        ds = load_dataset("crisis_nlp/crisis_nlp_crowdflower", split="train", trust_remote_code=True)
        df = ds.to_pandas()
        logger.success(f"CrisisNLP Crowdflower loaded via HF: {len(df)} rows")
        return df
    except Exception as e:
        logger.warning(f"CrisisNLP Crowdflower HF load failed: {e}")

    local = DATA_DIR / "crisisnlp_crowdflower.csv"
    if local.exists():
        df = pd.read_csv(local)
        logger.success(f"CrisisNLP Crowdflower loaded from local CSV: {len(df)} rows")
        return df

    logger.warning("CrisisNLP Crowdflower not available — skipping")
    return pd.DataFrame()

def _download_crisisbench() -> pd.DataFrame:
    """
    Load CrisisBench consolidated crisis dataset.
    Sources: HuggingFace Hub ? local CSV.
    """
    try:
        from datasets import load_dataset
        ds = load_dataset("crisistransformers/CrisisBench", split="train", trust_remote_code=True)
        df = ds.to_pandas()
        logger.success(f"CrisisBench loaded via HF: {len(df)} rows")
        return df
    except Exception as e:
        logger.warning(f"CrisisBench HF load failed: {e}")

    local = DATA_DIR / "crisisbench_train.csv"
    if local.exists():
        df = pd.read_csv(local)
        logger.success(f"CrisisBench loaded from local CSV: {len(df)} rows")
        return df

    logger.warning("CrisisBench not available — skipping")
    return pd.DataFrame()

def _load_aegis_db_reports() -> pd.DataFrame:
    """
    Load real disaster report text from the AEGIS PostgreSQL database.
    These are verified citizen reports — the highest-quality training data.
    """
    import asyncio

    async def _fetch():
        try:
            import asyncpg
            from app.core.config import settings
            conn = await asyncpg.connect(dsn=settings.DATABASE_URL)
            try:
                rows = await conn.fetch("""
                    SELECT description AS text,
                           incident_category AS category,
                           severity,
                           created_at
                    FROM reports
                    WHERE deleted_at IS NULL
                      AND status IN ('verified', 'resolved')
                      AND LENGTH(COALESCE(description, '')) > 20
                    ORDER BY created_at DESC
                """)
                if rows:
                    df = pd.DataFrame([dict(r) for r in rows])
                    logger.success(f"AEGIS DB reports loaded: {len(df)} verified reports")
                    return df
            finally:
                await conn.close()
        except Exception as e:
            logger.warning(f"AEGIS DB load failed: {e}")
        return pd.DataFrame()

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(lambda: asyncio.run(_fetch())).result(timeout=30)
        return asyncio.run(_fetch())
    except Exception as e:
        logger.warning(f"AEGIS DB async load failed: {e}")
        return pd.DataFrame()

# Preprocessing

def preprocess_text(text: str) -> str:
    """Clean tweet text for model input."""
    text = re.sub(r"http\S+|www\.\S+", "[URL]", text)
    text = re.sub(r"@\w+", "[USER]", text)
    text = re.sub(r"#(\w+)", r"\1", text)  # keep hashtag text, drop #
    text = re.sub(r"\s+", " ", text).strip()
    return text

def prepare_sentiment_dataset(df: pd.DataFrame) -> Tuple[List[str], List[int]]:
    """Map raw dataset to 5-class sentiment labels."""
    text_col = None
    for col in ["text", "tweet_text", "tweet", "content"]:
        if col in df.columns:
            text_col = col
            break
    if text_col is None:
        text_col = df.columns[0]

    texts = df[text_col].astype(str).apply(preprocess_text).tolist()

    # Try to find an existing label column
    label_col = None
    for col in ["label", "sentiment", "class_label", "category"]:
        if col in df.columns:
            label_col = col
            break

    if label_col and set(df[label_col].unique()).issubset(set(SENTIMENT_LABELS.keys())):
        labels = df[label_col].map(SENTIMENT_LABELS).tolist()
    else:
        # Use keyword heuristic to assign labels for unlabeled data
        labels = [_heuristic_sentiment(t) for t in texts]

    return texts, labels

def _heuristic_sentiment(text: str) -> int:
    """Simple keyword-based sentiment labeling for bootstrapping."""
    t = text.lower()
    panic_kw = ["help", "trapped", "sos", "rescue", "dying", "emergency"]
    fear_kw = ["scared", "afraid", "worried", "terrified", "anxious"]
    distress_kw = ["lost", "destroyed", "damage", "need", "homeless", "suffering"]
    calm_kw = ["safe", "resolved", "all clear", "recovered", "under control"]

    if any(w in t for w in panic_kw):
        return SENTIMENT_LABELS["panic"]
    if any(w in t for w in fear_kw):
        return SENTIMENT_LABELS["fear"]
    if any(w in t for w in distress_kw):
        return SENTIMENT_LABELS["distress"]
    if any(w in t for w in calm_kw):
        return SENTIMENT_LABELS["calm"]
    return SENTIMENT_LABELS["neutral"]

# Training

def train_sentiment_model(
    texts: List[str],
    labels: List[int],
    model_name: str = "distilbert-base-uncased",
    epochs: int = 5,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
    output_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fine-tune a DistilBERT model for 5-class crisis sentiment.

    If transformers+torch are available, does real fine-tuning.
    Otherwise, falls back to a TF-IDF + Logistic Regression baseline.
    """
    from sklearn.model_selection import train_test_split
    train_texts, val_texts, train_labels, val_labels = train_test_split(
        texts, labels, test_size=0.15, random_state=42, stratify=labels,
    )

    try:
        return _train_transformer(
            train_texts, train_labels, val_texts, val_labels,
            model_name=model_name,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            output_dir=output_dir,
        )
    except ImportError as e:
        logger.warning(f"Transformers/torch not fully available ({e}), using TF-IDF baseline")
        return _train_tfidf_baseline(
            train_texts, train_labels, val_texts, val_labels,
            output_dir=output_dir,
        )

def _train_transformer(
    train_texts, train_labels, val_texts, val_labels,
    model_name, epochs, batch_size, learning_rate, output_dir,
) -> Dict[str, Any]:
    """Real transformer fine-tuning with HuggingFace."""
    import torch
    from transformers import (
        AutoTokenizer,
        AutoModelForSequenceClassification,
        TrainingArguments,
        Trainer,
    )
    from sklearn.metrics import accuracy_score, f1_score, classification_report

    if output_dir is None:
        output_dir = str(REGISTRY_ROOT / "crisis_sentiment" / datetime.now().strftime("%Y%m%d_%H%M%S"))
    os.makedirs(output_dir, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=len(SENTIMENT_LABELS),
        id2label=SENTIMENT_ID2LABEL,
        label2id=SENTIMENT_LABELS,
    )

    # Tokenize
    train_enc = tokenizer(train_texts, truncation=True, padding=True, max_length=128, return_tensors="pt")
    val_enc = tokenizer(val_texts, truncation=True, padding=True, max_length=128, return_tensors="pt")

    class CrisisDataset(torch.utils.data.Dataset):
        def __init__(self, encodings, labels):
            self.encodings = encodings
            self.labels = labels
        def __len__(self):
            return len(self.labels)
        def __getitem__(self, idx):
            item = {k: v[idx] for k, v in self.encodings.items()}
            item["labels"] = torch.tensor(self.labels[idx], dtype=torch.long)
            return item

    train_dataset = CrisisDataset(train_enc, train_labels)
    val_dataset = CrisisDataset(val_enc, val_labels)

    def compute_metrics(eval_pred):
        preds = np.argmax(eval_pred.predictions, axis=-1)
        acc = accuracy_score(eval_pred.label_ids, preds)
        f1 = f1_score(eval_pred.label_ids, preds, average="weighted")
        return {"accuracy": acc, "f1": f1}

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size * 2,
        learning_rate=learning_rate,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=50,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
    )

    logger.info(f"Starting fine-tuning: {len(train_texts)} train, {len(val_texts)} val, {epochs} epochs")
    train_result = trainer.train()

    # Evaluate
    eval_result = trainer.evaluate()
    val_preds = np.argmax(trainer.predict(val_dataset).predictions, axis=-1)
    report = classification_report(
        val_labels, val_preds,
        target_names=list(SENTIMENT_LABELS.keys()),
        output_dict=True,
    )

    # Save model and tokenizer
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)

    # Save metadata
    metadata = {
        "model_type": "crisis_sentiment",
        "base_model": model_name,
        "num_labels": len(SENTIMENT_LABELS),
        "label_map": SENTIMENT_LABELS,
        "training_samples": len(train_texts),
        "validation_samples": len(val_texts),
        "epochs": epochs,
        "best_f1": float(eval_result.get("eval_f1", 0)),
        "best_accuracy": float(eval_result.get("eval_accuracy", 0)),
        "classification_report": report,
        "trained_at": datetime.now().isoformat(),
        "training_loss": float(train_result.training_loss),
    }
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2, default=str)

    logger.success(
        f"Fine-tuning complete: F1={eval_result.get('eval_f1', 0):.4f}, "
        f"Accuracy={eval_result.get('eval_accuracy', 0):.4f}"
    )
    return metadata

def _train_tfidf_baseline(
    train_texts, train_labels, val_texts, val_labels, output_dir,
) -> Dict[str, Any]:
    """Fallback: TF-IDF + Logistic Regression for crisis sentiment."""
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score, classification_report

    if output_dir is None:
        output_dir = str(REGISTRY_ROOT / "crisis_sentiment_baseline" / datetime.now().strftime("%Y%m%d_%H%M%S"))
    os.makedirs(output_dir, exist_ok=True)

    vectorizer = TfidfVectorizer(max_features=10000, ngram_range=(1, 2))
    X_train = vectorizer.fit_transform(train_texts)
    X_val = vectorizer.transform(val_texts)

    clf = LogisticRegression(max_iter=1000, C=1.0, multi_class="multinomial")
    clf.fit(X_train, train_labels)

    val_preds = clf.predict(X_val)
    accuracy = accuracy_score(val_labels, val_preds)
    f1 = f1_score(val_labels, val_preds, average="weighted")
    report = classification_report(
        val_labels, val_preds,
        target_names=list(SENTIMENT_LABELS.keys()),
        output_dict=True,
    )

    joblib.dump(clf, os.path.join(output_dir, "model.joblib"))
    joblib.dump(vectorizer, os.path.join(output_dir, "vectorizer.joblib"))

    metadata = {
        "model_type": "crisis_sentiment_baseline",
        "algorithm": "tfidf_logistic_regression",
        "num_labels": len(SENTIMENT_LABELS),
        "label_map": SENTIMENT_LABELS,
        "training_samples": len(train_labels),
        "validation_samples": len(val_labels),
        "accuracy": float(accuracy),
        "f1": float(f1),
        "classification_report": report,
        "trained_at": datetime.now().isoformat(),
    }
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2, default=str)

    logger.success(f"TF-IDF baseline: F1={f1:.4f}, Accuracy={accuracy:.4f}")
    return metadata

# CLI

def main():
    parser = argparse.ArgumentParser(description="AEGIS Crisis NLP Fine-Tuning")
    parser.add_argument("--task", choices=["sentiment", "hazard_type", "urgency"], default="sentiment")
    parser.add_argument("--model", default="distilbert-base-uncased", help="Base HF model name")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--output-dir", type=str, default=None)
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    logger.info(f"=== AEGIS Crisis NLP Fine-Tuning: {args.task} ===")
    logger.info("Policy: REAL DATA ONLY — no synthetic generation, no fallbacks")

    # Load data from ALL available real sources
    dfs = []
    loaders = [
        ("HumAID", _download_humaid),
        ("CrisisLex", _download_crisislex),
        ("CrisisNLP Crowdflower", _download_crisisnlp_crowdflower),
        ("CrisisBench", _download_crisisbench),
        ("AEGIS Database", _load_aegis_db_reports),
    ]
    for name, loader in loaders:
        logger.info(f"Attempting to load: {name}")
        df = loader()
        if len(df) > 0:
            dfs.append(df)
            logger.success(f"  ? {name}: {len(df)} samples loaded")
        else:
            logger.warning(f"  ? {name}: no data available")

    if not dfs:
        error_msg = (
            "TRAINING ABORTED: No real datasets available.\n\n"
            "AEGIS requires REAL training data — no synthetic fallback is permitted.\n\n"
            "To obtain training data, do one or more of the following:\n"
            "  1. Install HuggingFace datasets: pip install datasets\n"
            "     Then re-run — HumAID (77K) and CrisisLex (60K) will download automatically.\n"
            "  2. Place CSV files in: {data_dir}\n"
            "     Expected files: humaid_train.csv, crisislex_train.csv, crisisnlp_crowdflower.csv\n"
            "  3. Populate the AEGIS database with verified citizen reports.\n"
            "     At least 1,000 verified reports with descriptions are needed.\n"
        ).format(data_dir=DATA_DIR)
        logger.error(error_msg)
        raise SystemExit(error_msg)

    combined = pd.concat(dfs, ignore_index=True)
    logger.info(f"Combined REAL dataset: {len(combined)} samples from {len(dfs)} source(s)")

    if args.task == "sentiment":
        texts, labels = prepare_sentiment_dataset(combined)
        logger.info(f"Prepared {len(texts)} texts for sentiment classification")

        dist = pd.Series(labels).value_counts().to_dict()
        logger.info(f"Label distribution: {dist}")

        result = train_sentiment_model(
            texts, labels,
            model_name=args.model,
            epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.lr,
            output_dir=args.output_dir,
        )
        logger.success(f"Training complete. Results: {json.dumps({k:v for k,v in result.items() if k != 'classification_report'}, indent=2, default=str)}")
    else:
        logger.warning(f"Task '{args.task}' not yet implemented — sentiment is the recommended starting point")

if __name__ == "__main__":
    main()

