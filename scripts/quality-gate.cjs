const { execFileSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const npm = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npm';
const runPackaged = process.argv.includes('--packaged');

const steps = [
  ['typecheck', npmCommand('run', 'typecheck')],
  ['build', npmCommand('run', 'build')],
  ['server smoke', npmCommand('run', 'server:smoke')],
  ['desktop smoke', npmCommand('run', 'desktop:smoke')],
  ['line endings', [process.execPath, ['-e', lineEndingCheckSource()]]],
];

if (runPackaged) {
  steps.push(
    ['desktop pack', npmCommand('run', 'desktop:pack')],
    ['packaged smoke', npmCommand('run', 'desktop:smoke:packaged')],
  );
}

for (const [label, [command, args]] of steps) {
  console.log(`\n[quality] ${label}`);
  execFileSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
}

console.log('\n[quality] all checks passed');

function npmCommand(...args) {
  if (!isWindows) return [npm, args];
  return [npm, ['/d', '/s', '/c', ['npm', ...args].join(' ')]];
}

function lineEndingCheckSource() {
  return `
    const { execFileSync } = require('node:child_process');
    const output = execFileSync('git', ['ls-files', '--eol'], { encoding: 'utf8' });
    const bad = output.split(/\\r?\\n/).filter((line) => /w\\/(crlf|mixed)/.test(line));
    if (bad.length > 0) {
      console.error(bad.join('\\n'));
      process.exit(1);
    }
    console.log('Tracked files use LF-compatible working-tree line endings.');
  `;
}
