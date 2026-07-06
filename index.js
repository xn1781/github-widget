/**
 * GitHub → Discord Widget tracker
 * --------------------------------
 * Pulls live stats from the GitHub API and pushes them into a Discord
 * profile widget by PATCHing your application identity profile.
 *
 * The widget shows 6 stats, each with an ICON that reacts to your numbers:
 *   1. Current streak      🔥  (grows: 🔥 → 🌋 → ☄️, dies to 😴)
 *   2. Contributions today ⚡  (☕ when idle, 🚀 when you're grinding)
 *   3. Contributions (year)📈  (🚀 / 🛸 at higher tiers)
 *   4. Total stars         ⭐  (🌟 / 🏆 at milestones)
 *   5. Followers           👥  (🎉 / 👑 at milestones)
 *   6. Public repos        📦  (📚 / 🏛️ at milestones)
 *
 * Everything visual lives in the ICONS + STAT builders below, so it's easy
 * to tweak. Icons are just emoji rendered as PNGs via a CDN — swap the emoji
 * and you swap the image, no hosting needed.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ------------------------------------------------------------------ */
/*  CONFIG — edit these (or set them as environment variables/secrets) */
/* ------------------------------------------------------------------ */

const CONFIG = {
  // GitHub user to track.
  username: process.env.GH_USERNAME || "xn1781",

  // Top-of-widget banner image. Leave blank to use your GitHub avatar.
  // This slot is rendered WIDE, so a landscape/banner image (e.g. ~600x240)
  // looks far better than a square avatar. Drop any image URL here.
  logoUrl: process.env.LOGO_URL || "",

  // The logo slot is wide, so we reframe whatever image we send through a
  // free image proxy (images.weserv.nl) to fit it nicely — no hosting needed.
  banner: {
    enabled: true,
    width: 600,
    height: 240,
    // "cover"   = smart-fill the whole banner, auto-focus the subject
    // "contain" = show the entire image, letterboxed on `bg` (no crop)
    fit: "cover",
    focus: "attention", // focal point for cover: attention | entropy | center | top …
    bg: "0d1117", // background for contain (card's dark color)
  },

  // Small text shown on the widget so viewers know how fresh it is.
  // Keep this in sync with the cron schedule in the workflow.
  updateLabel: process.env.UPDATE_LABEL || "updates every 30 min",

  // GitHub Personal Access Token (classic, read-only `read:user` scope is
  // enough). Needed for the contribution graph / streak query. In GitHub
  // Actions pass a PAT — the default GITHUB_TOKEN can't read the graph.
  githubToken: process.env.GH_TOKEN,

  // Discord credentials for pushing the widget update.
  discord: {
    appId: process.env.DISCORD_APP_ID,
    userId: process.env.DISCORD_USER_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
  },
};

/* ------------------------------------------------------------------ */
/*  ICONS — change any emoji here to restyle the widget                */
/*  Find codepoints at https://emojipedia.org (use the hex, no U+).    */
/* ------------------------------------------------------------------ */

// Renders any emoji as a 72×72 PNG. This is what makes icons swappable:
// just change the emoji codepoint.
const emoji = (code) =>
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`;

const ICON = {
  // top-of-widget logo (falls back to your GitHub avatar at runtime)
  github: emoji("1f419"), // 🐙

  // streak
  sleep: emoji("1f634"), // 😴  streak broken
  fire: emoji("1f525"), // 🔥  on a streak
  volcano: emoji("1f30b"), // 🌋  30+ days
  comet: emoji("2604"), //  ☄️  100+ days

  // today
  coffee: emoji("2615"), // ☕  nothing yet today
  bolt: emoji("26a1"), // ⚡  shipped today
  rocket: emoji("1f680"), // 🚀  10+ today / 1k+ year

  // year
  chart: emoji("1f4c8"), // 📈
  ufo: emoji("1f6f8"), // 🛸  5k+

  // stars
  star: emoji("2b50"), // ⭐
  glowstar: emoji("1f31f"), // 🌟  100+
  trophy: emoji("1f3c6"), // 🏆  1k+

  // followers
  people: emoji("1f465"), // 👥
  party: emoji("1f389"), // 🎉  100+
  crown: emoji("1f451"), // 👑  1k+

  // repos
  box: emoji("1f4e6"), // 📦
  books: emoji("1f4da"), // 📚  25+
  temple: emoji("1f3db"), // 🏛️  50+
};

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const fmt = (n) => Number(n).toLocaleString("en-US");
const days = (n) => `${fmt(n)} ${n === 1 ? "day" : "days"}`;

// Pick the highest tier the value reaches. `tiers` is [[threshold, icon], ...]
// ascending; `base` is used when nothing matches.
function pickIcon(value, base, tiers = []) {
  let icon = base;
  for (const [min, ic] of tiers) if (value >= min) icon = ic;
  return icon;
}

// Widget field constructors (see blog: type 1 = string, type 3 = image URL).
const strField = (name, value) => ({ type: 1, name, value: String(value) });
const imgField = (name, url) => ({ type: 3, name, value: { url } });

// Reframe the logo image to fit the wide banner slot via a free image proxy,
// so a square avatar doesn't get awkwardly cropped. Returns url unchanged if
// banner reframing is disabled.
function reframeBanner(url) {
  const b = CONFIG.banner;
  if (!b.enabled) return url;
  const q = new URLSearchParams({
    url: "ssl:" + url.replace(/^https?:\/\//, ""),
    w: String(b.width),
    h: String(b.height),
    fit: b.fit,
  });
  if (b.fit === "cover") q.set("a", b.focus);
  else q.set("bg", b.bg);
  return `https://images.weserv.nl/?${q.toString()}`;
}

