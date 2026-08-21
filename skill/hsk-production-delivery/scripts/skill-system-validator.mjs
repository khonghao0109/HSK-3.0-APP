#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(scriptDirectory, "../../..");
const MANIFEST_RELATIVE_PATH = "skill/hsk-production-delivery/references/skill-system-manifest.json";
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_FRONTMATTER_KEYS = new Set(["name", "description"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizePath(value) {
  return value.split(sep).join("/");
}

function listFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const current = join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(current));
    else result.push(current);
  }
  return result;
}

function readManifest(repositoryRoot) {
  const path = join(repositoryRoot, MANIFEST_RELATIVE_PATH);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  invariant(parsed.schemaVersion === 1, "Skill manifest schemaVersion must be 1.");
  return parsed;
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(filePath) {
  const source = readFileSync(filePath, "utf8");
  invariant(source.startsWith("---\n"), `Missing frontmatter: ${filePath}`);
  const end = source.indexOf("\n---\n", 4);
  invariant(end !== -1, `Unclosed frontmatter: ${filePath}`);
  const values = new Map();
  for (const line of source.slice(4, end).split("\n")) {
    invariant(!line.startsWith("\t"), `Tabs are not allowed in frontmatter: ${filePath}`);
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    invariant(match, `Unsupported frontmatter syntax in ${filePath}: ${line}`);
    const [, key, rawValue] = match;
    invariant(ALLOWED_FRONTMATTER_KEYS.has(key), `Unsupported frontmatter key '${key}' in ${filePath}`);
    invariant(!values.has(key), `Duplicate frontmatter key '${key}' in ${filePath}`);
    values.set(key, unquote(rawValue));
  }
  invariant(values.size === 2 && values.has("name") && values.has("description"), `Frontmatter must contain only name and description: ${filePath}`);
  const name = values.get("name");
  const description = values.get("description");
  invariant(NAME_PATTERN.test(name) && name.length <= 64, `Invalid skill/playbook name '${name}' in ${filePath}`);
  invariant(description.length >= 20 && description.length <= 1024, `Invalid description length in ${filePath}`);
  invariant(!description.includes("<") && !description.includes(">"), `Description must be plain text in ${filePath}`);
  return { name, description, body: source.slice(end + 5) };
}

function validateOpenAiYaml(filePath, skillName) {
  const source = readFileSync(filePath, "utf8");
  invariant(!source.includes("\t"), `Tabs are not allowed in ${filePath}`);
  invariant(/^interface:\n/m.test(source), `Missing interface in ${filePath}`);
  invariant(/^policy:\n/m.test(source), `Missing policy in ${filePath}`);
  for (const key of ["display_name", "short_description", "default_prompt"]) {
    invariant(new RegExp(`^  ${key}: "[^"\\n]+"$`, "m").test(source), `Invalid or unquoted ${key} in ${filePath}`);
  }
  const shortDescription = source.match(/^  short_description: "([^"]+)"$/m)?.[1] ?? "";
  invariant(shortDescription.length >= 25 && shortDescription.length <= 64, `short_description must be 25-64 characters in ${filePath}`);
  const defaultPrompt = source.match(/^  default_prompt: "([^"]+)"$/m)?.[1] ?? "";
  invariant(defaultPrompt.includes(`$${skillName}`), `default_prompt must mention $${skillName} in ${filePath}`);
  invariant(/^  allow_implicit_invocation: true$/m.test(source), `Active skill must allow implicit invocation: ${filePath}`);
  const topLevel = [...source.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
  invariant(topLevel.every((key) => key === "interface" || key === "policy"), `Unsupported openai.yaml top-level key in ${filePath}`);
}

function localMarkdownLinks(filePath) {
  const source = readFileSync(filePath, "utf8");
  const links = [];
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    const target = raw.split("#")[0];
    if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
    links.push(decodeURIComponent(target));
  }
  return links;
}

function validateCommandPaths(repositoryRoot, markdownFiles) {
  let checked = 0;
  const commandPattern = /\b(?:node|python3?|bash|sh)\s+([.]{0,2}\/[^\s`"']+|(?:skill|docs|frontend|backend)\/[^\s`"']+)/g;
  for (const filePath of markdownFiles) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(commandPattern)) {
      const token = match[1].replace(/[),;]+$/g, "");
      const candidate = token.startsWith("../") || token.startsWith("./")
        ? resolve(dirname(filePath), token)
        : resolve(repositoryRoot, token);
      invariant(existsSync(candidate), `Command references a missing path in ${filePath}: ${token}`);
      checked += 1;
    }
  }
  return checked;
}

