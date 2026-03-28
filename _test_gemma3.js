const fs = require('fs');

async function testModel(modelName, imgPath) {
  const img = fs.readFileSync(imgPath);
  const b64 = img.toString('base64');
  console.log(`\n=== ${modelName} on ${imgPath.split('/').pop()} ===`);
  const start = Date.now();
  const prompt = `Describe this image in detail. What objects, events, or hazards do you see? If there is a natural disaster or emergency (fire, flood, earthquake, storm, landslide, drought, structural damage, etc.), identify it. Then output a JSON block:

\`\`\`json
{"disaster_type": "wildfire or flood or earthquake or severe_storm or landslide or drought or infrastructure_damage or heatwave or safe", "severity": "critical or high or moderate or low or none", "confidence": 85, "scene_description": "one sentence"}
\`\`\``;

  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: modelName,
        prompt,
        images: [b64],
        stream: false,
        options: { temperature: 0.2, num_predict: 1024 }
      })
    });
    console.log('HTTP', res.status);
    if (!res.ok) { console.log(await res.text()); return; }
    const d = await res.json();
    console.log('Time:', Date.now()-start, 'ms');
    console.log(d.response);
  } catch(e) { console.log('ERR:', e.message); }
}

(async () => {
  const base = 'e:/aegis-v6-fullstack/aegis-v6/server/uploads/chat/benchmark';
  // Test both models on wildfire and earthquake
  await testModel('granite3.2-vision:2b', `${base}/wf-001.jpg`);
  await testModel('granite3.2-vision:2b', `${base}/eq-001.jpg`);
})();
