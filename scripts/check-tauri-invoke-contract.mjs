#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const repoRoot = process.cwd();
const rustCommandFile = path.join(repoRoot, "src-tauri/src/lib.rs");
const frontendFiles = listFrontendFiles(path.join(repoRoot, "src"));

const requiredReqCommands = parseRustCommandsRequiringReq(rustCommandFile);
const invocations = collectInvocations(frontendFiles);
const errors = [];

for (const [command, usages] of invocations) {
  if (!requiredReqCommands.has(command)) {
    continue;
  }
  for (const usage of usages) {
    if (!usage.hasReqObject) {
      errors.push(
        `${usage.file}:${usage.line}:${usage.column} invoke("${command}") must pass args as { req: ... }`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Tauri invoke contract mismatch detected:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Tauri invoke contract check passed (${requiredReqCommands.size} req command(s), ${countInvocations(invocations)} invoke call(s))`
);

function listFrontendFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFrontendFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseRustCommandsRequiringReq(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const required = new Set();
  const commandRegex =
    /#\[tauri::command\]\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->[\s\S]*?)?\{/g;
  for (const match of src.matchAll(commandRegex)) {
    const commandName = match[1];
    const paramsText = match[2];
    if (/\breq\s*:/.test(paramsText)) {
      required.add(commandName);
    }
  }
  return required;
}

function collectInvocations(files) {
  const result = new Map();
  for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "invoke") {
        return;
      }
      if (node.arguments.length === 0) {
        return;
      }
      const commandArg = node.arguments[0];
      if (!ts.isStringLiteral(commandArg) && !ts.isNoSubstitutionTemplateLiteral(commandArg)) {
        return;
      }

      const commandName = commandArg.text;
      const secondArg = node.arguments[1];
      let hasReqObject = false;
      if (secondArg && ts.isObjectLiteralExpression(secondArg)) {
        hasReqObject = secondArg.properties.some((property) => {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
            return false;
          }
          const name = getPropName(property.name);
          return name === "req";
        });
      }

      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const usage = {
        file: path.relative(repoRoot, file),
        line: pos.line + 1,
        column: pos.character + 1,
        hasReqObject,
      };
      const usages = result.get(commandName) ?? [];
      usages.push(usage);
      result.set(commandName, usages);
    });
  }
  return result;
}

function getPropName(nameNode) {
  if (!nameNode) {
    return "";
  }
  if (ts.isIdentifier(nameNode)) {
    return nameNode.text;
  }
  if (ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) {
    return nameNode.text;
  }
  return "";
}

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

function countInvocations(map) {
  let count = 0;
  for (const values of map.values()) {
    count += values.length;
  }
  return count;
}
