import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const passwordFile = path.join(here, ".localcloud-password");
const tunnelConfig = path.join(here, "cloudflared.yml");

let password;
try {
  password = (await readFile(passwordFile, "utf8")).trim();
} catch {
  console.error("Arquivo .localcloud-password não encontrado.");
  process.exit(1);
}

if (!password) {
  console.error("A senha do LocalCloud não pode estar vazia.");
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(here, "server.mjs")], {
  cwd: here,
  env: { ...process.env, LOCALCLOUD_PASSWORD: password },
  stdio: "inherit"
});

const tunnelCommand = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const tunnel = spawn(tunnelCommand, ["tunnel", "--config", tunnelConfig, "run", "localcloud"], {
  cwd: here,
  stdio: "inherit"
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server.kill();
  tunnel.kill();
  setTimeout(() => process.exit(code), 300);
}

server.on("exit", code => { if (!stopping) stop(code || 1); });
tunnel.on("exit", code => { if (!stopping) stop(code || 1); });
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

console.log("\n  Acesso público protegido: https://localcloud.worldforge.site");
console.log("  Usuário: Nunes\n");
