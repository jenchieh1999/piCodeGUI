const { spawnSync } = require('node:child_process');
const {
  rootDir,
  resolveUpdateFeedUrl,
  validateUpdateFeedUrl,
} = require('./release-utils.cjs');

const feedUrl = resolveUpdateFeedUrl();

try {
  const parsed = validateUpdateFeedUrl(feedUrl);
  if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    console.warn('Warning: using a non-HTTPS update feed. Use HTTPS for production releases.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error('Set PI_DESKTOP_UPDATE_URL or configure a GitHub origin remote.');
  process.exit(1);
}

const env = {
  ...process.env,
  PI_DESKTOP_UPDATE_URL: feedUrl,
};

console.log(`Release update feed: ${feedUrl}`);
run('npm', ['run', 'build'], env);
run('npx', ['electron-builder', '--config', 'electron-builder.release.yml', '--win', '--x64', '--ia32', '--publish', 'never'], env);

function run(command, args, childEnv) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: rootDir,
    env: childEnv,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
