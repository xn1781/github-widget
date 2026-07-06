/**
 * Renders the widget logo: a circular GitHub avatar that fades out into the
 * card. Outputs a transparent PNG at assets/logo.png, which the workflow
 * commits and index.js then points the widget's `logo` field at.
 *
 * Everything about the look is in RENDER below — tweak and re-run.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const USERNAME = process.env.GH_USERNAME || "xn1781";

const RENDER = {
  width: 340, // near-square canvas so the widget can't shrink a wide frame
  height: 300,
  cx: 175, // circle center X
  cy: 140, // circle center Y
  r: 168, // big radius — the circle fills the frame and bleeds the edges
  // radial vignette: opaque out to `coreStop` of the radius, then fades to 0
  coreStop: 0.82,
  // horizontal fade so the left edge melts into the text area
  fadeFrom: 10, // x where the left fade starts (fully transparent)
  fadeTo: 120, // x where it's fully opaque
};

async function fetchAvatarUrl(username) {
  const res = await fetch(`https://api.github.com/users/${username}`, {
    headers: { "User-Agent": "github-widget" },
  });
  if (!res.ok) throw new Error(`GitHub user ${res.status}`);
  const { avatar_url } = await res.json();
  return avatar_url;
}

async function main() {
  const R = RENDER;
  const avatarUrl = await fetchAvatarUrl(USERNAME);
  const buf = Buffer.from(
    await (await fetch(`${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}s=400`)).arrayBuffer()
  );
  const avatar = await loadImage(buf);

  const canvas = createCanvas(R.width, R.height);
  const ctx = canvas.getContext("2d");

  // 1. circular avatar (cover-fit the square image into the circle's box)
  ctx.save();
  ctx.beginPath();
  ctx.arc(R.cx, R.cy, R.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatar, R.cx - R.r, R.cy - R.r, R.r * 2, R.r * 2);
  ctx.restore();

  // 2. soft round edge — multiply the alpha by a radial gradient
  ctx.globalCompositeOperation = "destination-in";
  const radial = ctx.createRadialGradient(R.cx, R.cy, R.r * R.coreStop, R.cx, R.cy, R.r);
  radial.addColorStop(0, "rgba(0,0,0,1)");
  radial.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, R.width, R.height);

  // 3. fade the left side out so it blends toward the card's text
  const linear = ctx.createLinearGradient(0, 0, R.width, 0);
  linear.addColorStop(0, "rgba(0,0,0,0)");
  linear.addColorStop(Math.min(R.fadeFrom / R.width, 1), "rgba(0,0,0,0)");
  linear.addColorStop(Math.min(R.fadeTo / R.width, 1), "rgba(0,0,0,1)");
  linear.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, R.width, R.height);

  ctx.globalCompositeOperation = "source-over";

  const outDir = path.join(__dirname, "assets");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "logo.png"), canvas.toBuffer("image/png"));
  console.log("✅ wrote assets/logo.png");
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
