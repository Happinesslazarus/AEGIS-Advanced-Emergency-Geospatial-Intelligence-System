"""
Train_aegis_llm AI engine module.
"""

import argparse
import json
import os
import sys
import textwrap
from dataclasses import dataclass
from pathlib import Path

# Hardware report -- always runs first so the user knows what they have
def hardware_report() -> dict:
    """Check GPU VRAM and recommend the appropriate model."""
    report = {"vram_gb": 0, "cuda_available": False, "recommended_model": "3b", "notes": []}
    try:
        import torch
        if torch.cuda.is_available():
            report["cuda_available"] = True
            vram = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            report["vram_gb"] = round(vram, 1)
            name = torch.cuda.get_device_name(0)
            report["gpu_name"] = name
            print(f"\n GPU detected: {name} -- {vram:.1f} GB VRAM")
            if vram < 8:
                report["recommended_model"] = "3b"
                report["notes"].append("< 8GB VRAM: use 3B model only (Llama 3.2 3B)")
            elif vram < 16:
                report["recommended_model"] = "3b"
                report["notes"].append(
                    "8--16GB VRAM: 3B is comfortable; 8B is possible with QLoRA + batch_size=1 "
                    + "but may OOM. Use --model 3b for safety."
                )
            elif vram < 40:
                report["recommended_model"] = "8b"
                report["notes"].append("16--40GB VRAM: 8B recommended. 70B needs cloud.")
            else:
                report["recommended_model"] = "70b"
                report["notes"].append("40GB+ VRAM: 70B is viable locally.")
        else:
            report["notes"].append("No CUDA GPU found -- CPU training will be very slow.")
            print("\n WARNING: No CUDA GPU detected. Fine-tuning will take days on CPU.")
    except ImportError:
        report["notes"].append("PyTorch not installed -- run: pip install -r requirements-llm.txt")
    return report

# Model configuration per size
@dataclass
class ModelConfig:
    model_id: str
    # LoRA
    lora_r: int
    lora_alpha: int
    # Training
    batch_size: int
    grad_accum: int          # effective batch = batch_size * grad_accum
    max_seq_length: int
    # Memory
    load_in_4bit: bool
    # Precision -- Turing arch (RTX 20xx) does NOT support bfloat16
    fp16: bool
    bf16: bool

MODEL_CONFIGS: dict[str, ModelConfig] = {
    "3b": ModelConfig(
        model_id="meta-llama/Llama-3.2-3B-Instruct",
        lora_r=32,          # Higher rank viable at 3B -- more capacity
        lora_alpha=64,
        batch_size=2,
        grad_accum=8,       # Effective batch = 16
        max_seq_length=2048,
        load_in_4bit=True,
        fp16=True,
        bf16=False,
    ),
    "8b": ModelConfig(
        model_id="meta-llama/Llama-3.1-8B-Instruct",
        lora_r=32,          # Upgraded from 16 -- CPU offload makes r=32 viable on 8GB
        lora_alpha=64,
        batch_size=1,       # MUST be 1 on 8GB VRAM for 8B
        grad_accum=16,      # Effective batch = 16
        max_seq_length=1536, # 1536 vs 1024 -- longer sequences, CPU offset activations
        load_in_4bit=True,
        fp16=True,
        bf16=False,
    ),
    "70b": ModelConfig(
        model_id="meta-llama/Llama-3.1-70B-Instruct",
        lora_r=64,
        lora_alpha=128,
        batch_size=2,
        grad_accum=8,
        max_seq_length=4096,
        load_in_4bit=True,
        fp16=False,
        bf16=True,          # 70B cloud training assumes Ampere+ (A100/H100)
    ),
}

