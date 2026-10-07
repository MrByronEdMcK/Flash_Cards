with open('sw.js', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("const CACHE_NAME = 'studycards-v1';", "const CACHE_NAME = 'studycards-v2';")
with open('sw.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Bumped sw.js cache to studycards-v2')
