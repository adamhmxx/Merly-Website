/* GET /api/content: checks the password and returns the content currently on GitHub */
const { send, authorized, configured, readIndex, extractContent } = require("./_lib");

module.exports = async (req, res) => {
  if (!configured()) return send(res, 500, { error: "not_configured" });
  if (!(await authorized(req))) return send(res, 401, { error: "wrong_password" });
  try {
    const { html } = await readIndex();
    send(res, 200, { content: extractContent(html) });
  } catch (e) {
    send(res, 502, { error: "github_read_failed", detail: e.message });
  }
};
