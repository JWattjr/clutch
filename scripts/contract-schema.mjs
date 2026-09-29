import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "artifacts", "clutch.abi.json");
mkdirSync(join(root, "artifacts"), { recursive: true });
const python = process.platform === "win32" ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python");
const result = spawnSync(python, ["-X", "utf8", "-m", "genvm_linter.cli", "schema", "contracts/clutch.py", "--json", "--output", output], {
  cwd: root, stdio: "inherit", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});
process.exit(result.status ?? 1);
