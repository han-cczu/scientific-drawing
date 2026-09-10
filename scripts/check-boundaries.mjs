import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const portablePath = (file) => file.replaceAll("\\", "/");

/** Resolve imports with the same TypeScript paths as the project, including re-exports and import types. */
export function checkBoundaries(rootDir = projectRoot) {
  const configPath = path.join(rootDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const inputConfig = { ...config.config, include: ["src/**/*.ts", "src/**/*.tsx", "server/**/*.ts"] };
  delete inputConfig.files;
  const parsed = ts.parseJsonConfigFileContent(inputConfig, ts.sys, rootDir);
  const errors = parsed.errors.filter((error) => error.code !== 18003);
  if (errors.length) throw new Error(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const violations = [];
  for (const file of parsed.fileNames) {
    const relativeFile = portablePath(path.relative(rootDir, file));
    const shared = relativeFile.startsWith("src/shared/");
    const service = /^server\/src\/(services|storage)\//.test(relativeFile);
    const model = relativeFile.startsWith("src/editor/model/");
    if (!shared && !service && !model) continue;
    const source = ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest, true);
    const report = (node, specifier, message) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push({ file: relativeFile, line: line + 1, specifier, message });
    };
    const inspect = (node, specifier) => {
      const resolved = ts.resolveModuleName(specifier, file, parsed.options, ts.sys).resolvedModule;
      const target = resolved ? portablePath(path.relative(rootDir, resolved.resolvedFileName)) : "";
      const react = specifier === "react" || specifier.startsWith("react/") || specifier === "react-dom" || specifier.startsWith("react-dom/")
        || /^node_modules\/(react|react-dom)\//.test(target);
      const nodeBuiltin = specifier.startsWith("node:") || builtins.has(specifier);
      if (shared && (react || nodeBuiltin || target.startsWith("server/") || (target.startsWith("src/") && !target.startsWith("src/shared/")))) {
        report(node, specifier, "Shared rules cannot depend on Node, React, server or browser feature layers.");
      }
      if (service && /^server\/src\/(routes(?:\/|\.)|app\.)/.test(target)) {
        report(node, specifier, "Services and storage cannot import application assembly or routes.");
      }
      if (model && (react || /^src\/(lib\/|features\/)/.test(target) || target.endsWith(".tsx") || /^src\/editor\/hooks\//.test(target))) {
        report(node, specifier, "Editor model cannot depend on React, UI hooks/components or browser I/O.");
      }
      if (!resolved && !nodeBuiltin && (specifier.startsWith(".") || specifier.startsWith("@shared/"))) {
        report(node, specifier, "Unresolved local import prevents dependency boundary verification.");
      }
    };
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        inspect(node, node.moduleSpecifier.text);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
        inspect(node, node.moduleReference.expression.text);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        inspect(node, node.argument.literal.text);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) inspect(node, argument.text);
        else report(node, "<dynamic>", "Computed imports prevent dependency boundary verification in this layer.");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkBoundaries();
  for (const issue of violations) console.error(`${issue.file}:${issue.line} ${issue.specifier}: ${issue.message}`);
  if (violations.length) process.exitCode = 1;
  else console.log("Dependency boundaries passed.");
}
