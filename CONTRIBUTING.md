# Working on this project

## The one rule

**Edit `dashboards/*.html` or `shell.template.html`, never
`Homeweavers_Workspace.html`.** That file is generated. Editing it directly
works until the next build silently discards your change.

## Making a change

```bash
# 1. edit the source
vim dashboards/attendance.html

# 2. rebuild
python3 build.py

# 3. check every dashboard still parses
node -e "
const fs=require('fs');
const all=fs.readFileSync('Homeweavers_Workspace.html','utf8');
['inventory','products','orders','financial','attendance','containers'].forEach(n=>{
  const m=new RegExp('id=\"src-'+n+'\">\\\\n([\\\\s\\\\S]*?)\\\\n?</script>').exec(all);
  const h=Buffer.from(m[1],'base64').toString('utf8');
  let e=0;[...h.matchAll(/<script(?![^>]*type=\"(text\/plain|application\/json)\")[^>]*>([\s\S]*?)<\/script>/g)]
    .forEach(x=>{try{new Function(x[2]);}catch(err){e++;}});
  console.log(n, e ? 'SYNTAX ERROR' : 'clean');
});
"

# 4. open the file and click through what you touched
# 5. commit both the source and the built file
git add dashboards/attendance.html Homeweavers_Workspace.html
git commit -m "what changed"
git push
```

## Why the syntax check is not enough

It catches a broken file. It does not catch a file that parses and then throws
on load, which leaves a blank page and no error anyone will see. Both have
happened here:

- A function defined inside another one, called from outside it — valid syntax,
  `ReferenceError` at runtime, blank dashboard.
- A string replacement anchored on text that appeared twice — the second match
  was inside a JavaScript string, and the edit deleted 18,000 characters of
  working code.

**Anchor edits on text you have confirmed is unique**, and open the dashboard
afterwards.

## Things that have bitten before

- **`</body>` appears inside a JavaScript string** in `attendance.html`, where
  the salary slip builds a printable page. Append to the *last* one.
- **Blobs do not survive `JSON.stringify`** — it turns them into `{}` silently.
  Anything serialising uploaded files must encode them first.
- **Two elements sharing an id** — wiring binds to whichever comes first, which
  may be the hidden one.
- **Native `confirm()` returns false** once a browser suppresses dialogs, so a
  button appears to do nothing. Confirm in the page instead.
- **CSS collisions**: a `:hover` rule on a base class can override a modifier's
  colour and leave white text on white.

## Style

Comments explain *why*, not what. A comment saying what the next line does is
noise; one saying why it is written that way stops the next person undoing it.
