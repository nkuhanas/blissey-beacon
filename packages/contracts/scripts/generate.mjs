import { compileFromFile } from "json-schema-to-typescript";
import { readdir, readFile, writeFile } from "node:fs/promises";
const directory = new URL("../schemas/", import.meta.url);
const names = (await readdir(directory))
  .filter((n) => n.endsWith(".json"))
  .sort();
const output = (
  await Promise.all(
    names.map((name) =>
      compileFromFile(new URL(name, directory).pathname, {
        bannerComment: "",
        additionalProperties: false,
      }),
    ),
  )
).join("\n");
const target = new URL("../src/generated.ts", import.meta.url);
const content =
  "// Generated from schemas/*.json. Run pnpm contracts:generate.\n" + output;
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== content)
    throw new Error("Generated contracts are stale");
} else await writeFile(target, content);
