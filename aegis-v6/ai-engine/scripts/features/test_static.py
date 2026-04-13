"""Quick test for static features extraction."""
import ee, os, time
import geopandas as gpd

project = os.getenv('GEE_PROJECT', 'aegis-disaster-intelligence')
ee.Initialize(project=project)

gdf = gpd.read_file('data/labels/uk_sample_points.geojson')
pts50 = gdf.iloc[:50]
features_ee = [
    ee.Feature(ee.Geometry.Point([r.geometry.x, r.geometry.y]), {'grid_id': str(r['grid_id'])})
    for _, r in pts50.iterrows()
]
pts_ee = ee.FeatureCollection(features_ee)

# Test with impervious computation using 500m kernel
try:
    t0 = time.time()
    srtm = ee.Image('USGS/SRTMGL1_003').select(['elevation'])
    slope = ee.Terrain.slope(srtm).rename('basin_slope')
    wc_raw = ee.ImageCollection('ESA/WorldCover/v200').mosaic().select(['Map'])
    wc_buildup = wc_raw.eq(50).rename('buildup_mask')
    impervious = wc_buildup.reduceNeighborhood(
        reducer=ee.Reducer.mean(),
        kernel=ee.Kernel.circle(radius=500, units='meters'),
    ).rename('impervious_surface_ratio')
    combined = srtm.addBands(slope).addBands(wc_raw.rename('land_use')).addBands(impervious)
    sampled = combined.sampleRegions(collection=pts_ee, scale=500, geometries=True)
    result = sampled.getInfo()
    n = len(result['features'])
    elapsed = time.time() - t0
    print(f'Features with impervious (500m kernel): {n}  ({elapsed:.1f}s)')
    if n > 0:
        print('Sample:', result['features'][0]['properties'])
except Exception as e:
    print('ERROR with impervious:', e)
