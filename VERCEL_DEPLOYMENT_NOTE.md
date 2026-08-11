# Vercel deployment note

This repository is intentionally deployed as a static HTML application.

- Framework Preset: **Other**
- Build Command: **empty / disabled**
- Output Directory: **empty / root**
- The ready-to-serve file is `Homeweavers_Workspace.html`.
- `vercel.json` explicitly overrides the Build Command to `null`, so Vercel does not try to run `build.py`.

`build.py` is retained for local development when dashboard source files are changed. Run `python3 build.py` locally, commit the regenerated `Homeweavers_Workspace.html`, and deploy.

If Vercel still reports `Cannot read properties of undefined (reading 'fsPath')` before the build starts, check the Vercel Project Environment Variables and remove any manually pinned `VERCEL_CLI_VERSION`; then redeploy with **Use existing Build Cache disabled**.
