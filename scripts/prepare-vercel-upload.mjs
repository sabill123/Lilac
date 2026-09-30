#!/usr/bin/env node
/** Copy only a Vercel --dry manifest into a new, isolated upload directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const source = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Usage: node scripts/prepare-vercel-upload.mjs DRY_MANIFEST NEW_DIRECTORY');
const output = path.resolve(outputPath);
if (output === source || output.startsWith(source + path.sep)) throw new Error('Output must be outside the source repository');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) throw new Error('Incomplete dry manifest');
const exact = new Set(['.vercelignore','vercel.json','api/index.mjs','api/package.json',
  'frontend/index.html','frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/vite.config.ts',
  'server/public/handler.mjs','server/public/data/snapshot.json','server/public/data/manifest.json',
  'backend/lib/pricing.mjs','backend/lib/ko-ja.mjs']);
const reviewedOther = new Set(['frontend/public/awards/asset-provenance.json','frontend/public/sitemap.xml','frontend/src/assets/hero.png']);
const allowed = p => exact.has(p) || reviewedOther.has(p) || /^frontend\/src\/.+\.(ts|css|md|svg)$/.test(p)
  || /^frontend\/public\/.+\.(html|svg|png|jpe?g|webp|ico|woff2?|txt)$/.test(p);
const forbidden = /(?:^|\/)(?:db|user|users|orders|sessions|private|credentials|uploads|tmp|logs|node_modules|\.git)(?:\/|$)|(?:^|\/)\.env|(?:^|\/)\.[^/]+/;
const secret = /(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|sk-proj-[A-Za-z0-9_-]{35,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const entries = [], seen = new Set();
for (const entry of manifest.files) {
  const p = entry.path;
  if (typeof p !== 'string' || path.isAbsolute(p) || p.includes('\\') || p.split('/').includes('..') || !allowed(p)
    || (p !== '.vercelignore' && forbidden.test(p)) || seen.has(p)) throw new Error('Unapproved or duplicate upload path');
  seen.add(p);
  const target = path.join(source, p), real = await fs.realpath(target), stat = await fs.lstat(target);
  if (!real.startsWith(source + path.sep) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Upload source must be an in-repository regular file');
  const bytes = await fs.readFile(target);
  if (bytes.length !== entry.size || createHash('sha1').update(bytes).digest('hex') !== entry.sha) throw new Error(`Source changed after dry inspection: ${p}`);
  if (/\.(?:ts|css|md|svg|html|json|txt)$/.test(p) && secret.test(bytes.toString('utf8'))) throw new Error(`Possible credential literal in reviewed upload: ${p}`);
  entries.push({ path: p, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const p of exact) if (!seen.has(p)) throw new Error(`Required upload input missing: ${p}`);
await fs.mkdir(output, { mode: 0o700 }); // Never silently overwrite a prior build.
for (const entry of entries) {
  const destination = path.join(output, entry.path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, entry.bytes);
}
// Only identifiers, never downloaded env files or credentials, are copied for CLI linkage.
const project = JSON.parse(await fs.readFile(path.join(source, '.vercel/project.json'), 'utf8'));
if (typeof project.orgId !== 'string' || typeof project.projectId !== 'string') throw new Error('Project link missing');
await fs.mkdir(path.join(output, '.vercel'), { mode: 0o700 });
await fs.writeFile(path.join(output, '.vercel/project.json'), JSON.stringify({ orgId:project.orgId, projectId:project.projectId, projectName:project.projectName }, null, 2));
const audit = { fileCount:entries.length, bytes:entries.reduce((n,e)=>n+e.bytes.length,0), files:entries.map(({path,sha256})=>({path,sha256})) };
await fs.writeFile(output + '.manifest.json', JSON.stringify(audit,null,2)+'\n');
console.log(`Prepared ${audit.fileCount} reviewed files (${audit.bytes} bytes). No original database, env files, collectors or Git history copied.`);
