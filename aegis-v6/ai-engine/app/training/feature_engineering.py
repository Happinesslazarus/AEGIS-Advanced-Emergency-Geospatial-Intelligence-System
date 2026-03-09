"""
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 AEGIS AI ENGINE â€” Feature Engineering
 
 Implements advanced feature generation:
 - Rolling statistics (moving averages, std dev)
 - Lag features (temporal dependencies)
 - Interaction terms (feature combinations)
 - Fourier seasonal features
 - Domain-specific transformations
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
from loguru import logger
import yaml


class FeatureEngineer:
    """
    Generate engineered features from raw data.
    Implements methods defined in config.yaml training.feature_engineering.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize feature engineer with configuration."""
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.fe_config = self.config['training']['feature_engineering']
        self.methods = self.fe_config.get('methods', [])
    
    def create_rolling_features(
        self,
        df: pd.DataFrame,
        columns: List[str],
        windows: List[int] = [6, 12, 24, 168]
    ) -> pd.DataFrame:
        """
        Create rolling statistical features.
        
        Args:
            df: Input DataFrame with time series data
            columns: Columns to create rolling features for
            windows: Rolling window sizes (in hours)
        
        Returns:
            DataFrame with additional rolling features
        """
        if 'rolling_statistics' not in self.methods:
            return df
        
        logger.info(f"Creating rolling features for {len(columns)} columns")
        
        df_copy = df.copy()
        
        for col in columns:
            if col not in df_copy.columns:
                continue
            
            for window in windows:
                # Rolling mean
                df_copy[f'{col}_rolling_mean_{window}h'] = (
                    df_copy[col].rolling(window=window, min_periods=1).mean()
                )
                
                # Rolling std
                df_copy[f'{col}_rolling_std_{window}h'] = (
                    df_copy[col].rolling(window=window, min_periods=1).std()
                )
                
                # Rolling min/max
                df_copy[f'{col}_rolling_min_{window}h'] = (
                    df_copy[col].rolling(window=window, min_periods=1).min()
                )
                df_copy[f'{col}_rolling_max_{window}h'] = (
                    df_copy[col].rolling(window=window, min_periods=1).max()
                )
        
        new_features = len(df_copy.columns) - len(df.columns)
        logger.success(f"Created {new_features} rolling features")
        
        return df_copy
    
    def create_lag_features(
        self,
        df: pd.DataFrame,
        columns: List[str],
        lags: List[int] = [1, 3, 6, 12, 24, 48, 168]
    ) -> pd.DataFrame:
        """
        Create lagged features for temporal dependencies.
        
        Args:
            df: Input DataFrame
            columns: Columns to create lags for
            lags: Lag periods (in hours)
        
        Returns:
            DataFrame with lagged features
        """
        if 'lag_features' not in self.methods:
            return df
        
        logger.info(f"Creating lag features for {len(columns)} columns")
        
        df_copy = df.copy()
        
        for col in columns:
            if col not in df_copy.columns:
                continue
            
            for lag in lags:
                df_copy[f'{col}_lag_{lag}h'] = df_copy[col].shift(lag)
        
        new_features = len(df_copy.columns) - len(df.columns)
        logger.success(f"Created {new_features} lag features")
        
        return df_copy
    
    def create_interaction_features(
        self,
        df: pd.DataFrame,
        feature_pairs: Optional[List[tuple]] = None
    ) -> pd.DataFrame:
        """
        Create interaction terms between features.
        
        Args:
            df: Input DataFrame
            feature_pairs: List of feature pairs to interact, or None for auto-detection
        
        Returns:
            DataFrame with interaction features
        """
        if 'interaction_terms' not in self.methods:
            return df
        
        logger.info("Creating interaction features")
        
        df_copy = df.copy()
        
        # Auto-detect important pairs if not provided
        if feature_pairs is None:
            # Domain knowledge: rainfall Ã— soil moisture, temperature Ã— humidity, etc.
            feature_pairs = [
                ('rainfall_1h', 'soil_moisture'),
                ('rainfall_24h', 'river_level'),
                ('temperature', 'humidity'),
                ('wind_speed', 'rainfall_1h')
            ]
        
        for feat1, feat2 in feature_pairs:
            if feat1 in df_copy.columns and feat2 in df_copy.columns:
                # Multiplicative interaction
                df_copy[f'{feat1}_X_{feat2}'] = df_copy[feat1] * df_copy[feat2]
                
                # Ratio interaction (with safe division)
                df_copy[f'{feat1}_DIV_{feat2}'] = df_copy[feat1] / (df_copy[feat2] + 1e-8)
        
        new_features = len(df_copy.columns) - len(df.columns)
        logger.success(f"Created {new_features} interaction features")
        
        return df_copy
    
    def create_fourier_seasonal_features(
        self,
        df: pd.DataFrame,
        timestamp_col: str = 'timestamp',
        periods: List[int] = [24, 168, 8760]
    ) -> pd.DataFrame:
        """
        Create Fourier features for seasonal patterns.
        
        Args:
            df: Input DataFrame
            timestamp_col: Name of timestamp column
            periods: Seasonal periods (in hours): 24h (daily), 168h (weekly), 8760h (yearly)
        
        Returns:
            DataFrame with Fourier seasonal features
        """
        if 'fourier_seasonal' not in self.methods:
            return df
        
        logger.info("Creating Fourier seasonal features")
        
        df_copy = df.copy()
        
        if timestamp_col not in df_copy.columns:
            logger.warning(f"Timestamp column '{timestamp_col}' not found, skipping Fourier features")
            return df
        
        # Convert to datetime if not already
        if not pd.api.types.is_datetime64_any_dtype(df_copy[timestamp_col]):
            df_copy[timestamp_col] = pd.to_datetime(df_copy[timestamp_col])
        
        # Hour of day
        df_copy['hour_of_day'] = df_copy[timestamp_col].dt.hour
        
        # Day of week
        df_copy['day_of_week'] = df_copy[timestamp_col].dt.dayofweek
        
        # Day of year
        df_copy['day_of_year'] = df_copy[timestamp_col].dt.dayofyear
        
        # Create Fourier terms
        for period in periods:
            # Calculate phase
            if period == 24:
                phase = 2 * np.pi * df_copy['hour_of_day'] / period
                name = 'daily'
            elif period == 168:
                phase = 2 * np.pi * (df_copy['day_of_week'] * 24 + df_copy['hour_of_day']) / period
                name = 'weekly'
            elif period == 8760:
                phase = 2 * np.pi * (df_copy['day_of_year'] * 24 + df_copy['hour_of_day']) / period
                name = 'yearly'
            else:
                continue
            
            # Sine and cosine components
            df_copy[f'fourier_{name}_sin'] = np.sin(phase)
            df_copy[f'fourier_{name}_cos'] = np.cos(phase)
        
        new_features = len(df_copy.columns) - len(df.columns)
        logger.success(f"Created {new_features} Fourier seasonal features")
        
        return df_copy
    
    def create_domain_specific_features(
        self,
        df: pd.DataFrame,
        hazard_type: str
    ) -> pd.DataFrame:
        """
        Create domain-specific features based on hazard type.
        
        Args:
            df: Input DataFrame
            hazard_type: Type of hazard ('flood', 'drought', 'heatwave')
        
        Returns:
            DataFrame with domain-specific features
        """
        logger.info(f"Creating domain-specific features for {hazard_type}")
        
        df_copy = df.copy()
        
        if hazard_type == 'flood':
            # Cumulative rainfall indicators
            if 'rainfall_1h' in df_copy.columns:
                df_copy['rainfall_6h_cumsum'] = df_copy['rainfall_1h'].rolling(6).sum()
                df_copy['rainfall_24h_cumsum'] = df_copy['rainfall_1h'].rolling(24).sum()
                df_copy['rainfall_7d_cumsum'] = df_copy['rainfall_1h'].rolling(168).sum()
            
            # River level rate of change
            if 'river_level' in df_copy.columns:
                df_copy['river_level_rate_1h'] = df_copy['river_level'].diff(1)
                df_copy['river_level_rate_3h'] = df_copy['river_level'].diff(3)
            
            # Soil saturation proxy
            if 'soil_moisture' in df_copy.columns and 'rainfall_24h' in df_copy.columns:
                df_copy['saturation_index'] = df_copy['soil_moisture'] * df_copy['rainfall_24h']
        
        elif hazard_type == 'drought':
            # Standardized Precipitation Index (SPI) components
            if 'rainfall_1h' in df_copy.columns:
                df_copy['rainfall_30d_total'] = df_copy['rainfall_1h'].rolling(720).sum()
                df_copy['rainfall_90d_total'] = df_copy['rainfall_1h'].rolling(2160).sum()
                
                # Deviation from mean
                mean_30d = df_copy['rainfall_30d_total'].rolling(365*24).mean()
                std_30d = df_copy['rainfall_30d_total'].rolling(365*24).std()
                df_copy['spi_30d'] = (df_copy['rainfall_30d_total'] - mean_30d) / (std_30d + 1e-8)
            
            # Evapotranspiration deficit
            if 'temperature' in df_copy.columns and 'humidity' in df_copy.columns:
                # Simple PET estimate
                df_copy['pet_estimate'] = 0.0023 * (df_copy['temperature'] + 17.8) * (100 - df_copy['humidity'])
        
        elif hazard_type == 'heatwave':
            # Temperature anomaly
            if 'temperature' in df_copy.columns:
                df_copy['temp_30d_mean'] = df_copy['temperature'].rolling(720).mean()
                df_copy['temp_anomaly'] = df_copy['temperature'] - df_copy['temp_30d_mean']
                
                # Consecutive hot days
                df_copy['temp_above_25'] = (df_copy['temperature'] > 25).astype(int)
                df_copy['consecutive_hot_days'] = (
                    df_copy['temp_above_25'].groupby(
                        (df_copy['temp_above_25'] != df_copy['temp_above_25'].shift()).cumsum()
                    ).cumsum()
                )
            
            # Heat stress index
            if 'temperature' in df_copy.columns and 'humidity' in df_copy.columns:
                # Simplified heat index
                T = df_copy['temperature']
                H = df_copy['humidity']
                df_copy['heat_index'] = T + 0.5555 * (6.11 * np.exp(5417.7530 * (1/273.16 - 1/(273.15+T))) * H/100 - 10)
        
        new_features = len(df_copy.columns) - len(df.columns)
        logger.success(f"Created {new_features} domain-specific features for {hazard_type}")
        
        return df_copy
    
    def engineer_all_features(
        self,
        df: pd.DataFrame,
        hazard_type: str,
        timestamp_col: str = 'timestamp'
    ) -> pd.DataFrame:
        """
        Apply all feature engineering methods.
        
        Args:
            df: Input DataFrame
            hazard_type: Type of hazard
            timestamp_col: Name of timestamp column
        
        Returns:
            DataFrame with all engineered features
        """
        logger.info("Starting comprehensive feature engineering")
        
        df_engineered = df.copy()
        
        # Identify numerical columns for rolling/lag features
        numerical_cols = df_engineered.select_dtypes(include=[np.number]).columns.tolist()
        
        # Exclude certain columns from rolling/lag
        exclude_cols = ['latitude', 'longitude', 'elevation']
        numerical_cols = [col for col in numerical_cols if col not in exclude_cols]
        
        # Apply feature engineering methods
        if 'rolling_statistics' in self.methods:
            df_engineered = self.create_rolling_features(df_engineered, numerical_cols)
        
        if 'lag_features' in self.methods:
            df_engineered = self.create_lag_features(df_engineered, numerical_cols)
        
        if 'interaction_terms' in self.methods:
            df_engineered = self.create_interaction_features(df_engineered)
        
        if 'fourier_seasonal' in self.methods:
            df_engineered = self.create_fourier_seasonal_features(df_engineered, timestamp_col)
        
        # Domain-specific features
        df_engineered = self.create_domain_specific_features(df_engineered, hazard_type)
        
        # Fill NaN values from lag/rolling operations (pandas 3 compatible)
        df_engineered = df_engineered.bfill().fillna(0)
        
        total_features = len(df_engineered.columns)
        original_features = len(df.columns)
        new_features = total_features - original_features
        
        logger.success(f"Feature engineering complete: {original_features} â†’ {total_features} features (+{new_features})")
        
        return df_engineered

