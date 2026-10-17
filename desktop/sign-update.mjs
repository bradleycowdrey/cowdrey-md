// Sign a released Mac app bundle and write updates/latest.json for in-place updates.
// Use when the TAURI_SIGNING_PRIVATE_KEY secret is not set on GitHub.
//   node desktop/sign-update.mjs <path-to-private-key> "<release notes>"
// Then commit and push updates/latest.json; publish-update.yml attaches it to the release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [keyPath, notes = ''] = process.argv.slice(2);
if (!keyPath) { console.error('usage: node desktop/sign-update.mjs <private-key> "<notes>"'); process.exit(1); }

const conf = JSON.parse(fs.readFileSync(path.join(here, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = conf.version;
const url = `https://github.com/bradleycowdrey/cowdrey-md/releases/download/v${version}/Cowdrey.MD_universal.app.tar.gz`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cowdrey-update-'));
const file = path.join(tmp, 'Cowdrey.MD_universal.app.tar.gz');

console.log(`Downloading ${url}`);
execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'inherit' });
const listing = execFileSync('tar', ['-tzf', file]).toString();
if (!listing.startsWith('Cowdrey.MD.app/')) throw new Error('The bundle does not contain Cowdrey.MD.app at its root');
const plist = execFileSync('tar', ['-xzOf', file, 'Cowdrey.MD.app/Contents/Info.plist']).toString();
if (!plist.includes(`<string>${version}</string>`)) throw new Error(`The bundle is not version ${version}`);

execFileSync('npx', ['tauri', 'signer', 'sign', '-f', keyPath, '-p', '', file], { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] });
const signature = fs.readFileSync(file + '.sig', 'utf8').trim();
const entry = { signature, url };
const doc = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  platforms: { 'darwin-aarch64': entry, 'darwin-x86_64': entry, 'darwin-universal': entry },
};
fs.mkdirSync(path.join(here, '../updates'), { recursive: true });
fs.writeFileSync(path.join(here, '../updates/latest.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(`Wrote updates/latest.json for ${version}. Commit and push it to publish the update.`);
