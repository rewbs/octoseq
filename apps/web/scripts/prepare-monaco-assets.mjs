#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = join(scriptDirectory, "..");
const monacoDirectory = dirname(require.resolve("monaco-editor/package.json"));
const sourceDirectory = join(monacoDirectory, "min", "vs");
const outputDirectory = join(webDirectory, "public", "monaco", "vs");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(dirname(outputDirectory), { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });

console.log(`Prepared Monaco assets at ${outputDirectory}`);
