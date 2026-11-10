const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

test('Shorts presents only supported public-search options and every option is keyboard focusable', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(app, /'POPULAR SHORTS'/);
  assert.match(app, /'SEARCH TOPIC SHORTS'/);
  assert.match(app, /popular\.dataset\.youtubeFocus = 'true'/);
  assert.match(app, /topic\.dataset\.youtubeFocus = 'true'/);
  assert.match(app, /popular\.addEventListener\('click', \(\) => \{ youtubeState\.query = 'popular'; void loadYoutubeSection\('shorts'\); \}\)/);
  assert.match(app, /topic\.addEventListener\('click', \(\) => \{ youtubeState\.query = query\.value\.trim\(\)/);
  assert.match(app, /youtubeState\.section === 'shorts' \? 'shorts' : 'search'/);
  assert.match(app, /if \(section === 'shorts'\) showShortsMenu\(\)/);
  assert.match(app, /\[data-youtube-focus\]:not\(:disabled\)/);
  assert.doesNotMatch(app, /make\('button'[^\n]*(?:TOP IN USE|MOST WATCHED)/i);
  assert.match(app, /not a personalized, most-watched, or trending feed/);
  assert.match(css, /\.hud-youtube-shorts-actions/);
});

test('Shorts opens an official player only from an embeddable video ID and gives an empty/error outcome otherwise', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /searchQuery = section === 'shorts' \? `\$\{query\} #shorts` : query/);
  assert.match(app, /if \(section === 'shorts' && !append && newVideos\.length\)[\s\S]*?openYoutubeVideo\(newVideos\[0\]\)/);
  assert.match(app, /No embeddable #shorts search result was found\. Try another search\./);
  assert.match(app, /if \(!video\?\.videoId \|\| !\/\^\[A-Za-z0-9_-\]\{11\}\$\/\.test\(video\.videoId\)\) return/);
});