// Decide which URL to use for the top logo, in priority order:
//   1. an explicit LOGO_URL override
//   2. the pre-rendered circular banner committed at assets/logo.png (when
//      running in Actions) — referenced by raw URL + a content hash so Discord
//      only refetches when the image actually changes
//   3. fallback: reframe the live avatar through the image proxy
function resolveLogo(avatarUrl) {
  if (CONFIG.logoUrl) return CONFIG.logoUrl;

  const local = path.join(__dirname, "assets", "logo.png");
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo", set by Actions
  const ref = process.env.GITHUB_REF_NAME || "main";
  if (repo && fs.existsSync(local)) {
    const hash = crypto
      .createHash("md5")
      .update(fs.readFileSync(local))
      .digest("hex")
      .slice(0, 10);
    // `h` = content hash (identity); `v` = per-run buster so Discord's image
    // proxy always refetches instead of serving a stale/cached response.
    const bust = process.env.GITHUB_RUN_ID || Date.now();
    return `https://raw.githubusercontent.com/${repo}/${ref}/assets/logo.png?h=${hash}&v=${bust}`;
  }

  return reframeBanner(avatarUrl || ICON.github);
}

/* ------------------------------------------------------------------ */
/*  GitHub data fetching                                               */
/* ------------------------------------------------------------------ */

function ghHeaders() {
  const h = {
    "User-Agent": "github-widget",
    Accept: "application/vnd.github+json",
  };
  if (CONFIG.githubToken) h.Authorization = `Bearer ${CONFIG.githubToken}`;
  return h;
}

// Contribution calendar (last ~365 days) via GraphQL. Requires a token.
async function fetchContributions(username) {
  if (!CONFIG.githubToken) {
    console.warn("⚠️  No GH_TOKEN set — streak/contributions will be 0.");
    return { total: 0, days: [], avatarUrl: null };
  }

  const query = `
    query($login: String!) {
      user(login: $login) {
        avatarUrl
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  const json = await res.json();
  if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors));

  const user = json.data.user;
  const cal = user.contributionsCollection.contributionCalendar;
  const flat = cal.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { total: cal.totalContributions, days: flat, avatarUrl: user.avatarUrl };
}

// current streak (today may still be 0 without breaking it) + longest streak
function computeStreaks(dayList) {
  let longest = 0;
  let run = 0;
  for (const d of dayList) {
    if (d.contributionCount > 0) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let i = dayList.length - 1; i >= 0; i--) {
    if (dayList[i].contributionCount > 0) {
      current++;
    } else if (i === dayList.length - 1) {
      continue; // today isn't done yet — don't count, don't break
    } else {
      break;
    }
  }

  const today = dayList.length ? dayList[dayList.length - 1].contributionCount : 0;
  return { current, longest, today };
}

// public profile: followers + public repo count + avatar
async function fetchProfile(username) {
  const res = await fetch(`https://api.github.com/users/${username}`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub user ${res.status}: ${await res.text()}`);
  return res.json();
}

