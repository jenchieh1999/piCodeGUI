const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_FORCE_IS_PACKAGED;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: __dirname,
  env,
  stdio: 'inherit',
  windowsHide: false,
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
