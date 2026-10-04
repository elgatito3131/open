import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Map([
  ['schema.sql', 'sql'], ['server/service.js', 'javascript'],
  ['server/app.js', 'javascript'], ['server/validation.js', 'javascript'],
  ['client/src/App.jsx', 'jsx'],
]);
export async function readSource(file) {
  if (!allowed.has(file)) return null;
  return { file, language: allowed.get(file), content: await readFile(resolve(projectRoot, file), 'utf8') };
}
export async function sourceRef(file, marker) {
  const source = await readSource(file);
  const lines = source.content.split('\n');
  const startLine = Math.max(1, lines.findIndex(line => line.includes(`trace: ${marker}`)) + 1);
  return { file, startLine, endLine: Math.min(lines.length, startLine + 12) };
}
export function makeTrace() {
  const steps = [];
  return {
    steps,
    async add(label, layer, detail, file, marker, evidence = {}) {
      // Reading explanatory source must never make a committed write look failed.
      let source;
      try { source = await sourceRef(file, marker); }
      catch { source = { file, startLine: 1, endLine: 1, available: false }; }
      steps.push({ label, layer, detail, source, ...evidence });
    },
  };
}
