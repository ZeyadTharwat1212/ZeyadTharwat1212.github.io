"""Bump the app version everywhere at once: python tests/tools/bump.py 11
?v=N on every asset tag, sw.js cache name + shell list, APP_VER in app.js, kateb/version.json."""
import json, re, sys
N = sys.argv[1]
for f in ('kateb.html', 'hanan.html', 'index.html', 'setup.html', 'sw.js'):
    s = open(f, encoding='utf8').read()
    s = re.sub(r'\?v=\d+', '?v=' + N, s)
    if f == 'sw.js': s = re.sub(r"var CACHE = 'kateb-v\d+';", "var CACHE = 'kateb-v%s';" % N, s)
    open(f, 'w', encoding='utf8').write(s)
s = open('kateb/app.js', encoding='utf8').read()
s = re.sub(r"var APP_VER = '\d+';", "var APP_VER = '%s';" % N, s)
open('kateb/app.js', 'w', encoding='utf8').write(s)
json.dump({'v': N}, open('kateb/version.json', 'w'))
print('version', N)
