import base64, io, os, re
from mobile_block import MOBILE


# Generate the browser-safe Supabase configuration from Vercel environment variables.
# The Publishable/anon key is intended for frontend use; never use a service-role key here.
supabase_url = os.environ.get("SUPABASE_URL", "").strip()
supabase_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
if not supabase_url or not supabase_key:
    raise SystemExit("Missing SUPABASE_URL or SUPABASE_ANON_KEY in the Vercel environment.")

config_js = """window.HW_SUPABASE_CONFIG = {
  url: %r,
  anonKey: %r,
  workspaceId: '00000000-0000-0000-0000-000000000001'
};
""" % (supabase_url, supabase_key)

io.open("supabase-config.js", "w", encoding="utf-8").write(config_js)

SRC = 'shell.template.html'
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
