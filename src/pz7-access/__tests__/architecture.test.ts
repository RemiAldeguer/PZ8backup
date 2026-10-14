import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

type Layer =
  | "domain"
  | "application"
  | "infrastructure"
  | "presentation"
  | "composition";
export interface ArchitectureViolation {
  file: string;
  line: number;
  rule: "layer" | "external" | "unresolved" | "dynamic" | "platform" | "cycle";
  message: string;
}
const virtualRoot = "/pz7-access";
const allowed: Record<Layer, ReadonlySet<Layer>> = {
  domain: new Set(["domain"]),
  application: new Set(["application", "domain"]),
  infrastructure: new Set(["infrastructure", "application", "domain"]),
  presentation: new Set(["presentation", "application", "domain"]),
  composition: new Set([
    "composition",
    "presentation",
    "infrastructure",
    "application",
    "domain",
  ]),
};
const browserNames = new Set([
  "fetch",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "React",
  "Window",
  "Document",
  "Storage",
  "IDBDatabase",
]);
const normalize = (file: string) => posix.normalize(file.replaceAll("\\", "/"));
function layerOf(file: string): Layer | null {
  const first = file.split("/")[0];
  if (
    first === "domain" ||
    first === "application" ||
    first === "infrastructure" ||
    first === "presentation"
  )
    return first;
  return file.includes("/") ? null : "composition";
}
function isReact(specifier: string) {
  return /^(react|react-dom)(\/|$)/.test(specifier);
}
function literal(node: ts.Node | undefined) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}
function isRequire(expression: ts.Expression) {
  const node = unwrap(expression);
  return (
    (ts.isIdentifier(node) && node.text === "require") ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.name.text === "resolve")
  );
}

/** Collect all explicit dependency forms, including type imports and re-exports. */
function dependency(
  node: ts.Node,
): { specifier: string | null; node: ts.Node } | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    return node.moduleSpecifier
      ? { specifier: literal(node.moduleSpecifier), node }
      : null;
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  )
    return { specifier: literal(node.moduleReference.expression), node };
  if (ts.isImportTypeNode(node))
    return {
      specifier: ts.isLiteralTypeNode(node.argument)
        ? literal(node.argument.literal)
        : null,
      node,
    };
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      isRequire(node.expression))
  )
    return { specifier: literal(node.arguments[0]), node };
  return null;
}

function declarationName(node: ts.Identifier) {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyAssignment(parent)) &&
    parent.name === node
  );
}
function browserReference(node: ts.Node): string | null {
  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  )
    return "JSX/React";
  if (
    ts.isIdentifier(node) &&
    browserNames.has(node.text) &&
    !declarationName(node)
  ) {
    if (
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name === node
    ) {
      return ts.isIdentifier(node.parent.expression) &&
        node.parent.expression.text === "globalThis"
        ? node.text
        : null;
    }
    return node.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "globalThis"
  ) {
    const name = literal(node.argumentExpression);
    if (name && browserNames.has(name)) return name;
  }
  return null;
}

function cycleViolations(
  graph: Map<string, Set<string>>,
): ArchitectureViolation[] {
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];
  const result: ArchitectureViolation[] = [];
  function visit(file: string) {
    if (active.has(file)) {
      const cycle = [...path.slice(path.indexOf(file)), file];
      result.push({
        file,
        line: 1,
        rule: "cycle",
        message: "Cycle : " + cycle.join(" → "),
      });
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    path.push(file);
    for (const target of [...(graph.get(file) ?? [])].sort()) visit(target);
    path.pop();
    active.delete(file);
    visited.add(file);
  }
  for (const file of [...graph.keys()].sort()) visit(file);
  return result;
}

