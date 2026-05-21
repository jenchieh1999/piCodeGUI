const { resolveUpdateFeedUrl, validateUpdateFeedUrl } = require('./release-utils.cjs');

const rawUrl = resolveUpdateFeedUrl();

if (!rawUrl) {
  console.error('PI_DESKTOP_UPDATE_URL is required for release packaging, or a GitHub origin must be configured.');
  console.error('Example: set PI_DESKTOP_UPDATE_URL=https://updates.example.com/pi-agent-desktop/latest');
  process.exit(1);
}

try {
  const parsed = validateUpdateFeedUrl(rawUrl);
  if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    console.warn('Warning: using a non-HTTPS update feed. Use HTTPS for production releases.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log(`Using Pi Agent Desktop update feed: ${rawUrl}`);
