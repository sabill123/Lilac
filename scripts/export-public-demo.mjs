import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { project, sourceTimestamp } from '../server/public/projection.mjs';
const root = new URL('../',import.meta.url);
const out = new URL('server/public/data/',root);
const names=['artists','tracks','events','products','charts','releases','fx','aliases','search-index','catalog'];
const hash=x=>createHash('sha256').update(x).digest('hex');
await mkdir(out,{recursive:true});
const data={}, sources={};
for(const name of names){
 const file=new URL(`db/${name}.json`,root);
 if(!(await lstat(file)).isFile()) throw new Error('Public source must be a regular file');
 const raw=await readFile(file,'utf8'); const parsed=JSON.parse(raw);
 data[name]=project(name,parsed);
 sources[name]={sourceHash:hash(raw),sourceTimestamp:sourceTimestamp(parsed)};
}
const bytes=JSON.stringify(data)+'\n';
const manifest={schemaVersion:1,mode:'read-only-protected-preview',sha256:hash(bytes),sources};
if(process.argv.includes('--check')) {
 if(await readFile(new URL('snapshot.json',out),'utf8')!==bytes||await readFile(new URL('manifest.json',out),'utf8')!==JSON.stringify(manifest,null,2)+'\n') throw new Error('Export differs from current public sources');
 console.log('Public snapshot deterministic/current:',manifest.sha256);
} else {
 await writeFile(new URL('snapshot.json',out),bytes);
 await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
 console.log('Exported approved public DTOs:',bytes.length,'bytes; sha256',manifest.sha256);
}
