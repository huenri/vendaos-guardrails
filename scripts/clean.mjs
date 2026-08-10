import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const allowedTargets = new Set(["dist", ".test-dist"]);
const target = process.argv[2];

if (!target || !allowedTargets.has(target)) {
  throw new Error(`Refusing to clean unsupported target: ${target ?? "<missing>"}`);
}

const projectRoot = resolve(import.meta.dirname, "..");
const resolvedTarget = resolve(projectRoot, target);

if (!resolvedTarget.startsWith(`${projectRoot}${sep}`)) {
  throw new Error("Refusing to clean a path outside the project root.");
}

await rm(resolvedTarget, { recursive: true, force: true });
