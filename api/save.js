/* POST /api/save {content}: writes the content into index.html as one commit on GitHub */
const { send, authorized, configured, gh, withRetry, BRANCH, readIndex, injectContent, cleanContent } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (!configured()) return send(res, 500, { error: "not_configured" });
  if (!(await authorized(req))) return send(res, 401, { error: "wrong_password" });
  let content;
  try { content = cleanContent(req.body && req.body.content); }
  catch (e) { return send(res, 400, { error: e.message }); }
  try {
    let unchanged = false;
    // read index.html fresh on every try: a refused commit is redone on top of whatever landed meanwhile
    const r = await withRetry(async () => {
      const { html, sha } = await readIndex();
      const next = injectContent(html, content);
      if (next === html) { unchanged = true; return { ok: true }; }
      return gh("contents/index.html", { method: "PUT", body: {
        message: "Update website content (CMS)", content: Buffer.from(next, "utf8").toString("base64"), sha, branch: BRANCH
      } });
    });
    if (unchanged) return send(res, 200, { ok: true, unchanged: true });
    if (r.status === 409 || r.status === 422) return send(res, 409, { error: "conflict" });
    if (!r.ok) return send(res, 502, { error: "github_write_failed", status: r.status });
    const j = await r.json();
    send(res, 200, { ok: true, commit: j.commit && j.commit.sha });
  } catch (e) {
    send(res, 502, { error: "github_failed", detail: e.message });
  }
};
