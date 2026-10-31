// Copies the build's own files into demo/core before every dev, build and script run, byte for byte,
// so the demo runs exactly the code, metrics, data, skill and prices the harness tested and never a
// second copy someone edited. demo/core is not committed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DEMO);
const CORE = path.join(DEMO, "core");
const files = ["lib/store.js", "lib/period.js", "lib/round.js", "lib/tools.js", "metrics.json", "data/orders.csv", "skill/SKILL.md", "eval/prices.json", "eval/mock.js", "eval/expected/cases.json", "eval/answers.txt", "package.json"];

fs.rmSync(CORE, { recursive: true, force: true });
for (const f of files) {
  const from = path.join(REPO, f), to = path.join(CORE, f);
  if (!fs.existsSync(from)) { console.error(`copy-core: ${f} is missing from the repo`); process.exit(1); }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`copy-core: ${files.length} files copied into demo/core`);
