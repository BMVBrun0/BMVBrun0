import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'scripts/profile-dashboard.mjs');
const fixture = path.join(repo, 'tests/mock-graphql.mjs');

function execute(mode, withCachedFile = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'github-dashboard-test-'));
  if (withCachedFile) {
    mkdirSync(path.join(dir, 'assets/dashboard'), { recursive: true });
    writeFileSync(path.join(dir, 'assets/dashboard/activity-dark.svg'), '<svg>CACHED</svg>');
  }
  const result = spawnSync(process.execPath, ['--import', fixture, script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      GH_TOKEN: 'test-token',
      PROFILE_USERNAME: 'BMVBrun0',
      PROFILE_RETRY_BASE_MS: '0',
      TEST_GRAPHQL_MODE: mode,
    },
  });
  return { dir, result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('dashboard renders real-schema SVGs for both themes', () => {
  const run = execute('success');
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    for (const theme of ['dark', 'light']) {
      const svg = readFileSync(path.join(run.dir, `assets/dashboard/activity-${theme}.svg`), 'utf8');
      assert.match(svg, /<svg/);
      assert.match(svg, /Engineering dashboard/);
      assert.match(svg, /12-month contribution pulse/);
      assert.match(svg, /Contribution field/);
      assert.match(svg, /Weekly rhythm/);
    }
    assert.match(run.result.stdout, /5 contributions/);
  } finally { run.cleanup(); }
});

test('recovers from transient 504 while still producing new SVGs', () => {
  const run = execute('retry-504');
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.match(run.result.stderr, /HTTP 504/);
  } finally { run.cleanup(); }
});

test('persistent 504 returns retryable code 75 without overwriting cache', () => {
  const run = execute('always-504', true);
  try {
    assert.equal(run.result.status, 75, run.result.stderr);
    assert.match(run.result.stderr, /TEMPORARY_GITHUB_API_FAILURE/);
    assert.equal(readFileSync(path.join(run.dir, 'assets/dashboard/activity-dark.svg'), 'utf8'), '<svg>CACHED</svg>');
  } finally { run.cleanup(); }
});

test('repository API failure also returns code 75', () => {
  const run = execute('repos-503');
  try {
    assert.equal(run.result.status, 75, run.result.stderr);
    assert.match(run.result.stderr, /repositories/);
  } finally { run.cleanup(); }
});

test('invalid token causes hard failure, not misleading cached success', () => {
  const run = execute('auth-401');
  try {
    assert.equal(run.result.status, 1);
    assert.match(run.result.stderr, /HTTP 401/);
  } finally { run.cleanup(); }
});
