 * Download benchmark images from Pexels (confirmed working source).
 * Creates local image cache at server/uploads/chat/benchmark/
 * 
 * Run: node scripts/download_benchmark_pexels.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'server', 'uploads', 'chat', 'benchmark');

// Pexels URLs: ?auto=compress&cs=tinysrgb&w=640 gives ~50-80KB JPEGs
// Each entry: [id, pexels_photo_id, expected_type, expected_severity, description]
const IMAGES = [
  // WILDFIRE (6)
  ["wf-001", "https://images.pexels.com/photos/51951/forest-fire-fire-smoke-conservation-51951.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "high", "Forest fire with flames and smoke"],
  ["wf-002", "https://images.pexels.com/photos/3552472/pexels-photo-3552472.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "critical", "Wildfire engulfing trees at night"],
  ["wf-003", "https://images.pexels.com/photos/266487/pexels-photo-266487.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "high", "Fire burning in dry grassland"],
  ["wf-004", "https://images.pexels.com/photos/5504656/pexels-photo-5504656.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "critical", "Large wildfire with thick smoke plume"],
  ["wf-005", "https://images.pexels.com/photos/3867212/pexels-photo-3867212.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "high", "Burning vegetation hillside fire"],
  ["wf-006", "https://images.pexels.com/photos/9319890/pexels-photo-9319890.jpeg?auto=compress&cs=tinysrgb&w=640", "wildfire", "moderate", "Smoldering aftermath of fire"],

  // FLOOD (6)
  ["fl-001", "https://images.pexels.com/photos/1739855/pexels-photo-1739855.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "high", "Flooded residential area with stilted house"],
  ["fl-002", "https://images.pexels.com/photos/1446076/pexels-photo-1446076.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "high", "Flooding in urban area with submerged roads"],
  ["fl-003", "https://images.pexels.com/photos/3502542/pexels-photo-3502542.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "critical", "Severe flooding with submerged buildings"],
  ["fl-004", "https://images.pexels.com/photos/3862369/pexels-photo-3862369.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "high", "Flash flood water rushing through area"],
  ["fl-005", "https://images.pexels.com/photos/5531109/pexels-photo-5531109.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "moderate", "Flooded street with standing water"],
  ["fl-006", "https://images.pexels.com/photos/6471927/pexels-photo-6471927.jpeg?auto=compress&cs=tinysrgb&w=640", "flood", "high", "Flooding aftermath with debris"],

  // EARTHQUAKE (4)
  ["eq-001", "https://images.pexels.com/photos/6646917/pexels-photo-6646917.jpeg?auto=compress&cs=tinysrgb&w=640", "earthquake", "critical", "Collapsed building from earthquake"],
  ["eq-002", "https://images.pexels.com/photos/6646918/pexels-photo-6646918.jpeg?auto=compress&cs=tinysrgb&w=640", "earthquake", "critical", "Earthquake rubble and destruction"],
  ["eq-003", "https://images.pexels.com/photos/6646921/pexels-photo-6646921.jpeg?auto=compress&cs=tinysrgb&w=640", "earthquake", "high", "Cracked walls from seismic damage"],
  ["eq-004", "https://images.pexels.com/photos/11655025/pexels-photo-11655025.jpeg?auto=compress&cs=tinysrgb&w=640", "earthquake", "critical", "Destroyed buildings after earthquake"],

  // STORM (6)
  ["st-001", "https://images.pexels.com/photos/1119974/pexels-photo-1119974.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "high", "Dark storm clouds with lightning"],
  ["st-002", "https://images.pexels.com/photos/1162251/pexels-photo-1162251.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "moderate", "Severe thunderstorm approaching"],
  ["st-003", "https://images.pexels.com/photos/2527458/pexels-photo-2527458.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "high", "Storm damage to trees and structures"],
  ["st-004", "https://images.pexels.com/photos/1118869/pexels-photo-1118869.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "critical", "Tornado funnel cloud approaching"],
  ["st-005", "https://images.pexels.com/photos/2529973/pexels-photo-2529973.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "moderate", "Storm with heavy rain and wind"],
  ["st-006", "https://images.pexels.com/photos/2406391/pexels-photo-2406391.jpeg?auto=compress&cs=tinysrgb&w=640", "storm", "high", "Dramatic storm sky with dark clouds"],

  // LANDSLIDE (4)
  ["ls-001", "https://images.pexels.com/photos/7537440/pexels-photo-7537440.jpeg?auto=compress&cs=tinysrgb&w=640", "landslide", "high", "Landslide with displaced earth on hillside"],
  ["ls-002", "https://images.pexels.com/photos/7537441/pexels-photo-7537441.jpeg?auto=compress&cs=tinysrgb&w=640", "landslide", "critical", "Massive landslide blocking road"],
  ["ls-003", "https://images.pexels.com/photos/14713929/pexels-photo-14713929.jpeg?auto=compress&cs=tinysrgb&w=640", "landslide", "moderate", "Slope failure on mountain"],
  ["ls-004", "https://images.pexels.com/photos/7537444/pexels-photo-7537444.jpeg?auto=compress&cs=tinysrgb&w=640", "landslide", "high", "Debris flow covering terrain"],

  // DROUGHT (4)
  ["dr-001", "https://images.pexels.com/photos/60013/desert-drought-dehydrated-clay-soil-60013.jpeg?auto=compress&cs=tinysrgb&w=640", "drought", "moderate", "Cracked dry earth from drought"],
  ["dr-002", "https://images.pexels.com/photos/1701209/pexels-photo-1701209.jpeg?auto=compress&cs=tinysrgb&w=640", "drought", "high", "Barren drought-stricken landscape"],
  ["dr-003", "https://images.pexels.com/photos/4226866/pexels-photo-4226866.jpeg?auto=compress&cs=tinysrgb&w=640", "drought", "high", "Dead vegetation in drought conditions"],
  ["dr-004", "https://images.pexels.com/photos/1542495/pexels-photo-1542495.jpeg?auto=compress&cs=tinysrgb&w=640", "drought", "moderate", "Dried cracked mud from water shortage"],

  // STRUCTURAL DAMAGE (4)
  ["sd-001", "https://images.pexels.com/photos/6646914/pexels-photo-6646914.jpeg?auto=compress&cs=tinysrgb&w=640", "structural_damage", "critical", "Collapsed building rubble"],
  ["sd-002", "https://images.pexels.com/photos/5531101/pexels-photo-5531101.jpeg?auto=compress&cs=tinysrgb&w=640", "structural_damage", "high", "Damaged structure after disaster"],
  ["sd-003", "https://images.pexels.com/photos/6646922/pexels-photo-6646922.jpeg?auto=compress&cs=tinysrgb&w=640", "structural_damage", "critical", "Infrastructure failure and collapse"],
  ["sd-004", "https://images.pexels.com/photos/12377792/pexels-photo-12377792.jpeg?auto=compress&cs=tinysrgb&w=640", "structural_damage", "high", "Building with severe damage"],

  // HEATWAVE (2)
  ["hw-001", "https://images.pexels.com/photos/3571551/pexels-photo-3571551.jpeg?auto=compress&cs=tinysrgb&w=640", "heatwave", "high", "Sun blazing over dry parched area"],
  ["hw-002", "https://images.pexels.com/photos/1480690/pexels-photo-1480690.jpeg?auto=compress&cs=tinysrgb&w=640", "heatwave", "moderate", "Heat haze over hot dry landscape"],

  // SAFE (6)
  ["sf-001", "https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Clear sunny day cityscape"],
  ["sf-002", "https://images.pexels.com/photos/106399/pexels-photo-106399.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Peaceful suburban house"],
  ["sf-003", "https://images.pexels.com/photos/1550913/pexels-photo-1550913.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Green park with trees on clear day"],
  ["sf-004", "https://images.pexels.com/photos/1105766/pexels-photo-1105766.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Normal busy street scene"],
  ["sf-005", "https://images.pexels.com/photos/462118/pexels-photo-462118.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Scenic landscape no hazards"],
  ["sf-006", "https://images.pexels.com/photos/1770809/pexels-photo-1770809.jpeg?auto=compress&cs=tinysrgb&w=640", "safe", "none", "Sunset over calm water"],
];

async function downloadImage(url, destPath) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'AEGIS/1.0' },
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  
  // Verify it's an actual image (JPEG starts with ff d8)
  if (buf.length < 1000) throw new Error(`Too small: ${buf.length} bytes`);
  const magic = buf.slice(0, 2).toString('hex');
  if (magic !== 'ffd8' && magic !== '8950') {
    throw new Error(`Not an image: magic=${magic}, first chars=${buf.slice(0, 20).toString()}`);
  }
  
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Downloading ${IMAGES.length} benchmark images to ${OUTPUT_DIR}\n`);

  let success = 0;
  const failed = [];
  const benchmarkEntries = [];

  for (let i = 0; i < IMAGES.length; i++) {
    const [id, url, type, severity, desc] = IMAGES[i];
    const dest = path.join(OUTPUT_DIR, `${id}.jpg`);

    // Skip if already cached
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      const sz = fs.statSync(dest).size;
      console.log(`[${i + 1}/${IMAGES.length}] ${id}: Already cached (${sz.toLocaleString()} bytes)`);
      benchmarkEntries.push({
        id, url, local_path: `/uploads/chat/benchmark/${id}.jpg`,
        expected_type: type, expected_severity: severity, description: desc,
      });
      success++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${IMAGES.length}] ${id}: ${desc.slice(0, 50)}... `);
    try {
      const sz = await downloadImage(url, dest);
      console.log(`✅ ${sz.toLocaleString()} bytes`);
      benchmarkEntries.push({
        id, url, local_path: `/uploads/chat/benchmark/${id}.jpg`,
        expected_type: type, expected_severity: severity, description: desc,
      });
      success++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failed.push(id);
      // Still add entry without local_path
      benchmarkEntries.push({
        id, url, expected_type: type, expected_severity: severity, description: desc,
      });
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  // Write updated benchmark JSON
  const benchmarkData = {
    metadata: {
      name: "AEGIS Vision Benchmark v2.0",
      description: "Labeled disaster images (Pexels) for evaluating vision analysis accuracy",
      created: new Date().toISOString().split('T')[0],
      categories: ["wildfire", "flood", "earthquake", "storm", "landslide", "drought", "structural_damage", "heatwave", "safe"],
      total_images: benchmarkEntries.length,
      sources: ["Pexels (free license)"],
      usage: "Run: python scripts/evaluate_vision.py --report"
    },
    benchmark: benchmarkEntries,
  };

  const benchmarkPath = path.join(__dirname, 'aegis-v6', 'ai-engine', 'data', 'vision_benchmark.json');
  fs.writeFileSync(benchmarkPath, JSON.stringify(benchmarkData, null, 2));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  Downloaded: ${success}/${IMAGES.length}`);
  if (failed.length) console.log(`  Failed: ${failed.join(', ')}`);
  console.log(`  Benchmark JSON updated: ${benchmarkPath}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