# Dataset validator -- run before training to catch problems early
def validate_dataset(dataset_path: Path) -> dict:
    """
    Validates a JSONL training dataset and prints a quality report.
    Catches: malformed JSON, wrong message structure, too-short responses,
    filler language, missing 999 in life-threatening responses.

    Returns a stats dict. Call before every training run.
    """
    import collections

    total = 0
    valid = 0
    errors: list[str] = []
    categories: dict[str, int] = collections.Counter()
    lengths: list[int] = []
    missing_999: list[str] = []

    FILLER_OPENINGS = ("i ", "as an ai", "great question", "certainly!", "absolutely!", "sure,")
    FILLER_CLOSINGS = ("stay safe!", "i hope this helps", "take care!", "good luck!")

    with open(dataset_path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                ex = json.loads(line)
                msgs = ex.get("messages", [])

                if len(msgs) != 3:
                    errors.append(f"L{lineno}: expected 3 messages, got {len(msgs)}")
                    continue
                if [m.get("role") for m in msgs] != ["system", "user", "assistant"]:
                    errors.append(f"L{lineno}: wrong role order {[m.get('role') for m in msgs]}")
                    continue

                response = msgs[2].get("content", "")
                cat = ex.get("category", "unknown")
                categories[cat] += 1
                lengths.append(len(response))

                if len(response) < 80:
                    errors.append(f"L{lineno}: response too short ({len(response)} chars)")
                    continue
                if len(response) > 2500:
                    errors.append(f"L{lineno}: response too long ({len(response)} chars)")
                    continue

                lower = response.lower()
                for bad in FILLER_OPENINGS:
                    if lower.startswith(bad):
                        errors.append(f"L{lineno}: filler opening '{bad}'")
                        break
                for bad in FILLER_CLOSINGS:
                    if lower.rstrip().endswith(bad):
                        errors.append(f"L{lineno}: filler closing '{bad}'")
                        break

                if cat == "life_threatening" and "999" not in response:
                    missing_999.append(f"L{lineno}: life_threatening without 999")

                valid += 1
            except json.JSONDecodeError as e:
                errors.append(f"L{lineno}: JSON error -- {e}")
            except Exception as e:
                errors.append(f"L{lineno}: {e}")

    avg_len = sum(lengths) / len(lengths) if lengths else 0
    bar = "=" * 60
    print(f"\n{bar}")
    print(f"DATASET VALIDATION REPORT")
    print(f"  File:        {dataset_path}")
    print(f"  Total:       {total:,} examples")
    print(f"  Valid:       {valid:,} ({valid / total * 100:.1f}% ok)" if total else "  Valid: 0")
    print(f"  Errors:      {len(errors)}")
    print(f"  Length:      min={min(lengths) if lengths else 0}  avg={avg_len:.0f}  max={max(lengths) if lengths else 0} chars")
    print(f"\n  Examples per category:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"    {cat:38s}: {count:4d}")
    print(f"    {'TOTAL':38s}: {sum(categories.values()):4d}  (target =2,000)")

    if missing_999:
        print(f"\n  WARNING: {len(missing_999)} life_threatening responses missing 999:")
        for m in missing_999[:5]:
            print(f"    {m}")
    if errors:
        print(f"\n  First 10 errors of {len(errors)}:")
        for e in errors[:10]:
            print(f"    {e}")
    if not errors and not missing_999:
        print("\n  PASS: Dataset passes all quality checks.")
    elif len(errors) <= 10:
        print(f"\n  WARN: {len(errors)} minor issues. Acceptable to train.")
    else:
        print(f"\n  FAIL: {len(errors)} errors. Fix before training on large GPU.")
    print(f"{bar}\n")

    return {
        "total": total, "valid": valid, "errors": len(errors),
        "missing_999": len(missing_999), "categories": dict(categories),
        "avg_length": round(avg_len, 1),
    }

# Cloud training script generator (RunPod)
def generate_cloud_script(args, config: ModelConfig) -> None:
    """Generate a RunPod-ready training script for large models."""
    script = textwrap.dedent(f"""\
        #!/bin/bash
        # AEGIS LLM Fine-Tuning -- RunPod Cloud Training Script
        # Generated for model: {config.model_id}
        # Recommended pod: RTX 4090 (24GB) for 8B | A100-40G for 70B | A100-80G for 70B without quantization
        # Estimated cost: ~$2-4 for 8B (3 epochs) | ~$15-25 for 70B (3 epochs) on RunPod

        set -e

        # Install dependencies
        pip install -q transformers trl peft bitsandbytes datasets torch tensorboard scipy scikit-learn

        # Upload your dataset first (scp or use RunPod volume)
        DATASET_PATH="{args.dataset}"
        OUTPUT_DIR="{args.output}"
        MODEL_ID="{config.model_id}"

        python - <<'PYTHON'
        import json, torch
        from datasets import load_dataset
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
        from peft import LoraConfig, get_peft_model
        from trl import SFTTrainer

        model_id = "$MODEL_ID"
        dataset_path = "$DATASET_PATH"
        output_dir = "$OUTPUT_DIR"

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,   # Ampere+ on cloud
        )

        model = AutoModelForCausalLM.from_pretrained(
            model_id, quantization_config=bnb_config, device_map="auto",
        )
        model.config.use_cache = False

        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "right"

        lora_config = LoraConfig(
            r={config.lora_r}, lora_alpha={config.lora_alpha},
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                            "gate_proj", "up_proj", "down_proj"],
            lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

        dataset = load_dataset("json", data_files=dataset_path, split="train")
        split = dataset.train_test_split(test_size=0.1, seed=42)

        def format_fn(examples):
            return [
                tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
                for msgs in examples["messages"]
            ]

        trainer = SFTTrainer(
            model=model,
            args=TrainingArguments(
                output_dir=output_dir, num_train_epochs=3,
                per_device_train_batch_size={config.batch_size},
                gradient_accumulation_steps={config.grad_accum},
                warmup_ratio=0.03, learning_rate=2e-4,
                fp16={str(config.fp16)}, bf16={str(config.bf16)},
                logging_steps=10, save_strategy="epoch",
                eval_strategy="epoch", load_best_model_at_end=True,
                metric_for_best_model="eval_loss", report_to="tensorboard",
                gradient_checkpointing=True, optim="paged_adamw_8bit",
                lr_scheduler_type="cosine", weight_decay=0.01,
                max_grad_norm=0.3, dataloader_num_workers=4,
            ),
            train_dataset=split["train"], eval_dataset=split["test"],
            processing_class=tokenizer,
            formatting_func=format_fn, max_seq_length={config.max_seq_length},
            packing=False,
        )
        trainer.train()
        trainer.save_model(output_dir)
        print("Training complete.")
        PYTHON
    """)

    cloud_script_path = Path(args.output).parent / "train_cloud.sh"
    cloud_script_path.parent.mkdir(parents=True, exist_ok=True)
    cloud_script_path.write_text(script)
    print(f"\n Cloud training script generated: {cloud_script_path}")
    print(f" Upload your dataset to RunPod and run this script.")
    print(f" Recommended pod for {args.model}: {'A100 40GB' if args.model == '70b' else 'RTX 4090 24GB'}")
    print(f" Estimated cost: {'~$20-30' if args.model == '70b' else '~$3-6'} for 3 epochs of your dataset")

# Training entrypoint
def train(args, hw: dict) -> None:
    """Run the actual fine-tuning."""
    # Deferred imports -- only loaded when actually training
    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, get_peft_model
        from transformers import (
            AutoModelForCausalLM, AutoTokenizer,
            BitsAndBytesConfig, TrainingArguments,
        )
        from trl import SFTTrainer
    except ImportError as e:
        print(f"\nMissing dependency: {e}")
        print("Install with: pip install -r requirements-llm.txt")
        sys.exit(1)

    config = MODEL_CONFIGS[args.model]

    print(f"\n{'='*60}")
    print(f"AEGIS LLM Fine-Tuning")
    print(f"  Model:        {config.model_id}")
    print(f"  LoRA rank:    r={config.lora_r}, alpha={config.lora_alpha}")
    print(f"  Batch size:   {config.batch_size} -- {config.grad_accum} accum = {config.batch_size * config.grad_accum} effective")
    print(f"  Max seq len:  {config.max_seq_length} tokens")
    print(f"  Precision:    {'fp16' if config.fp16 else 'bf16' if config.bf16 else 'fp32'}")
    print(f"  Output:       {args.output}")
    print(f"{'='*60}\n")

    # Dataset
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        print(f"ERROR: Dataset not found: {dataset_path}")
        print("Run generate_training_data_free.py first.")
        sys.exit(1)

    line_count = sum(1 for _ in open(dataset_path))
    print(f"Dataset: {line_count:,} examples from {dataset_path}")
    if line_count < 200:
        print("WARNING: Very small dataset (<200 examples). Quality may be limited. Generate more first.")

    # Run quality check on the dataset before loading
    validate_dataset(dataset_path)

    raw_dataset = load_dataset("json", data_files=str(dataset_path), split="train")
    split = raw_dataset.train_test_split(test_size=0.1, seed=42)
    print(f"Train: {len(split['train']):,} | Eval: {len(split['test']):,}")

    # Estimate training time so the user knows what they're committing to
    config = MODEL_CONFIGS[args.model]
    steps_per_epoch = max(1, len(split["train"]) // (config.batch_size * config.grad_accum))
    total_steps = steps_per_epoch * args.epochs
    secs_per_step = 18 if args.model == "8b" else 8  # RTX 2060 benchmarks
    est_minutes = (total_steps * secs_per_step) / 60
    print(f"  Steps/epoch: {steps_per_epoch:,} | Total steps: {total_steps:,}")
    print(f"  Estimated training time: ~{est_minutes:.0f} min (~{est_minutes/60:.1f} hours) on RTX 2060")
    if est_minutes > 120:
        print(f"  NOTE: Consider --model 3b ({est_minutes/2:.0f} min) or cloud (--cloud) for faster results.")

    # BitsAndBytes 4-bit config
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=config.load_in_4bit,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        # RTX 2060 = Turing (sm_75) ? fp16 compute, NOT bfloat16
        bnb_4bit_compute_dtype=torch.bfloat16 if config.bf16 else torch.float16,
    )

    # Load model
    print(f"Loading {config.model_id} in 4-bit NF4...")
    # For 8B on 8GB VRAM: allow overflow of some layers to system RAM.
    # This trades a small speed cost (~10%) for the ability to fit r=32 LoRA
    # and longer sequences without OOM.
    max_memory: dict | None = None
    if args.model == "8b" and hw.get("vram_gb", 0) < 12:
        vram_gb = hw.get("vram_gb", 8.0)
        max_memory = {0: f"{vram_gb * 0.88:.0f}GiB", "cpu": "12GiB"}
        print(f"  8B on {vram_gb:.1f}GB VRAM: allocating CPU overflow (max_memory {max_memory})")

    model = AutoModelForCausalLM.from_pretrained(
        config.model_id,
        quantization_config=bnb_config,
        device_map="auto",
        max_memory=max_memory,
        torch_dtype=torch.bfloat16 if config.bf16 else torch.float16,
        trust_remote_code=False,
    )
    model.config.use_cache = False           # Required for gradient checkpointing
    model.config.pretraining_tp = 1          # Disable tensor parallelism for single GPU

    # Tokeniser
    tokenizer = AutoTokenizer.from_pretrained(config.model_id, trust_remote_code=False)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"         # Required for SFTTrainer

    # LoRA
    lora_config = LoraConfig(
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    trainable, total = model.get_nb_trainable_parameters()
    print(f"Trainable params: {trainable:,} / {total:,} ({trainable/total*100:.2f}%)")

    # Training args
    output_dir = args.output
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=config.batch_size,
        gradient_accumulation_steps=config.grad_accum,
        warmup_ratio=0.03,
        learning_rate=2e-4,
        fp16=config.fp16,
        bf16=config.bf16,
        logging_steps=10,
        save_strategy="epoch",
        eval_strategy="epoch",          # Modern API (not evaluation_strategy)
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="tensorboard",
        gradient_checkpointing=True,
        optim="paged_adamw_8bit",        # Memory-efficient -- NOT paged_adamw_32bit
        lr_scheduler_type="cosine",
        weight_decay=0.01,
        max_grad_norm=0.3,               # Critical for stability with small effective batch
        dataloader_num_workers=0,        # Windows compatibility
        remove_unused_columns=False,     # Keep "category" metadata column
        seed=42,
        data_seed=42,
    )

    # Formatting function (THE KEY FIX)
    # SFTTrainer requires a string, not a list of dicts.
    # We use the model's own chat template to format messages correctly.
    def format_examples(examples: dict) -> list[str]:
        return [
            tokenizer.apply_chat_template(
                msgs,
                tokenize=False,
                add_generation_prompt=False,  # We have the full conversation incl. assistant turn
            )
            for msgs in examples["messages"]
        ]

    # SFTTrainer
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=split["train"],
        eval_dataset=split["test"],
        processing_class=tokenizer,      # New TRL API (replaces tokenizer=)
        formatting_func=format_examples, # Correct: not dataset_text_field
        max_seq_length=config.max_seq_length,
        packing=False,                   # Do not pack -- emergency responses vary wildly in length
        dataset_kwargs={"skip_prepare_dataset": False},
    )

    print(f"\nStarting training -- {args.epochs} epochs...")
    print(f"TensorBoard logs: tensorboard --logdir {output_dir}/runs")

    # Resume from latest checkpoint if --resume is set
    checkpoint = None
    if args.resume:
        existing = sorted(Path(output_dir).glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]) if p.name.split("-")[-1].isdigit() else 0)
        if existing:
            checkpoint = str(existing[-1])
            print(f"Resuming from checkpoint: {checkpoint}")
        else:
            print("No checkpoint found in output directory -- starting fresh")

    trainer.train(resume_from_checkpoint=checkpoint)

    # Save
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"\nLoRA adapter saved to: {output_dir}")

    # Merge LoRA into base model (for Ollama deployment)
    if args.merge:
        _merge_and_save(model, tokenizer, output_dir, config)

    print(f"\n{'='*60}")
    print(f"TRAINING COMPLETE")
    print(f"  Adapter:  {output_dir}")
    if args.merge:
        print(f"  Merged:   {output_dir}-merged/")
        print(f"\nDeploy to Ollama:")
        print(f"  ollama create aegis-ai -f ai-engine/Modelfile")
        print(f"  ollama run aegis-ai")
    print(f"\nNext: python scripts/evaluate_model.py --model-path {output_dir}")
    print(f"{'='*60}\n")