// total stars across all owned, non-forked repos
async function fetchTotalStars(username) {
  let stars = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner`,
      { headers: ghHeaders() }
    );
    if (!res.ok) throw new Error(`GitHub repos ${res.status}: ${await res.text()}`);
    const repos = await res.json();
    if (!Array.isArray(repos) || repos.length === 0) break;
    for (const r of repos) if (!r.fork) stars += r.stargazers_count;
    if (repos.length < 100) break;
  }
  return stars;
}

/* ------------------------------------------------------------------ */
/*  Build the 6 stats (value + label + reactive icon)                  */
/*  Title = the big value, Label = the caption underneath.             */
/* ------------------------------------------------------------------ */

function buildStats({ streaks, contribTotal, stars, followers, repos }) {
  const { current, longest, today } = streaks;

  return [
    // 1 — current streak 🔥
    {
      title: current > 0 ? days(current) : "0 days",
      label: current > 0 ? `best: ${days(longest)}` : "start a new streak!",
      icon:
        current === 0
          ? ICON.sleep
          : pickIcon(current, ICON.fire, [
              [30, ICON.volcano],
              [100, ICON.comet],
            ]),
    },
    // 2 — contributions today ⚡
    {
      title: fmt(today),
      label: today === 0 ? "quiet so far today" : "contributions today",
      icon:
        today === 0
          ? ICON.coffee
          : pickIcon(today, ICON.bolt, [[10, ICON.rocket]]),
    },
    // 3 — contributions in the past year 📈
    {
      title: fmt(contribTotal),
      label: "contributions this year",
      icon: pickIcon(contribTotal, ICON.chart, [
        [1000, ICON.rocket],
        [5000, ICON.ufo],
      ]),
    },
    // 4 — total stars ⭐
    {
      title: fmt(stars),
      label: "stars earned",
      icon: pickIcon(stars, ICON.star, [
        [100, ICON.glowstar],
        [1000, ICON.trophy],
      ]),
    },
    // 5 — followers 👥
    {
      title: fmt(followers),
      label: "followers",
      icon: pickIcon(followers, ICON.people, [
        [100, ICON.party],
        [1000, ICON.crown],
      ]),
    },
    // 6 — public repos 📦
    {
      title: fmt(repos),
      label: "public repos",
      icon: pickIcon(repos, ICON.box, [
        [25, ICON.books],
        [50, ICON.temple],
      ]),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Assemble the widget payload (field names must match your config)   */
/* ------------------------------------------------------------------ */

function buildPayload(username, avatarUrl, stats) {
  const dynamic = [
    imgField("logo", resolveLogo(avatarUrl)),
    strField("tracking", `@${username}`),
    strField("updatesEvery", CONFIG.updateLabel),
  ];

  stats.forEach((s, i) => {
    const n = i + 1;
    dynamic.push(imgField(`stat${n}Logo`, s.icon));
    dynamic.push(strField(`stat${n}Title`, s.title));
    dynamic.push(strField(`stat${n}Label`, s.label));
  });

  return { data: { dynamic } };
}

/* ------------------------------------------------------------------ */
/*  Push to Discord                                                    */
/* ------------------------------------------------------------------ */

async function pushToDiscord(payload) {
  const { appId, userId, botToken } = CONFIG.discord;

  if (!appId || !userId || !botToken) {
    console.log("ℹ️  Missing Discord secrets — dry run. Payload:\n");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const url = `https://discord.com/api/v9/applications/${appId}/users/${userId}/identities/0/profile`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://github.com/xn1781/github-widget, 1.0.0)",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
  console.log("✅ Widget updated.");
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const username = CONFIG.username;
  console.log(`⏳ Fetching GitHub stats for @${username}…`);

  const [contrib, profile, stars] = await Promise.all([
    fetchContributions(username),
    fetchProfile(username),
    fetchTotalStars(username),
  ]);

  const streaks = computeStreaks(contrib.days);
  const stats = buildStats({
    streaks,
    contribTotal: contrib.total,
    stars,
    followers: profile.followers,
    repos: profile.public_repos,
  });

  console.log(
    `📊 streak ${streaks.current}d (best ${streaks.longest}d) · today ${streaks.today} · ` +
      `year ${contrib.total} · ${stars}★ · ${profile.followers} followers · ${profile.public_repos} repos`
  );

  const payload = buildPayload(username, contrib.avatarUrl || profile.avatar_url, stats);
  await pushToDiscord(payload);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
