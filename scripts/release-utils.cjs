const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
}

function getVersion() {
  return readPackageJson().version;
}

function getReleaseTag(version = getVersion()) {
  return process.env.PI_DESKTOP_RELEASE_TAG?.trim() || `v${version}`;
}

function getGitRemoteUrl() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function resolveGitHubRepository() {
  const explicit = (process.env.PI_DESKTOP_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || '').trim();
  if (explicit) return normalizeRepo(explicit);

  const remote = getGitRemoteUrl();
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch?.[1]) return normalizeRepo(httpsMatch[1]);

  const sshMatch = remote.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch?.[1]) return normalizeRepo(sshMatch[1]);

  return '';
}

function normalizeRepo(value) {
  return value.replace(/^github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
}

function resolveUpdateFeedUrl() {
  const explicit = (process.env.PI_DESKTOP_UPDATE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/g, '');

  const repo = resolveGitHubRepository();
  if (repo) return `https://github.com/${repo}/releases/latest/download`;

  return '';
}

function validateUpdateFeedUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error('PI_DESKTOP_UPDATE_URL is required and no GitHub repository could be inferred.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid update feed URL: ${rawUrl}`);
  }

  const allowInsecure = process.env.PI_DESKTOP_ALLOW_INSECURE_UPDATE_FEED === '1';
  const isLocalHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalHttp && !(allowInsecure && (parsed.protocol === 'http:' || parsed.protocol === 'file:'))) {
    throw new Error(
      `Update feed URL must use HTTPS for production releases: ${rawUrl}. ` +
      'Loopback HTTP is allowed for local tests; set PI_DESKTOP_ALLOW_INSECURE_UPDATE_FEED=1 only for private test feeds.'
    );
  }

  return parsed;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function releaseFilesFromLatestYml(releaseDir = path.join(rootDir, 'release')) {
  const latestPath = path.join(releaseDir, 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error(`Missing update metadata: ${latestPath}`);
  }

  const latest = fs.readFileSync(latestPath, 'utf8');
  const names = new Set(['latest.yml']);
  for (const match of latest.matchAll(/^\s*-\s+url:\s*(.+?)\s*$/gm)) {
    names.add(cleanYamlValue(match[1]));
  }
  for (const match of latest.matchAll(/^\s*url:\s*(.+?)\s*$/gm)) {
    names.add(cleanYamlValue(match[1]));
  }

  const files = Array.from(names)
    .map((name) => ({ name, path: path.join(releaseDir, name) }))
    .filter((file) => file.name && !file.name.startsWith('http://') && !file.name.startsWith('https://'));

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      throw new Error(`Release metadata references missing file: ${file.path}`);
    }
  }

  const blockmaps = files
    .filter((file) => file.name.endsWith('.exe'))
    .map((file) => ({ name: `${file.name}.blockmap`, path: `${file.path}.blockmap` }));

  for (const file of blockmaps) {
    if (!fs.existsSync(file.path)) {
      throw new Error(`Missing blockmap for ${file.name.replace(/\.blockmap$/, '')}: ${file.path}`);
    }
  }

  return [...files, ...blockmaps].sort((a, b) => a.name.localeCompare(b.name));
}

function cleanYamlValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

module.exports = {
  rootDir,
  getVersion,
  getReleaseTag,
  resolveGitHubRepository,
  resolveUpdateFeedUrl,
  validateUpdateFeedUrl,
  releaseFilesFromLatestYml,
};
