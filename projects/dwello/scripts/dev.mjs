import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: 'inherit', env: process.env });
const ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'client/vite.config.js'], { cwd: root, stdio: 'inherit', env: process.env });
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  api.kill('SIGTERM'); ui.kill('SIGTERM');
  process.exitCode = code;
}
api.on('exit', code => stop(code ?? 0));
ui.on('exit', code => stop(code ?? 0));
api.on('error', error => { console.error(error.message); stop(1); });
ui.on('error', error => { console.error(error.message); stop(1); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
