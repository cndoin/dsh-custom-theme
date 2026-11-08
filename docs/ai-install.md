# Install with an AI agent

> This document is written **for an assistant with shell access**, not for a human.
> Paste the prompt at the bottom into an agent to install `dsh-custom-theme`.

## Ground rules

1. Never target the **`desktop`** profile. It is owned by the Electron application and
   refuses CLI installs. Use `web` (or another CLI-managed profile).
2. Never hand-edit `dsh.profile.bundles` in a profile's `package.json`. Use
   `dsh plugin --profile <p> add/install/remove`.
3. Never touch `$DSH_HOME/sessions` or any session file. This plugin does not read them.
4. `client.js` is committed and generated. Do **not** run `node scripts/build.mjs` as part
   of installation — there is no build step at install time.
5. If a command fails, report the exact output. Do not retry a destructive command.

## Exact commands

```bash
# 1. Clone into the profile's plugin directory.
git clone https://github.com/cndoin/dsh-custom-theme.git \
  "$HOME/.dsh/plugins/dsh-custom-theme"

# 2. Register as a link dependency and install.
dsh plugin --profile web add link:"$HOME/.dsh/plugins/dsh-custom-theme"
dsh plugin --profile web install

# 3. The host half mounts at process start — restart it.
#    (Stop the running `dsh web`, then start it again.)
```

## Verification

```bash
# The plugin must appear in the profile's bundle list.
grep -A6 '"dsh"' "$HOME/.dsh/profiles/web/package.json"

# The generated client half must be present and non-empty.
wc -c "$HOME/.dsh/plugins/dsh-custom-theme/client.js"

# Optional: run the read-only suite (development only, needs Node >= 22).
cd "$HOME/.dsh/plugins/dsh-custom-theme" && npm test
```

In the GUI, open **Settings → Custom theme**. Paste a theme and click **Apply theme**.
The **Run status** JSON at the bottom of the first card reports whether the plugin is
live (`stylesheetPresent`, `tokenCount`, `layerPresent`).

## Failure-mode table

| Symptom | Cause | Fix |
| --- | --- | --- |
| `declares no dsh.bundle` | pnpm did not create a root link for the `link:` dependency | Create the junction/symlink manually and declare `"dsh-custom-theme": "link:<abs path>"` under `dependencies`, then re-run `dsh plugin --profile web install` |
| `desktop` profile rejects the install | Electron owns that profile | Use `web`, or install through the app's plugin manager instead |
| Settings section missing after install | Host half mounts only at process start | Restart `dsh web` / Harness, then reload the page (`Ctrl+R`) |
| Theme applied but colours unchanged | Paste contained no readable custom-property declarations | Check the **Run status** `warnings`; confirm the paste includes `:root { --…: …; }` |
| Wallpaper selected but not visible | URL rejected, or no theme applied so no shell token was overridden | Check `sourceError` in **Run status**; an https URL or a local image is required |
| Glass frost not visible | Glass is off by default, or host rules win | Enable the switch in the first card; see the README's *Known limitations* |

## Windows notes

Use PowerShell. A junction is required when pnpm skips the root link:

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-custom-theme" `
  -Target "$env:USERPROFILE\.dsh\plugins\dsh-custom-theme"
```

For the **desktop** profile the installed path is already a junction managed by the app;
do not recreate it by hand.

---

## Prompt to paste

```text
Install the DeepSeek Harness plugin `dsh-custom-theme` from
https://github.com/cndoin/dsh-custom-theme into my CLI-managed `web` profile.
Follow docs/ai-install.md in that repository exactly: never target the desktop
profile, never hand-edit bundles, never touch session files, and do not run a
build step (client.js is committed). Clone, `dsh plugin --profile web add link:`,
`dsh plugin --profile web install`, then verify with grep and report the exact
output. If pnpm skips the root link, create the junction/symlink as documented.
Tell me how to restart the host and where the settings section appears.
```
