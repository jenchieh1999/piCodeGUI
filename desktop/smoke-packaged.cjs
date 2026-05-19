const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const exe = path.join(repoRoot, 'release', 'win-unpacked', 'Pi Agent Desktop.exe');

if (!fs.existsSync(exe)) {
  console.error(`Packaged app not found: ${exe}`);
  console.error('Run `npm run desktop:pack` first.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_FORCE_IS_PACKAGED;

const child = spawn(exe, ['--smoke'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
