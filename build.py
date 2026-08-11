import base64, io, os, re
from mobile_block import MOBILE

SRC = 'shell.template.html'

# Inject Supabase browser configuration from Vercel build-time environment
# variables. The publishable/anon key is intended for browser use; never use
# the service-role/secret key here.
supabase_url = os.environ.get('SUPABASE_URL', '').strip()
supabase_key = os.environ.get('SUPABASE_ANON_KEY', '').strip()
if not supabase_url or not supabase_key:
    raise SystemExit('Missing SUPABASE_URL or SUPABASE_ANON_KEY in the Vercel build environment.')
if 'YOUR_' in supabase_key or 'YOUR-PROJECT' in supabase_url:
    raise SystemExit('SUPABASE_URL/SUPABASE_ANON_KEY still contain placeholder values.')

config = "/* Generated at build time from Vercel Environment Variables. */\nwindow.HW_SUPABASE_CONFIG = {\n  url: %r,\n  anonKey: %r,\n  workspaceId: '00000000-0000-0000-0000-000000000001'\n};\n" % (supabase_url, supabase_key)
io.open('supabase-config.js','w',encoding='utf-8').write(config)

shell = io.open(SRC, encoding='utf-8').read()

for name in ['inventory','products','orders','financial','attendance','containers']:
    path = 'dashboards/%s.html' % name
    if not os.path.exists(path):
        continue
    body = io.open(path, encoding='utf-8').read()
    # One responsive layer for every dashboard, appended at the true end of the
    # document - replacing the first '</body>' once hit one inside a JS string.
    body = body.replace('<style id="hw-mobile">', '<!--stale-mobile-->')
    i = body.rfind('</body>')
    body = (body + MOBILE) if i == -1 else (body[:i] + MOBILE + '\n' + body[i:])
    enc  = base64.b64encode(body.encode('utf-8')).decode('ascii')
    # The trailing newline is optional: an empty slot in the template has none.
    pat  = re.compile(r'(id="src-%s">\n)(.*?)(\n?</script>)' % name, re.S)
    m = pat.search(shell)
    assert m, 'no slot for ' + name
    shell = shell[:m.start(2)] + enc + shell[m.end(2):]

io.open('index.html','w',encoding='utf-8').write(shell)
print('built %d bytes' % len(shell))
