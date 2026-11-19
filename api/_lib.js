/* Shared helpers for the CMS functions.
   The website lives in one file, index.html, with its content as JSON inside it.
   The CMS edits that JSON through the GitHub API (so every save is a normal git commit
   and Vercel redeploys on its own). The GitHub token only ever exists here, on the server. */
const crypto = require("crypto");

const REPO = process.env.GITHUB_REPO || "adamhmxx/Merly-Website";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const JSON_RE = /(<script type="application\/json" id="site-data">)([\s\S]*?)(<\/script>)/;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// constant-time password check; a wrong guess is slowed down
async function authorized(req) {
  const want = process.env.ADMIN_PASSWORD || "";
  const given = String(req.headers["x-admin-password"] || "");
  if (!want) return false;
  const h = s => crypto.createHash("sha256").update(s).digest();
  const ok = crypto.timingSafeEqual(h(given), h(want));
  if (!ok) await sleep(700);
  return ok;
}
function configured() { return !!(process.env.GITHUB_TOKEN && process.env.ADMIN_PASSWORD); }

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "User-Agent": "merly-cms",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return r;
}

// index.html as it is on GitHub right now, with the blob sha needed to update it
async function readIndex() {
  const r = await gh(`contents/index.html?ref=${encodeURIComponent(BRANCH)}`);
  if (!r.ok) throw Object.assign(new Error("github_read_failed"), { status: r.status });
  const j = await r.json();
  let html = j.content ? Buffer.from(j.content, "base64").toString("utf8") : "";
  if (!html) {                       // files over 1 MB come back without content
    const rr = await gh(`contents/index.html?ref=${encodeURIComponent(BRANCH)}`, { raw: true });
    html = await rr.text();
  }
  return { html, sha: j.sha };
}
function extractContent(html) {
  const m = html.match(JSON_RE);
  if (!m) throw new Error("content_block_missing");
  return JSON.parse(m[2]);
}
function injectContent(html, content) {
  const json = JSON.stringify(content).replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
  if (!JSON_RE.test(html)) throw new Error("content_block_missing");
  return html.replace(JSON_RE, (all, open, _old, close) => open + json + close);
}

/* Only accept content shaped like the site expects, and keep photo values to known-safe forms */
const PHOTO_OK = /^(\/uploads\/[\w.-]+|data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)$/;
const str = (v, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const bi = (o, max) => ({ en: str(o && o.en, max), id: str(o && o.id, max) });
const color = c => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#f1f1f1");
function cleanContent(c) {
  if (!c || typeof c !== "object") throw new Error("invalid_content");
  const cards = list => (Array.isArray(list) ? list : []).slice(0, 40).map(x => ({
    title: bi(x.title, 200), org: bi(x.org, 200), desc: bi(x.desc, 1500),
    year: str(x.year, 40), icon: str(x.icon, 30), tint: color(x.tint), auto: x.auto === true,
    photos: (Array.isArray(x.photos) ? x.photos : []).filter(p => typeof p === "string" && PHOTO_OK.test(p)).slice(0, 20)
  }));
  const links = c.links || {};
  const out = {
    v: 1,
    profilePhoto: typeof c.profilePhoto === "string" && PHOTO_OK.test(c.profilePhoto) ? c.profilePhoto : "",
    hello: bi(c.hello, 300), line1: bi(c.line1, 300), shine: bi(c.shine, 300), line2: bi(c.line2, 300), sub: bi(c.sub, 1500),
    links: { instagram: str(links.instagram, 300), linkedin: str(links.linkedin, 300), email: str(links.email, 200) },
    edu: cards(c.edu), exp: cards(c.exp),
    chips: (Array.isArray(c.chips) ? c.chips : []).slice(0, 60).map(x => ({ en: str(x.en, 80), id: str(x.id, 80), color: color(x.color) }))
  };
  if (JSON.stringify(out).length > 700 * 1024) throw new Error("too_large");
  return out;
}

/* GitHub refuses a commit when another one lands on the branch at the same moment (409/422), which happens
   when several photos are uploaded at once or a save follows an upload. Such a refusal is retried a few times
   with a growing pause; `attempt` runs the whole read-modify-write again so it always starts from the latest state. */
async function withRetry(attempt, tries = 5) {
  for (let i = 0; ; i++) {
    const r = await attempt();
    if (r.ok || (r.status !== 409 && r.status !== 422) || i >= tries - 1) return r;
    await sleep(350 * (i + 1) + Math.random() * 250);
  }
}

module.exports = { REPO, BRANCH, send, sleep, authorized, configured, gh, withRetry, readIndex, extractContent, injectContent, cleanContent };
