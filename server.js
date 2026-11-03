// Zero-dependency server (Node 18+). Run:  node server.js
// - Reads settings from .env
// - Serves index.html
// - /config.js     -> public settings only (client id, owner, repo, branches)
// - /api/github/*  -> proxies to GitHub, adding the token server-side
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- load .env ----------
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
        if (!m || line.trim().startsWith("#")) continue;
        if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}

const {
    PORT = 3000,
    GOOGLE_CLIENT_ID = "",
    GITHUB_TOKEN = "",
    GITHUB_OWNER = "",
    GITHUB_REPO = "",
    BRANCH_IMAGES = "main",
    BRANCH_DOCS = "docs",
    BRANCH_PDF = "pdf",
    BRANCH_PPT = "ppt",
} = process.env;

const publicConfig = {
    GOOGLE_CLIENT_ID,
    GITHUB_OWNER,
    GITHUB_REPO,
    BRANCHES: { images: BRANCH_IMAGES, docs: BRANCH_DOCS, pdf: BRANCH_PDF, ppt: BRANCH_PPT },
};

// ---------- verify Google sign-in (required for uploads) ----------
async function verifyGoogle(credential) {
    if (!credential) return false;
    try {
        const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
        if (!r.ok) return false;
        const info = await r.json();
        return info.aud === GOOGLE_CLIENT_ID;
    } catch { return false; }
}

function readBody(req, limit = 100 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("Too large")); req.destroy(); } else chunks.push(c); });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/config.js") {
        res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
        return res.end("window.APP_CONFIG = " + JSON.stringify(publicConfig) + ";");
    }

    if (url.pathname.startsWith("/api/github/contents/")) {
        const repoPath = url.pathname.slice("/api/github/contents/".length);
        if (req.method === "PUT" && !(await verifyGoogle(req.headers["x-google-credential"]))) {
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ message: "Google sign-in required." }));
        }
        if (req.method !== "GET" && req.method !== "PUT") { res.writeHead(405); return res.end(); }
        try {
            const body = req.method === "PUT" ? await readBody(req) : undefined;
            const gh = await fetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}${url.search}`,
                {
                    method: req.method,
                    headers: {
                        Accept: "application/vnd.github+json",
                        Authorization: `Bearer ${GITHUB_TOKEN}`,
                        "Content-Type": "application/json",
                        "X-GitHub-Api-Version": "2022-11-28",
                        "User-Agent": "gitpin",
                    },
                    body,
                }
            );
            res.writeHead(gh.status, { "Content-Type": "application/json" });
            return res.end(Buffer.from(await gh.arrayBuffer()));
        } catch (e) {
            res.writeHead(502, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ message: e.message }));
        }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }

    res.writeHead(404); res.end("Not found");
}).listen(PORT, () => console.log(`GitPin running at http://localhost:${PORT}`));
