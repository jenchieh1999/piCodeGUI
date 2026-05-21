const { existsSync } = require('fs');
const { readdirSync, statSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const iconPath = path.join(repoRoot, 'desktop', 'assets', 'pi-icon.ico');

function listRceditCandidates(name) {
  const candidates = [];
  const explicitDir = process.env.ELECTRON_BUILDER_RCEDIT_PATH;

  if (explicitDir) {
    candidates.push(path.join(explicitDir, name));
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache');
    collect(cacheRoot, name, candidates);
  }

  collect(path.join(repoRoot, '.cache'), name, candidates);
  return candidates.filter((candidate, index) => existsSync(candidate) && candidates.indexOf(candidate) === index);
}

function collect(root, name, candidates) {
  if (!existsSync(root)) return;

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.toLowerCase() === name.toLowerCase()) {
        candidates.push(fullPath);
      }
    }
  }
}

function findRcedit(arch) {
  const preferredName = arch === 'ia32' ? 'rcedit-ia32.exe' : 'rcedit-x64.exe';
  const fallbackName = arch === 'ia32' ? 'rcedit-x64.exe' : 'rcedit-ia32.exe';
  return listRceditCandidates(preferredName)[0] ?? listRceditCandidates(fallbackName)[0] ?? null;
}

module.exports = async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productFilename = context.packager?.appInfo?.productFilename || 'Pi Agent Desktop';
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  if (!existsSync(exePath)) {
    throw new Error(`Cannot apply Windows icon, executable is missing: ${exePath}`);
  }

  if (!existsSync(iconPath)) {
    throw new Error(`Cannot apply Windows icon, icon is missing: ${iconPath}`);
  }

  const arch = context.arch === 0 || context.arch === 'x64' ? 'x64' : context.arch === 1 || context.arch === 'ia32' ? 'ia32' : 'x64';
  const rcedit = findRcedit(arch);
  if (!rcedit) {
    throw new Error('Cannot apply Windows icon, rcedit was not found in ELECTRON_BUILDER_RCEDIT_PATH or the electron-builder cache.');
  }

  const result = spawnSync(rcedit, [exePath, '--set-icon', iconPath], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`rcedit failed with exit code ${result.status}`);
  }

  console.log(`[afterPack] Applied Windows icon: ${iconPath}`);
};
