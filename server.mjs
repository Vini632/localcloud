import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, lstat, rename, rm, access } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const storageDir = path.resolve(process.env.LOCALCLOUD_STORAGE || path.join(here, "storage"));
const port = Number(process.env.PORT || 4173);
const password = process.env.LOCALCLOUD_PASSWORD || "";
const maxUpload = Number(process.env.LOCALCLOUD_MAX_UPLOAD || 0);

await mkdir(storageDir, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".mp4": "video/mp4",
  ".mp3": "audio/mpeg", ".zip": "application/zip"
};

function send(res, status, body, headers = {}) {
  const value = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(value);
}

function safePath(input = "") {
  const clean = input.replaceAll("\\", "/").replace(/^\/+/, "");
  const resolved = path.resolve(storageDir, clean);
  if (resolved !== storageDir && !resolved.startsWith(storageDir + path.sep)) throw new Error("Caminho inválido");
  return resolved;
}

function relative(fullPath) {
  return path.relative(storageDir, fullPath).split(path.sep).join("/");
}

function validName(name) {
  return typeof name === "string" && name.trim() && name !== "." && name !== ".." && !/[\\/\0]/.test(name);
}

function isAuthorized(req) {
  if (!password) return true;
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 && decoded.slice(0, separator) === "Nunes" && decoded.slice(separator + 1) === password;
  } catch { return false; }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Pedido muito grande");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function errorResponse(res, error) {
  const code = error.code === "ENOENT" ? 404 : error.code === "EEXIST" ? 409 : 400;
  send(res, code, { error: error.message || "Não foi possível concluir a operação" });
}

async function serveFile(req, res, filePath, downloadName = "") {
  const info = await stat(filePath);
  if (!info.isFile()) return send(res, 400, { error: "Este item não é um arquivo" });
  const type = mime[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const disposition = downloadName ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` : "inline";
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return send(res, 416, "", { "Content-Range": `bytes */${info.size}` });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return send(res, 416, "", { "Content-Range": `bytes */${info.size}` });
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Accept-Ranges": "bytes", "Content-Disposition": disposition });
    return createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Accept-Ranges": "bytes", "Content-Disposition": disposition });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return send(res, 401, { error: "Autenticação necessária" }, { "WWW-Authenticate": 'Basic realm="LocalCloud", charset="UTF-8"' });
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/info" && req.method === "GET") {
      return send(res, 200, { name: "LocalCloud", storage: storageDir, protected: Boolean(password) });
    }

    if (url.pathname === "/api/files" && req.method === "GET") {
      const requested = safePath(url.searchParams.get("path") || "");
      const entries = await readdir(requested, { withFileTypes: true });
      const files = await Promise.all(entries.filter(e => e.name !== ".gitkeep" && !e.name.startsWith(".localcloud-upload-")).map(async entry => {
        const full = path.join(requested, entry.name);
        const info = await lstat(full);
        return { name: entry.name, path: relative(full), type: entry.isDirectory() ? "folder" : "file", size: entry.isFile() ? info.size : null, modified: info.mtime.toISOString() };
      }));
      files.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) : a.type === "folder" ? -1 : 1);
      return send(res, 200, { path: relative(requested), files });
    }

    if (url.pathname === "/api/folders" && req.method === "POST") {
      const body = await readJson(req);
      if (!validName(body.name)) throw new Error("Nome de pasta inválido");
      const target = path.join(safePath(body.path || ""), body.name.trim());
      await mkdir(target);
      return send(res, 201, { ok: true, path: relative(target) });
    }

    if (url.pathname === "/api/files" && req.method === "PUT") {
      const target = safePath(url.searchParams.get("path") || "");
      if (target === storageDir) throw new Error("Nome de arquivo inválido");
      const length = Number(req.headers["content-length"] || 0);
      if (maxUpload && length > maxUpload) return send(res, 413, { error: "Arquivo maior que o limite configurado" });
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = path.join(path.dirname(target), `.localcloud-upload-${process.pid}-${Date.now()}-${path.basename(target)}`);
      let received = 0;
      req.on("data", chunk => {
        received += chunk.length;
        if (maxUpload && received > maxUpload) req.destroy(new Error("Arquivo maior que o limite configurado"));
      });
      try {
        await pipeline(req, createWriteStream(temporary, { flags: "wx" }));
        try { await access(target); await rm(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return send(res, 201, { ok: true, path: relative(target), size: received });
    }

    if (url.pathname === "/api/entries" && req.method === "PATCH") {
      const body = await readJson(req);
      if (!validName(body.newName)) throw new Error("Novo nome inválido");
      const source = safePath(body.path || "");
      if (source === storageDir) throw new Error("A pasta principal não pode ser renomeada");
      const target = path.join(path.dirname(source), body.newName.trim());
      await access(source);
      try { await access(target); throw Object.assign(new Error("Já existe um item com esse nome"), { code: "EEXIST" }); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await rename(source, target);
      return send(res, 200, { ok: true, path: relative(target) });
    }

    if (url.pathname === "/api/entries" && req.method === "DELETE") {
      const target = safePath(url.searchParams.get("path") || "");
      if (target === storageDir) throw new Error("A pasta principal não pode ser excluída");
      await rm(target, { recursive: true });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/download" && req.method === "GET") {
      const target = safePath(url.searchParams.get("path") || "");
      return await serveFile(req, res, target, path.basename(target));
    }

    const requestedStatic = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const staticPath = path.resolve(publicDir, requestedStatic);
    if (!staticPath.startsWith(publicDir + path.sep) && staticPath !== path.join(publicDir, "index.html")) return send(res, 404, { error: "Não encontrado" });
    try { return await serveFile(req, res, staticPath); }
    catch (error) { if (error.code === "ENOENT") return send(res, 404, { error: "Não encontrado" }); throw error; }
  } catch (error) {
    if (!res.headersSent) errorResponse(res, error);
    else res.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  const addresses = Object.values(os.networkInterfaces()).flat().filter(item => item?.family === "IPv4" && !item.internal).map(item => `http://${item.address}:${port}`);
  console.log(`\n  LocalCloud pronto em http://localhost:${port}`);
  for (const address of addresses) console.log(`  Na rede local: ${address}`);
  console.log(`  Arquivos: ${storageDir}${password ? "\n  Proteção por senha ativada" : "\n  Sem senha (defina LOCALCLOUD_PASSWORD para proteger)"}\n`);
});
