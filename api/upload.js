/* POST /api/upload {data: base64}: stores a photo in the repo under /uploads and returns its path */
const { send, authorized, configured, gh, BRANCH } = require("./_lib");

function kind(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.length > 7 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 11 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  if (buf.length > 5 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString())) return "gif";
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  if (!configured()) return send(res, 500, { error: "not_configured" });
  if (!(await authorized(req))) return send(res, 401, { error: "wrong_password" });
  const data = req.body && req.body.data;
  if (typeof data !== "string" || !data) return send(res, 400, { error: "no_data" });
  const buf = Buffer.from(data, "base64");
  if (buf.length > 3 * 1024 * 1024) return send(res, 413, { error: "too_large" });
  const ext = kind(buf);
  if (!ext) return send(res, 415, { error: "unsupported_type" });
  const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  try {
    const r = await gh(`contents/uploads/${name}`, { method: "PUT", body: {
      message: "Upload photo (CMS)", content: buf.toString("base64"), branch: BRANCH
    } });
    if (!r.ok) return send(res, 502, { error: "github_write_failed", status: r.status });
    send(res, 200, { path: "/uploads/" + name });
  } catch (e) {
    send(res, 502, { error: "github_failed", detail: e.message });
  }
};
