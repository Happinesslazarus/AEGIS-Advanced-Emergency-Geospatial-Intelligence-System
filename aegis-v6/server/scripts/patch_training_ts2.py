import pathlib

f = pathlib.Path(r'e:\aegis-v6-fullstack\aegis-v6\server\src\services\mlTrainingPipeline.ts')
content = f.read_text(encoding='utf-8')

# Fix: $1, $1 -> $1, $2 for different types (double precision vs integer)
old = "VALUES ('fake_detector', 'heuristic-v2', 'training_rows', $1, $1)\n    `, [rows.length])"
new = "VALUES ('fake_detector', 'heuristic-v2', 'training_rows', $1, $2)\n    `, [rows.length, rows.length])"
assert old in content, f"Could not find: {repr(old)}"
content = content.replace(old, new)

f.write_text(content, encoding='utf-8')
print("Fixed $1,$1 -> $1,$2 in fake_detector INSERT")
