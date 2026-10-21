'use strict';
// One-shot retry of an explicitly approved, immutable deployment package.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const packageDir = path.resolve(process.argv[2] || '');
const stateDir = path.join(root, 'dist', 'deploy-watch');
const cli = path.join(
  root,
  'dist/npm-cache/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway.exe',
);
const service = '6c99fbf2-ab4d-46dc-af4d-037d703e2efe';
const environment = '05cfe2ad-8310-4fab-ba28-34be9c7605a4';
const started = Date.now();
fs.mkdirSync(stateDir, { recursive: true });
const lock = path.join(stateDir, 'running.lock');
let lockFd;
try {
  lockFd = fs.openSync(lock, 'wx');
} catch {
  throw Error('Watcher already running; inspect running.lock');
}
fs.writeFileSync(lockFd, String(process.pid));
function status(state, extra = {}) {
  const value = {
    state,
    pid: process.pid,
    startedAt: new Date(started).toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(stateDir, 'status.json'), JSON.stringify(value, null, 2));
}
const sleep = () => new Promise((resolve) => setTimeout(resolve, 60000));
async function railway(args) {
  try {
    return await run(cli, args, {
      cwd: root,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', failed: true };
  }
}
function verify() {
  if (!packageDir.startsWith(path.join(root, 'dist') + path.sep))
    throw Error('Package outside dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'release-manifest.json')));
  for (const entry of manifest.files) {
    const file = path.resolve(packageDir, entry.path);
    if (!file.startsWith(packageDir + path.sep) || fs.lstatSync(file).isSymbolicLink())
      throw Error('Unsafe package path');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash !== entry.sha256) throw Error('Package checksum mismatch');
  }
}
(async () => {
  verify();
  let attempts = 0;
  while (Date.now() - started < 24 * 60 * 60 * 1000) {
    if (fs.existsSync(path.join(stateDir, 'STOP'))) return status('cancelled');
    verify();
    status('uploading', { attempts: ++attempts });
    const result = await railway([
      'up',
      packageDir,
      '--path-as-root',
      '--no-gitignore',
      '--service',
      service,
      '--environment',
      environment,
      '--detach',
      '--json',
    ]);
    const output = result.stdout + result.stderr;
    if (output.includes('Deploys have been paused temporarily')) {
      status('waiting_for_railway', { attempts, retrySeconds: 60 });
      await sleep();
      continue;
    }
    if (result.failed)
      return status('needs_review', {
        attempts,
        reason: 'Railway returned an error other than the known build pause; no automatic retry.',
      });
    // Never upload twice after acceptance, even if subsequent status queries fail.
    status('upload_accepted', { attempts });
    const acceptedAt = Date.now();
    while (Date.now() - acceptedAt < 60 * 60 * 1000) {
      const listed = await railway([
        'deployment',
        'list',
        '--service',
        service,
        '--environment',
        environment,
        '--limit',
        '5',
        '--json',
      ]);
      let deployments;
      try {
        deployments = JSON.parse(listed.stdout);
      } catch {
        await sleep();
        continue;
      }
      if (!Array.isArray(deployments))
        return status('needs_review', {
          reason: 'Unexpected deployment status format; upload already accepted.',
        });
      const deployment = deployments.find(
        (item) => Date.parse(item.createdAt) >= acceptedAt - 180000,
      );
      if (deployment) {
        status('deploying', { deploymentId: deployment.id, deploymentStatus: deployment.status });
        if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(deployment.status))
          return status('needs_review', {
            deploymentId: deployment.id,
            deploymentStatus: deployment.status,
          });
        if (deployment.status === 'SUCCESS') {
          const home = await fetch('https://belesbrands.com.ua/', {
            signal: AbortSignal.timeout(20000),
          });
          const html = await home.text();
          const icon = await fetch('https://belesbrands.com.ua/favicon.png', {
            signal: AbortSignal.timeout(20000),
          });
          const health = await fetch('https://belesbrands.com.ua/health', {
            signal: AbortSignal.timeout(20000),
          });
          const verified =
            home.ok &&
            icon.ok &&
            health.ok &&
            html.includes('href="/favicon.png"') &&
            icon.headers.get('content-type')?.includes('image/png');
          return status(verified ? 'published_verified' : 'published_needs_review', {
            deploymentId: deployment.id,
            homeStatus: home.status,
            faviconStatus: icon.status,
            healthStatus: health.status,
          });
        }
      }
      await sleep();
    }
    return status('needs_review', {
      reason: 'Upload accepted; deployment verification exceeded one hour.',
    });
  }
  status('expired', { reason: '24-hour retry window elapsed.' });
})()
  .catch(() =>
    status('needs_review', {
      reason: 'Watcher stopped after an unexpected error; no secrets logged.',
    }),
  )
  .finally(() => {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  });
