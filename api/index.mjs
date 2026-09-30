import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicHandler } from '../server/public/handler.mjs';
const bytes=readFileSync(new URL('../server/public/data/snapshot.json',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../server/public/data/manifest.json',import.meta.url),'utf8'));
if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('Public snapshot integrity mismatch');
export default createPublicHandler({data:JSON.parse(bytes),manifest});
