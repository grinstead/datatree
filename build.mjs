import tscc from "@tscc/tscc";
import { readFile, writeFile, unlink } from "fs/promises";
import { randomUUID } from "crypto";

const entry = await readFile("src/entry.ts", "utf8");

const pageBreak = randomUUID();
const exportBreak = randomUUID();

let names;
const asTemplateStrings = entry.replace(
  /\nexport\s+\{([^}]*)\}/g,
  (_, exports) => {
    if (names) {
      throw new Error(`Cannot have multiple export statements in entry file!`);
    }

    names = exports.split(",").map((name) => name.trim());
    const decls = names.map((name) => "${" + name + "}");

    return `// @ts-ignore
window["EXPORTS"]\`${pageBreak}${decls.join(exportBreak)}${pageBreak}\``;
  }
);

if (entry === asTemplateStrings) {
  throw new Error(`entry.ts file must have an "export {...};" statement`);
}

await writeFile("src/tmp_entry.ts", asTemplateStrings);

try {
  await tscc.default({
    modules: {
      out: "src/tmp_entry.ts",
    },
    prefix: "dist/",
    chunkFormat: "module",
    compilerFlags: {
      assume_function_wrapper: true,
      rewrite_polyfills: false,
      language_in: "UNSTABLE",
    },
  });
} finally {
  await unlink("src/tmp_entry.ts");
}

let compiled = await readFile("dist/out.js", "utf8");

// closure jams that statement in to technically make it a module
compiled = compiled.replaceAll("export{};", "");

const [before, exportsStr, after] = compiled.split(pageBreak);

const exportParts = exportsStr.split(exportBreak).map((part) => {
  const stripStart = "${";
  const stripEnd = "}";
  return part.slice(stripStart.length, -stripEnd.length);
});

const exports = names.map(
  (name, i) => `export const ${name} = ${exportParts[i]}`
);

const result = `${before.slice(0, -"window.EXPORTS`".length)}
${exports.join(";\n")};${after.slice("`;".length)}`;

await writeFile("datatree.min.js", result);
