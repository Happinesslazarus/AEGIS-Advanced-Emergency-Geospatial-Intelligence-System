import pathlib

f = pathlib.Path(r'e:\aegis-v6-fullstack\aegis-v6\server\src\services\mlTrainingPipeline.ts')
content = f.read_text(encoding='utf-8')

# Fix 1: r.title -> r.incident_category  
old1 = 'r.id, r.title, r.description, r.severity, r.ai_confidence,'
new1 = 'r.id, r.incident_category, r.description, r.severity, r.ai_confidence,'
assert old1 in content, f"Could not find: {old1}"
content = content.replace(old1, new1)

f.write_text(content, encoding='utf-8')
print("Fixed r.title -> r.incident_category")
