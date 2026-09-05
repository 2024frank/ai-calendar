import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

/** Execute the real handler while replacing only its external service boundaries. */
export function loadRoute<T>(file: URL, dependencies: Record<string, unknown>): T {
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file.pathname,
  });
  const require = createRequire(file);
  const routeModule = { exports: {} };
  const load = (name: string) =>
    Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : require(name);
  new Function("require", "module", "exports", outputText)(load, routeModule, routeModule.exports);
  return routeModule.exports as T;
}
