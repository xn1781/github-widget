# 🐙 GitHub → Discord Widget

A live GitHub stats tracker for a [Discord profile widget](https://chloecinders.com/blog/discord-widgets).
A GitHub Action runs every 30 minutes, pulls your stats, and `PATCH`es them into
your widget. Each stat's icon **reacts to your numbers** — hit a streak and it
bursts into 🔥.

## The 6 stats

| # | Stat | Base icon | Reacts to |
|---|------|-----------|-----------|
| 1 | Current streak | 🔥 | 😴 broken · 🔥 active · 🌋 30d+ · ☄️ 100d+ |
| 2 | Contributions today | ⚡ | ☕ none yet · ⚡ shipped · 🚀 10+ |
| 3 | Contributions this year | 📈 | 📈 · 🚀 1k+ · 🛸 5k+ |
| 4 | Total stars | ⭐ | ⭐ · 🌟 100+ · 🏆 1k+ |
| 5 | Followers | 👥 | 👥 · 🎉 100+ · 👑 1k+ |
| 6 | Public repos | 📦 | 📦 · 📚 25+ · 🏛️ 50+ |

The top logo uses your GitHub avatar automatically.

## Changing icons

Icons are just emoji rendered as PNGs via a CDN — no image hosting needed.
Open [index.js](index.js), find the `ICON` block, and swap any emoji codepoint
(the hex from [emojipedia](https://emojipedia.org), without the `U+`). The
thresholds that decide *when* an icon changes live in `buildStats()` — each
`pickIcon(value, base, [[threshold, icon], ...])` call.

Want to track something else entirely? Edit the corresponding entry in
`buildStats()` — return a `{ title, label, icon }` and it maps straight onto
`statNTitle` / `statNLabel` / `statNLogo`.

## The logo (circular fading pfp)

The top banner is **rendered** by [render-logo.js](render-logo.js): it takes your
GitHub avatar, cuts it into a circle, and fades it out into the card so it blends
in instead of looking like a pasted-on square. The workflow runs the renderer,
commits the result to `assets/logo.png` (only when it changes), and `index.js`
points the widget's `logo` at that file's raw URL (with a content hash so Discord
refetches only when the image actually changes).

Tune the look in the `RENDER` block of [render-logo.js](render-logo.js) — circle
position/size (`cx`, `cy`, `r`), edge softness (`coreStop`), and the left fade
(`fadeFrom`, `fadeTo`). Re-run `node render-logo.js` to preview `assets/logo.png`.

Prefer a completely custom image? Set the `LOGO_URL` env var to any URL and it's
used as-is (skips rendering).

## Setup

### 1. Widget config field mapping

The code fills these fields (from your widget config JSON). Per stat:
`statNTitle` = the big value, `statNLabel` = the caption, `statNLogo` = the icon.
Plus `logo`, `tracking` (`@username`), and `updatesEvery`.

### 2. Secrets & variables

In your repo → **Settings → Secrets and variables → Actions**:

**Variables** (Variables tab):
- `GH_USERNAME` — the GitHub user to track

**Secrets** (Secrets tab):
- `GH_TOKEN` — a **classic** [Personal Access Token](https://github.com/settings/tokens)
  with the read-only `read:user` scope (the default `GITHUB_TOKEN` can't read
  the contribution graph)
- `DISCORD_APP_ID` — your Discord application ID
- `DISCORD_USER_ID` — your Discord user ID
- `DISCORD_BOT_TOKEN` — your bot token

### 3. Run it

Push to GitHub, then go to the **Actions** tab and run **Update Discord Widget**
manually once to confirm it works. After that it runs every 30 minutes on its own.

## Test locally (no Discord needed)

Without the Discord secrets the script does a **dry run** and just prints the
payload — handy for previewing:

```bash
npm install               # for the logo renderer
cp .env.example .env      # fill in GH_TOKEN + GH_USERNAME
node render-logo.js       # preview assets/logo.png
node --env-file=.env index.js
```

## How the update works

A single `PATCH` to your application identity profile:

```
PATCH https://discord.com/api/v9/applications/{appId}/users/{userId}/identities/0/profile
Authorization: Bot {botToken}
Content-Type: application/json

{ "data": { "dynamic": [ { "type": 1, "name": "stat1Title", "value": "12 days" }, ... ] } }
```

Field types: `1` = string, `2` = number, `3` = image `{ url }`. The `name`s must
match the Data Fields in your widget config.
