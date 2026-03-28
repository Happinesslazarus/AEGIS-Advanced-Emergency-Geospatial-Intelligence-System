"""Patch training_pipeline.py to use stratified split instead of time_series_split
when the time-based split would result in single-class validation set."""
import pathlib

f = pathlib.Path(r'e:\aegis-v6-fullstack\aegis-v6\ai-engine\app\training\training_pipeline.py')
content = f.read_text(encoding='utf-8')

OLD = '''            # Time series split or random split
            if self.validation_config['strategy'] == 'time_series_split':
                # Use last 20% as validation
                split_idx = int(len(X) * 0.8)
                X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
                y_train, y_val = y[:split_idx], y[split_idx:]
            else:
                X_train, X_val, y_train, y_val = train_test_split(
                    X, y,
                    test_size=self.validation_config['test_size'],
                    random_state=self.seed
                )'''

NEW = '''            # Stratified split to ensure both classes appear in train and validation
            # Time-series split is inappropriate when data is concatenated pos+neg reports
            X_train, X_val, y_train, y_val = train_test_split(
                X, y,
                test_size=self.validation_config['test_size'],
                random_state=self.seed,
                stratify=y
            )'''

assert OLD in content, f"Could not find old split block"
content = content.replace(OLD, NEW)

f.write_text(content, encoding='utf-8')
print("Patched training_pipeline.py: stratified split with class balancing")