/** Pure helper: virtual source files allow mutation tests without editing product files. */
export function architectureViolations(
  input: Readonly<Record<string, string>>,
): ArchitectureViolation[] {
  const files = new Map(
    Object.entries(input).map(([file, content]) => [normalize(file), content]),
  );
  const graph = new Map(
    [...files.keys()].map((file) => [file, new Set<string>()]),
  );
  const violations: ArchitectureViolation[] = [];
  const host: ts.ModuleResolutionHost = {
    fileExists: (file) =>
      files.has(posix.relative(virtualRoot, normalize(file))),
    readFile: (file) => files.get(posix.relative(virtualRoot, normalize(file))),
  };
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
  };
  for (const [file, text] of [...files.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const layer = layerOf(file);
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (
      rule: ArchitectureViolation["rule"],
      node: ts.Node,
      message: string,
    ) =>
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        rule,
        message,
      });
    if (!layer) {
      report(
        "layer",
        source,
        "Dossier hors des quatre couches ou de la composition racine.",
      );
      continue;
    }
    function checkImport(specifier: string | null, node: ts.Node) {
      if (specifier === null) {
        report(
          "dynamic",
          node,
          "Le chargement doit utiliser un chemin littéral vérifiable.",
        );
        return;
      }
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        if (
          layer !== "composition" &&
          !(layer === "presentation" && isReact(specifier))
        )
          report(
            "external",
            node,
            `Import externe interdit dans ${layer} : ${specifier}`,
          );
        return;
      }
      const absolute = specifier.startsWith("/")
        ? normalize(specifier)
        : posix.resolve(virtualRoot, posix.dirname(file), specifier);
      const relative = posix.relative(virtualRoot, absolute);
      if (relative.startsWith("../") || relative === "..") {
        report(
          "layer",
          node,
          "La dépendance sort du module d’accès : " + specifier,
        );
        return;
      }
      const asset = /\.(css|scss|svg|png|jpe?g|webp)$/.test(relative);
      const resolved = asset
        ? relative
        : ts.resolveModuleName(
            specifier,
            posix.join(virtualRoot, file),
            options,
            host,
          ).resolvedModule?.resolvedFileName;
      if (!resolved) {
        report(
          "unresolved",
          node,
          "Dépendance locale non résolue : " + specifier,
        );
        return;
      }
      const target = asset
        ? resolved
        : posix.relative(virtualRoot, normalize(resolved));
      const targetLayer = layerOf(target);
      if (!targetLayer || !allowed[layer!].has(targetLayer))
        report(
          "layer",
          node,
          `${layer} ne peut pas importer ${targetLayer ?? "un dossier inconnu"} : ${specifier}`,
        );
      if (!asset && graph.has(target)) graph.get(file)!.add(target);
    }
    function visit(node: ts.Node) {
      const imported = dependency(node);
      if (imported) checkImport(imported.specifier, imported.node);
      if (layer === "domain" || layer === "application") {
        const api = browserReference(node);
        if (api)
          report(
            "platform",
            node,
            `API navigateur ou React interdite dans ${layer} : ${api}`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...violations, ...cycleViolations(graph)];
}

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function moduleSources(
  directory = moduleRoot,
  prefix = "",
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(
        files,
        moduleSources(join(directory, entry.name), relative + "/"),
      );
    else if (/\.tsx?$/.test(entry.name))
      files[relative] = readFileSync(join(directory, entry.name), "utf8");
  }
  return files;
}
function diagnostic(violations: ArchitectureViolation[]) {
  return violations
    .map((item) => `${item.file}:${item.line} [${item.rule}] ${item.message}`)
    .join("\n");
}

test("le module d’accès respecte les frontières des quatre couches et reste sans cycle", () => {
  const files = moduleSources();
  for (const layer of [
    "domain",
    "application",
    "infrastructure",
    "presentation",
  ]) {
    assert.ok(
      Object.keys(files).some((file) => file.startsWith(layer + "/")),
      `La couche ${layer} doit contenir un module ; le contrôle ne doit pas être vide.`,
    );
  }
  const violations = architectureViolations(files);
  assert.deepEqual(violations, [], diagnostic(violations));
});

const validSources: Readonly<Record<string, string>> = {
  "domain/model.ts":
    "export interface Resource { id: string } export interface Cancellation { signal?: AbortSignal }",
  "domain/ports.ts":
    'import type { Resource } from "./model"; export interface Repository { list(): Promise<Resource[]> }',
  "application/list.ts":
    'import type { Repository } from "../domain/ports"; export const list = (repository: Repository) => repository.list();',
  "infrastructure/http.ts":
    'import type { Repository } from "../domain/ports"; import { list } from "../application/list"; export const request = () => fetch("/api");',
  "presentation/View.tsx":
    'import { useState } from "react"; import { list } from "../application/list"; import "./view.css"; export const View = () => <p>Accès</p>;',
  "index.ts":
    'export { View } from "./presentation/View"; export type { Resource } from "./domain/model";',
};
test("le helper autorise les dépendances vers l’intérieur, React en présentation et AbortSignal comme contrat", () => {
  assert.deepEqual(architectureViolations(validSources), []);
});

