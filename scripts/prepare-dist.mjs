import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const file of ["index.html", "styles.css", "app.js", "config.js"]) {
  cpSync(join(root, file), join(dist, file));
}
cpSync(join(root, "image"), join(dist, "image"), { recursive: true });

console.log("dist/ pronto para o Netlify");