def _merge_and_save(model, tokenizer, output_dir: str, config: ModelConfig) -> None:
    """Merge LoRA weights into base model and save for Ollama."""
    from peft import PeftModel
    import torch

    print("\nMerging LoRA adapter into base model (this uses extra RAM)...")
    merged_dir = f"{output_dir}-merged"
    Path(merged_dir).mkdir(parents=True, exist_ok=True)

    # Merge LoRA ? base and unload
    merged_model = model.merge_and_unload()
    merged_model.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)

    # Save training metadata
    metadata = {
        "base_model": config.model_id,
        "lora_r": config.lora_r,
        "lora_alpha": config.lora_alpha,
        "merged": True,
        "aegis_version": "1.0.0",
        "description": "AEGIS Emergency AI -- fine-tuned on all-hazards UK emergency management",
    }
    with open(Path(merged_dir) / "aegis_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Merged model saved to: {merged_dir}")
    print("\nTo convert to GGUF for Ollama (requires llama.cpp):")
    print(f"  python llama.cpp/convert_hf_to_gguf.py {merged_dir} --outtype q4_k_m --outfile aegis-v1.gguf")
    print(f"  # Then update the Modelfile FROM path and run: ollama create aegis-ai -f Modelfile")

# Main
def main() -> None:
    parser = argparse.ArgumentParser(
        description="AEGIS QLoRA fine-tuning -- optimised for 8GB VRAM (RTX 2060)"
    )
    parser.add_argument(
        "--model", choices=["3b", "8b", "70b"], default="3b",
        help="Model size: 3b (safe for 8GB VRAM), 8b (tight), 70b (requires cloud)"
    )
    parser.add_argument("--dataset", required=False, help="Path to JSONL training dataset")
    parser.add_argument("--output", default="D:/aegis-models/aegis-llm-v1", help="Output directory")
    parser.add_argument("--epochs", type=int, default=3, help="Training epochs")
    parser.add_argument("--merge", action="store_true", help="Merge LoRA into base after training")
    parser.add_argument("--cloud", action="store_true", help="Generate RunPod cloud training script instead")
    parser.add_argument("--validate", action="store_true", help="Validate dataset only (no training)")
    parser.add_argument("--resume", action="store_true", help="Resume from latest checkpoint in output directory")
    args = parser.parse_args()

    hw = hardware_report()
    for note in hw.get("notes", []):
        print(f"  NOTE: {note}")

    # validate: quality-check the dataset without launching training
    if args.validate:
        if not args.dataset:
            print("ERROR: --validate requires --dataset")
            sys.exit(1)
        validate_dataset(Path(args.dataset))
        sys.exit(0)

    if not args.dataset and not args.cloud:
        print("ERROR: --dataset is required (or use --validate or --cloud)")
        sys.exit(1)

    if args.model == "70b" and not args.cloud:
        print("\nERROR: 70B model requires 40GB+ VRAM. Your RTX 2060 has 8GB.")
        print("Use --cloud to generate a RunPod training script instead.")
        print("Or use --model 3b for local training.")
        sys.exit(1)

    if args.model == "8b" and hw.get("vram_gb", 0) < 8:
        print("\nWARNING: 8B model is very tight on 8GB VRAM. Consider --model 3b for safety.")
        response = input("Continue anyway? (yes/no): ")
        if response.lower() != "yes":
            sys.exit(0)

    if args.cloud:
        generate_cloud_script(args, MODEL_CONFIGS[args.model])
        return

    train(args, hw)

if __name__ == "__main__":
    main()

