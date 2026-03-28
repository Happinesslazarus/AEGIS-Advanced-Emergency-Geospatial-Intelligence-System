const k='AIzaSyAizjjt-xTZtN-KrIIqcJb3m0HVke_EW48';
try {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${k}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:'Reply with just: OK'}]}]})
  });
  const d = await r.json();
  console.log('STATUS:', r.status);
  console.log('RESULT:', JSON.stringify(d).slice(0,300));
} catch(e) {
  console.log('NETWORK_ERROR:', e.message);
}
