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

const exports = exportsStr.split(exportBreak).map((part, i) => {
  const name = names[i];
  let code = part.slice("${".length, -"}".length);
  if (code.startsWith("(")) {
    code = stripEnds("(", code, ")");
  }

  if (code.startsWith("function(")) {
    return `export function ${name}(` + stripEnds("function(", code);
  } else if (code.startsWith("class{")) {
    return `export class ${name} {` + stripEnds("class{", code);
  }

  return `export const ${name} = ${code};`;
});

const result =
  stripEnds("", before, "window.EXPORTS`") +
  "\n" +
  exports.join("\n") +
  stripEnds("`;", after, "");

await writeFile("datatree.min.js", result.trimStart());

function stripEnds(prefix, str, suffix) {
  return suffix
    ? str.slice(prefix.length, -suffix.length)
    : str.slice(prefix.length);
}
