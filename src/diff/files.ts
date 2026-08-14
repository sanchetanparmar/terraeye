import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { minimatch } from "minimatch";
import type { TerraeyeConfig } from "../config/schema.js";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
}

const TF_GLOBS_DEFAULT = ["**/*.tf", "**/*.tfvars", "**/*.tf.json"];

export function isTerraformPath(path: string, config: TerraeyeConfig): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (config.ignore_paths.some((p) => minimatch(normalized, p, { dot: true }))) {
    return false;
  }
  return config.paths.some((p) => minimatch(normalized, p, { dot: true }));
}

export function filterTerraformFiles(
  files: ChangedFile[],
  config: TerraeyeConfig
): ChangedFile[] {
  return files.filter((f) => isTerraformPath(f.path, config) && f.status !== "removed");
}

export function listLocalTerraformFiles(
  cwd: string,
  paths: string[] = TF_GLOBS_DEFAULT
): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      const rel = relative(cwd, full).replace(/\\/g, "/");
      if (
        entry.name === ".terraform" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (paths.some((p) => minimatch(rel, p, { dot: true }))) {
        results.push(rel);
      }
    }
  };
  walk(cwd);
  return results;
}

export function readFileSafe(cwd: string, path: string): string | null {
  const full = resolve(cwd, path);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

/** Extract added/changed line numbers from a unified diff patch. */
export function changedLinesFromPatch(patch?: string): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.add(newLine);
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // deleted line in old file — do not advance newLine
    } else if (!raw.startsWith("\\")) {
      newLine += 1;
    }
  }
  return lines;
}