for (const code of [
  'import { request } from "../infrastructure/http";',
  'import type { Transport } from "../infrastructure/http";',
  'export * from "../infrastructure/http";',
  'export type { Transport } from "../infrastructure/http";',
  'const adapter = import("../infrastructure/http");',
  'const adapter = require("../infrastructure/http");',
  'import adapter = require("../infrastructure/http");',
  'type Adapter = import("../infrastructure/http").Transport;',
]) {
  test("une dépendance inverse est refusée : " + code, () => {
    const violations = architectureViolations({
      ...validSources,
      "application/list.ts": code,
    });
    assert.ok(
      violations.some(
        (item) => item.rule === "layer" && item.file === "application/list.ts",
      ),
      diagnostic(violations),
    );
  });
}
test("la présentation ne peut pas importer directement le transport ou la façade racine", () => {
  for (const source of ["../infrastructure/http", "../index"]) {
    const violations = architectureViolations({
      ...validSources,
      "presentation/View.tsx": `export * from "${source}";`,
    });
    assert.ok(
      violations.some(
        (item) =>
          item.rule === "layer" && item.file === "presentation/View.tsx",
      ),
      diagnostic(violations),
    );
  }
});
for (const specifier of ["react", "node:fs", "zod"]) {
  test("un import externe est refusé dans le métier : " + specifier, () => {
    const violations = architectureViolations({
      ...validSources,
      "domain/model.ts": `import type { Value } from "${specifier}";`,
    });
    assert.ok(
      violations.some(
        (item) => item.rule === "external" && item.file === "domain/model.ts",
      ),
      diagnostic(violations),
    );
  });
}
test("un cycle local est détecté même si les deux fichiers appartiennent à la même couche", () => {
  const violations = architectureViolations({
    ...validSources,
    "domain/a.ts": 'export type { B } from "./b"; export interface A {}',
    "domain/b.ts": 'import type { A } from "./a"; export interface B {}',
  });
  assert.ok(
    violations.some(
      (item) =>
        item.rule === "cycle" &&
        /domain\/a\.ts.*domain\/b\.ts.*domain\/a\.ts/.test(item.message),
    ),
    diagnostic(violations),
  );
});
test("un chemin local absent ne masque pas une dépendance architecturale", () => {
  const violations = architectureViolations({
    ...validSources,
    "application/missing.ts": 'export * from "../infrastructure/missing";',
  });
  assert.ok(
    violations.some((item) => item.rule === "unresolved"),
    diagnostic(violations),
  );
});
test("un chargement calculé est refusé car sa couche ne peut pas être vérifiée", () => {
  for (const code of [
    "const dependency = import(path);",
    "const dependency = require(path);",
  ]) {
    const violations = architectureViolations({
      ...validSources,
      "application/dynamic.ts": code,
    });
    assert.ok(
      violations.some((item) => item.rule === "dynamic"),
      diagnostic(violations),
    );
  }
});
for (const code of [
  'const result = fetch("/api");',
  "const href = window.location.href;",
  "const body = document.body;",
  'const token = localStorage.getItem("token");',
  'const token = sessionStorage.getItem("token");',
  'const database = indexedDB.open("access");',
  'const html = React.createElement("div");',
  'const store: Storage = globalThis["localStorage"];',
  'const request = globalThis.fetch("/api");',
  "const element = <div />;",
]) {
  test(
    "une dépendance navigateur ou React est refusée dans une couche interne : " +
      code,
    () => {
      for (const layer of ["domain", "application"]) {
        const violations = architectureViolations({
          ...validSources,
          [`${layer}/browser.tsx`]: code,
        });
        assert.ok(
          violations.some(
            (item) =>
              item.rule === "platform" && item.file.startsWith(layer + "/"),
          ),
          diagnostic(violations),
        );
      }
    },
  );
}
test("les noms de champs métier et les chaînes de texte ne sont pas confondus avec les globals navigateur", () => {
  const violations = architectureViolations({
    ...validSources,
    "domain/data.ts":
      'export interface Data { window: number; document: string } export const label = "window.fetch"; export const data = { window: 1, document: "rapport" };',
  });
  assert.deepEqual(violations, []);
});