function validateSafeActiveInstructions(markdownFiles) {
  const forbidden = [
    [/User already said/i, "forged user statement"],
    [/the user already (?:said|approved|requested)/i, "forged user statement"],
    [/(?:^|[\s`])\.claude(?:\/|[\s`])/i, "non-Codex agent path"],
    [/skill\/skills\/(?!anti-overengineering)/i, "quarantined skill dependency"],
    [/\bGemini\b/i, "unapproved external generation dependency"],
  ];
  for (const filePath of markdownFiles) {
    const source = readFileSync(filePath, "utf8");
    for (const [pattern, label] of forbidden) {
      invariant(!pattern.test(source), `Active instructions contain ${label}: ${filePath}`);
    }
  }
}

function countOccurrences(source, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

export function routeTask(prompt) {
  const text = prompt.toLowerCase();
  const selected = new Set();
  const has = (...terms) => terms.some((term) => text.includes(term));

  let mode = "REVIEW";
  if (has("promote", "promotion", "go/no-go", "release communication", "production release")) mode = "RELEASE";
  else if (has("implement", "update", "fix", "simplify", "build", "change") && !has("do not change", "read-only")) mode = "IMPLEMENT";

  if (has("docs-only", "documentation only", "skill-system documentation")) {
    selected.add("09-engineering-governance-dx");
  } else {
    const architectureOnly = has("adr", "architecture decision", "service boundary", "difficult-to-reverse");
    if (architectureOnly) selected.add("03-system-architecture");
    if (!architectureOnly && has("prisma", "schema", "backend", "api", "authentication", "data integrity", "data-integrity")) selected.add("04-backend-core-domains");
    if (has("responsive", "docs/ui_image", " ui ", "page", "component", "accessibility")) {
      selected.add("02-ux-ui-product-design");
      selected.add("05-frontend-mobile");
    }
    if (has("security", "test strategy", "quality gate", "bug triage")) selected.add("07-testing-code-quality");
    if (has("staged git", "git diff", "stage", "commit", "dependency", "openapi")) selected.add("09-engineering-governance-dx");
    if (has("technical staging", "promote", "promotion", "ci/cd", "infrastructure", "observability")) selected.add("08-devops-cloud-sre");
    if (has("go/no-go", "support plan", "release communication", "cross-functional")) selected.add("10-delivery-production-operations");
    if (has("roadmap", "product outcome", "curriculum", "requirement")) selected.add("01-product-strategy");
    if (has("analytics", "data pipeline", "data retention", "business intelligence")) selected.add("06-data-analytics");
    if (has("simplify", "overengineering", "over-engineering", "scope", "unnecessary dependency")) selected.add("anti-overengineering");
  }

  return {
    mode,
    selected: [...selected].sort(),
    commitAuthorized: /\bcommit (?:these|the|this) changes\b/i.test(prompt) && mode !== "REVIEW",
    fullProductionMatrix: mode === "RELEASE",
  };
}

function validateRoutingCases(manifest) {
  for (const testCase of manifest.routingCases) {
    const actual = routeTask(testCase.prompt);
    invariant(actual.mode === testCase.mode, `Routing mode mismatch for ${testCase.id}`);
    invariant(JSON.stringify(actual.selected) === JSON.stringify([...testCase.expected].sort()), `Routing selection mismatch for ${testCase.id}: ${actual.selected.join(", ")}`);
    invariant(testCase.forbidden.every((name) => !actual.selected.includes(name)), `Forbidden skill selected for ${testCase.id}`);
    invariant(actual.commitAuthorized === testCase.commitAuthorized, `Commit authorization mismatch for ${testCase.id}`);
    invariant(actual.fullProductionMatrix === testCase.fullProductionMatrix, `Gate proportionality mismatch for ${testCase.id}`);
  }
}

function validateTrackedFiles(repositoryRoot, files, manifest) {
  for (const filePath of files) {
    const relativePath = normalizePath(relative(repositoryRoot, filePath));
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { cwd: repositoryRoot, stdio: "ignore" });
  }
  const trackedSupport = execFileSync("git", ["ls-files", "skill/skills"], { cwd: repositoryRoot, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  invariant(trackedSupport.every((entry) => entry.startsWith("skill/skills/anti-overengineering/")), "Quarantined support bundle is tracked.");
  invariant(manifest.quarantined.every((entry) => !trackedSupport.some((path) => path.includes(`/${entry.name}/`))), "Quarantined skill leaked into tracked files.");
}

export function validateRepository(repositoryRoot = DEFAULT_REPOSITORY_ROOT, options = {}) {
  const root = realpathSync(repositoryRoot);
  const manifest = readManifest(root);
  const checks = [];
  const record = (name, count) => checks.push({ name, count });

  invariant(manifest.active.length === 12, "Active inventory must contain root, ten groups and anti-overengineering.");
  invariant(manifest.explicitOnly.length === 0, "No explicit-only helper is justified in this closeout.");
  invariant(manifest.quarantined.length === 12, "Quarantine inventory must contain the twelve generic support skills.");
  const activeNames = manifest.active.map((entry) => entry.name);
  invariant(new Set(activeNames).size === activeNames.length, "Duplicate active skill name.");
  record("inventory", manifest.active.length + manifest.quarantined.length);

  const discoveryRoot = join(root, manifest.discoveryRoot);
  invariant(existsSync(discoveryRoot), "Canonical discovery root .agents/skills is missing.");
  const discovered = readdirSync(discoveryRoot).sort();
  invariant(JSON.stringify(discovered) === JSON.stringify([...activeNames].sort()), "Discovery has missing or extra skills.");

  const activeFiles = [];
  const markdownFiles = [];
  const frontmatterNames = new Map();
  const discoveredRealPaths = new Set();
  for (const entry of manifest.active) {
    invariant(entry.provenance === "HSK project-maintained" && entry.license === "project-internal", `Missing active provenance/license: ${entry.name}`);
    const sourceDirectory = join(root, entry.source);
    const discoveryPath = join(discoveryRoot, entry.name);
    invariant(existsSync(sourceDirectory) && lstatSync(sourceDirectory).isDirectory(), `Missing canonical source: ${entry.source}`);
    invariant(lstatSync(discoveryPath).isSymbolicLink(), `Discovery entry must be a symlink: ${entry.name}`);
    const expectedLink = normalizePath(relative(dirname(discoveryPath), sourceDirectory));
    invariant(normalizePath(readlinkSync(discoveryPath)) === expectedLink, `Non-portable discovery symlink: ${entry.name}`);
    const realSource = realpathSync(sourceDirectory);
    invariant(realpathSync(discoveryPath) === realSource, `Discovery symlink resolves to the wrong source: ${entry.name}`);
    invariant(realSource.startsWith(`${root}${sep}`), `Discovery symlink escapes repository: ${entry.name}`);
    invariant(!discoveredRealPaths.has(realSource), `Two discovery names point to the same skill source: ${entry.name}`);
    discoveredRealPaths.add(realSource);

    const files = listFiles(sourceDirectory);
    activeFiles.push(...files);
    markdownFiles.push(...files.filter((file) => extname(file) === ".md"));
    const skillEntrypoint = join(sourceDirectory, "SKILL.md");
    const skillMetadata = parseFrontmatter(skillEntrypoint);
    invariant(skillMetadata.name === entry.name, `Skill name/source mismatch: ${entry.name}`);
    invariant(basename(sourceDirectory) === entry.name, `Skill folder/name mismatch: ${entry.name}`);
    validateOpenAiYaml(join(sourceDirectory, "agents/openai.yaml"), entry.name);
  }
  record("canonical-discovery", manifest.active.length);
  record("openai-yaml", manifest.active.length);

  let playbookCount = 0;
  for (const group of manifest.productionGroups) {
    const directory = join(root, "skill", group.name);
    const router = readFileSync(join(directory, "SKILL.md"), "utf8");
    for (let number = group.first; number <= group.last; number += 1) {
      const prefix = `${String(number).padStart(2, "0")}-`;
      const matches = readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".md"));
      invariant(matches.length === 1, `Missing or duplicate playbook ${number} in ${group.name}`);
      invariant(countOccurrences(router, matches[0]) === 1, `Router must link playbook exactly once: ${matches[0]}`);
      playbookCount += 1;
    }
  }
  invariant(playbookCount === 98, `Expected 98 production playbooks, found ${playbookCount}`);
  record("router-playbooks", playbookCount);

  const frontmatterFiles = markdownFiles.filter((file) => basename(file) === "SKILL.md" || /^\d{2}-.*\.md$/.test(basename(file)));
  for (const filePath of frontmatterFiles) {
    const metadata = parseFrontmatter(filePath);
    invariant(!frontmatterNames.has(metadata.name), `Duplicate frontmatter name '${metadata.name}' in ${filePath}`);
    frontmatterNames.set(metadata.name, filePath);
  }
  record("frontmatter", frontmatterFiles.length);

  let linkCount = 0;
  for (const filePath of markdownFiles) {
    for (const target of localMarkdownLinks(filePath)) {
      const resolved = resolve(dirname(filePath), target);
      invariant(existsSync(resolved), `Broken Markdown link in ${filePath}: ${target}`);
      linkCount += 1;
    }
  }
  record("markdown-links", linkCount);

  validateSafeActiveInstructions(markdownFiles);
  record("active-instruction-safety", markdownFiles.length);
  record("command-paths", validateCommandPaths(root, markdownFiles));

  const scripts = activeFiles.filter((file) => extname(file) === ".mjs");
  const svgPattern = new RegExp("\\." + "svg\\b", "i");
  const fileWriterPattern = new RegExp(["write", "File"].join("") + "|write_text|\\.write\\s*\\(");
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
    invariant(result.status === 0, `Script syntax failed: ${script}`);
    const source = readFileSync(script, "utf8");
    invariant(!/\beval\s*\(|new Function\s*\(|shell\s*:\s*true|\bfetch\s*\(|https?:\/\//.test(source), `Unsafe dynamic, shell or network behavior in active script: ${script}`);
    invariant(!(svgPattern.test(source) && fileWriterPattern.test(source)), `Active script writes SVG without a reviewed sanitizer: ${script}`);
  }
  record("script-syntax", scripts.length);
  record("script-static-security", scripts.length);

  invariant(manifest.quarantined.every((entry) => entry.provenance === undefined && entry.reason.length >= 20 && entry.license.length > 0), "Invalid quarantine provenance/license record.");
  invariant(manifest.quarantined.every((entry) => !discovered.includes(entry.name)), "Quarantined skill is discoverable.");
  record("license-provenance", manifest.active.length + manifest.quarantined.length);

  validateRoutingCases(manifest);
  record("trigger-evaluation", manifest.routingCases.length);

  if (existsSync(join(root, ".git"))) {
    for (const entry of manifest.active) {
      const probe = join(entry.source, "SKILL.md");
      const result = spawnSync("git", ["check-ignore", "-q", probe], { cwd: root });
      invariant(result.status === 1, `Canonical skill is still Git-ignored: ${probe}`);
    }
    record("git-ignore-contract", manifest.active.length);
    if (options.requireTracked) {
      const trackedCandidates = [join(root, ".gitignore"), ...activeFiles, ...manifest.active.map((entry) => join(discoveryRoot, entry.name))];
      validateTrackedFiles(root, trackedCandidates, manifest);
      record("git-tracked-contract", trackedCandidates.length);
    }
  }

  return {
    outcome: "PASS",
    repositoryRoot: root,
    inventory: {
      active: manifest.active.length,
      explicitOnly: manifest.explicitOnly.length,
      quarantined: manifest.quarantined.length,
      productionGroups: manifest.productionGroups.length,
      playbooks: playbookCount,
    },
    checks,
  };
}

function assertSafeTemporaryRoot(root) {
  const parent = realpathSync(dirname(root));
  invariant(parent === realpathSync(tmpdir()), "Temporary portability root must be a direct OS temp child.");
  invariant(basename(root).startsWith("hsk-skill-portability-"), "Unexpected portability temp prefix.");
}

export function validatePortableCopy(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const sourceRoot = realpathSync(repositoryRoot);
  const manifest = readManifest(sourceRoot);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "hsk-skill-portability-"));
  assertSafeTemporaryRoot(temporaryRoot);
  try {
    cpSync(join(sourceRoot, ".gitignore"), join(temporaryRoot, ".gitignore"));
    for (const entry of manifest.active) {
      const destination = join(temporaryRoot, entry.source);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(sourceRoot, entry.source), destination, { recursive: true });
    }
    const discoveryRoot = join(temporaryRoot, manifest.discoveryRoot);
    mkdirSync(discoveryRoot, { recursive: true });
    for (const entry of manifest.active) {
      const link = join(discoveryRoot, entry.name);
      symlinkSync(normalizePath(relative(dirname(link), join(temporaryRoot, entry.source))), link);
    }
    return validateRepository(temporaryRoot);
  } finally {
    assertSafeTemporaryRoot(temporaryRoot);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = { repositoryRoot: DEFAULT_REPOSITORY_ROOT, portableCopy: false, requireTracked: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.repositoryRoot = resolve(argv[++index]);
    else if (arg === "--portable-copy") options.portableCopy = true;
    else if (arg === "--require-tracked") options.requireTracked = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = validateRepository(options.repositoryRoot, { requireTracked: options.requireTracked });
    if (options.portableCopy) result.portableCopy = validatePortableCopy(options.repositoryRoot).outcome;
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Skill system: PASS (${result.checks.length} checks, ${result.inventory.active} active, ${result.inventory.playbooks} playbooks${options.portableCopy ? ", portable copy PASS" : ""}).`);
  } catch (error) {
    console.error(`Skill system: FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
