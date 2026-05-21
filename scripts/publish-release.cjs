const fs = require('node:fs');
const path = require('node:path');
const {
  rootDir,
  getVersion,
  getReleaseTag,
  resolveGitHubRepository,
  releaseFilesFromLatestYml,
} = require('./release-utils.cjs');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const version = getVersion();
const tag = getReleaseTag(version);
const releaseDir = path.join(rootDir, 'release');
const files = releaseFilesFromLatestYml(releaseDir);
const provider = resolveProvider();

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main() {
  console.log(`Publishing Pi Agent Desktop ${version} (${tag}) via ${provider}${dryRun ? ' [dry-run]' : ''}`);
  for (const file of files) {
    console.log(` - ${file.name} (${fs.statSync(file.path).size} bytes)`);
  }

  if (provider === 'local') {
    publishLocal();
    return;
  }

  if (provider === 'github') {
    await publishGitHub();
    return;
  }

  throw new Error(`Unsupported publish provider: ${provider}`);
}

function resolveProvider() {
  const explicit = (process.env.PI_DESKTOP_PUBLISH_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if ((process.env.PI_DESKTOP_PUBLISH_DIR || '').trim()) return 'local';
  if ((process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()) return 'github';
  return 'github';
}

function publishLocal() {
  const targetDir = (process.env.PI_DESKTOP_PUBLISH_DIR || '').trim();
  if (!targetDir) {
    throw new Error('PI_DESKTOP_PUBLISH_DIR is required when PI_DESKTOP_PUBLISH_PROVIDER=local.');
  }

  const resolvedTarget = path.resolve(targetDir);
  if (dryRun) {
    console.log(`[dry-run] Would copy release assets to ${resolvedTarget}`);
    return;
  }

  fs.mkdirSync(resolvedTarget, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(file.path, path.join(resolvedTarget, file.name));
  }
  console.log(`Published ${files.length} file(s) to ${resolvedTarget}`);
}

async function publishGitHub() {
  const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (!token && !dryRun) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required for GitHub release publishing.');
  }

  const repository = resolveGitHubRepository();
  if (!repository || repository.split('/').length !== 2) {
    throw new Error('Unable to resolve GitHub repository. Set PI_DESKTOP_GITHUB_REPOSITORY=owner/repo.');
  }

  const [owner, repo] = repository.split('/');
  if (dryRun && !token) {
    console.log(`[dry-run] Would create or update https://github.com/${owner}/${repo}/releases/tag/${tag}`);
    console.log(`[dry-run] Would upload ${files.length} asset(s).`);
    console.log(`Generic update feed: https://github.com/${owner}/${repo}/releases/latest/download`);
    return;
  }

  const release = await ensureGitHubRelease(owner, repo, token);

  if (dryRun) {
    console.log(`[dry-run] Would upload ${files.length} asset(s) to https://github.com/${owner}/${repo}/releases/tag/${tag}`);
    return;
  }

  const existingAssets = Array.isArray(release.assets) ? release.assets : [];
  for (const file of files) {
    const existing = existingAssets.find((asset) => asset.name === file.name);
    if (existing) {
      await githubRequest(existing.url, token, { method: 'DELETE' });
      console.log(`Deleted existing asset: ${file.name}`);
    }
    await uploadGitHubAsset(release.upload_url, token, file);
    console.log(`Uploaded: ${file.name}`);
  }

  console.log(`Release ready: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
  console.log(`Generic update feed: https://github.com/${owner}/${repo}/releases/latest/download`);
}

async function ensureGitHubRelease(owner, repo, token) {
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const existing = await githubRequest(releaseUrl, token, { allowNotFound: true });
  if (existing) return existing;

  if (dryRun) {
    return {
      upload_url: `https://uploads.github.com/repos/${owner}/${repo}/releases/0/assets{?name,label}`,
      assets: [],
    };
  }

  const body = {
    tag_name: tag,
    name: `Pi Agent Desktop ${version}`,
    body: process.env.PI_DESKTOP_RELEASE_NOTES || `Pi Agent Desktop ${version}`,
    draft: process.env.PI_DESKTOP_RELEASE_DRAFT === '1',
    prerelease: process.env.PI_DESKTOP_RELEASE_PRERELEASE === '1',
  };

  return githubRequest(`https://api.github.com/repos/${owner}/${repo}/releases`, token, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function uploadGitHubAsset(uploadUrl, token, file) {
  const cleanUploadUrl = uploadUrl.replace(/\{\?name,label\}$/, '');
  const target = `${cleanUploadUrl}?name=${encodeURIComponent(file.name)}`;
  const body = fs.readFileSync(file.path);
  await githubRequest(target, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    },
    body,
    upload: true,
  });
}

async function githubRequest(url, token, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'pi-agent-desktop-release-script',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  if (options.allowNotFound && response.status === 404) return null;
  if (response.status === 204) return null;

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub request failed ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return text ? JSON.parse(text) : null;
}
