import asyncio, asyncpg
async def f():
    c = await asyncpg.connect('postgresql://postgres:Happylove%40%21@localhost:5432/aegis')
    cols = await c.fetch("SELECT column_name FROM information_schema.columns WHERE table_name='ai_model_metrics' ORDER BY ordinal_position")
    print([x[0] for x in cols])
    
    # Save the grid search metrics
    metrics = {
        'flood': {'accuracy': 0.865, 'roc_auc': 0.956, 'f1_score': 0.854, 'precision': 0.608, 'recall': 0.564},
        'drought': {'accuracy': 0.725, 'roc_auc': 0.786, 'f1_score': 0.732, 'precision': 0.676, 'recall': 0.676},
        'heatwave': {'accuracy': 0.958, 'roc_auc': 0.978, 'f1_score': 0.958, 'precision': 0.850, 'recall': 0.944},
    }
    
    for hazard, m in metrics.items():
        for mn, mv in m.items():
            await c.execute(
                "INSERT INTO ai_model_metrics (model_name, model_version, metric_name, metric_value, dataset_size) VALUES ($1, $2, $3, $4, $5)",
                f'{hazard}_xgboost', 'grid-v3-20260327', mn, float(mv), 443 if hazard == 'flood' else (273 if hazard == 'drought' else 286))
    print("Saved all metrics to DB")
    await c.close()
asyncio.run(f())
