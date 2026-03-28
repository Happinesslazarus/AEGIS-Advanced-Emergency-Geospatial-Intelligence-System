f = r'e:\aegis-v6-fullstack\aegis-v6\server\scripts\train_all_models.py'
t = open(f).read()
t = t.replace(
    'Path(__file__).parent.parent / "ai-engine"',
    'Path(__file__).parent.parent.parent / "ai-engine"'
)
open(f, 'w').write(t)
print('patched', t.count('parent.parent.parent'), 'occurrences')
