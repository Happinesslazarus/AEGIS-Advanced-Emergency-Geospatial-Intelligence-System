import asyncio
from datetime import datetime, timedelta
from app.training.training_pipeline import TrainingPipeline

async def main() -> None:
    pipeline = TrainingPipeline("config.yaml")
    end = datetime.utcnow()
    start = end - timedelta(days=365)

    for hazard in ["flood", "drought", "heatwave"]:
        result = await pipeline.train_model(
            hazard_type=hazard,
            model_type="random_forest",
            start_date=start,
            end_date=end,
            tune_hyperparams=False,
            save_model=True,
            experiment_name=f"{hazard}_rf_prod",
        )
        print(hazard, result.get("metrics", {}))

if __name__ == "__main__":
    asyncio.run(main())
