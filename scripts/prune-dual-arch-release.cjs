const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getVersion, rootDir } = require('./release-utils.cjs');

function pruneDualArchRelease(options = {}) {
  const version = options.version || getVersion();
  const releaseDir = options.releaseDir || path.join(rootDir, 'release');
  const installerName = `Pi-Agent-Desktop-${version}-win.exe`;
  const installerPath = path.join(releaseDir, installerName);
  const latestPath = path.join(releaseDir, 'latest.yml');

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Missing dual-arch Windows installer: ${installerPath}`);
  }

  const previousLatest = fs.existsSync(latestPath) ? fs.readFileSync(latestPath, 'utf8') : '';
  const releaseDate = readReleaseDate(previousLatest) || new Date().toISOString();
  const stat = fs.statSync(installerPath);
  const sha512 = sha512File(installerPath);

  const latest = [
    `version: ${version}`,
    'files:',
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${stat.size}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  fs.writeFileSync(latestPath, latest, 'utf8');

  const removed = [];
  for (const fileName of archSpecificArtifacts(version)) {
    const filePath = path.join(releaseDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removed.push(fileName);
    }
  }

  console.log(`Dual-arch release metadata: ${installerName}`);
  if (removed.length) {
    console.log(`Removed single-arch installer artifacts: ${removed.join(', ')}`);
  }

  return {
    installerName,
    latestPath,
    removed,
  };
}

function archSpecificArtifacts(version) {
  const names = [];
  for (const prefix of ['Pi-Agent-Desktop', 'Pi Agent Desktop']) {
    for (const arch of ['x64', 'ia32']) {
      const name = `${prefix}-${version}-win-${arch}.exe`;
      names.push(name, `${name}.blockmap`);
    }
  }
  return names;
}

function readReleaseDate(latest) {
  const match = latest.match(/^releaseDate:\s*['"]?(.+?)['"]?\s*$/m);
  return match?.[1] || '';
}

function sha512File(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

if (require.main === module) {
  try {
    pruneDualArchRelease();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  pruneDualArchRelease,
};
