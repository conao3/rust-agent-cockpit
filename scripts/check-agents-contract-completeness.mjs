#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const checks = [
  {
    id: "scope_non_scope",
    label: "scope/non-scope",
    patterns: [/\bscope\b/i, /\bnon[- ]scope\b/i],
  },
  {
    id: "validation",
    label: "validation",
    patterns: [/\bvalidation(s)?\b/i],
  },
  {
    id: "ack_slo",
    label: "ACK<=10m",
    patterns: [/ACK\s*<=\s*10m/i],
  },
  {
    id: "heartbeat_slo",
    label: "heartbeat<=20m",
    patterns: [/heartbeat\s*<=\s*20m/i],
  },
  {
    id: "in_review_evidence_contract",
    label: "in_review evidence contract",
    patterns: [/\bin_review\b/i, /\bevidence\b/i, /\bcontract\b/i],
  },
  {
    id: "immediate_closeout_merge_ready",
    label: "immediate closeout on merge-ready in_review",
    patterns: [/merge-ready/i, /in_review/i, /immediate|same supervision cycle|without delay/i],
  },
  {
    id: "linear_sync",
    label: "Linear sync",
    patterns: [/Linear/i, /sync|synchronized|synchronize/i],
  },
];

const docPaths = [
  "src/instructions/AGENTS.leader.md",
  "src/instructions/AGENTS.member.md",
  "src/instructions/AGENTS.orchestrator.md",
];

const failures = [];

for (const relativePath of docPaths) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const missing = checks
    .filter((check) => !check.patterns.every((pattern) => pattern.test(content)))
    .map((check) => check.label);

  if (missing.length > 0) {
    failures.push({ relativePath, missing });
  }
}

if (failures.length > 0) {
  console.error("AGENTS contract completeness check failed.");
  for (const failure of failures) {
    console.error(`- ${failure.relativePath}`);
    for (const missing of failure.missing) {
      console.error(`  - missing marker: ${missing}`);
    }
  }
  process.exit(1);
}

console.log(`AGENTS contract completeness check passed (${docPaths.length} docs).`);
