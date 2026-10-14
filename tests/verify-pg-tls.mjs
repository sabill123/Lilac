/* Offline TLS regression. Never connects or reads real environment/credentials. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from '../backend/node_modules/pg/lib/index.js';
import {postgresPoolOptions} from '../backend/lib/pg-config.mjs';
let checks=0;
for(const query of ['', '?sslmode=require', '?sslmode=prefer', '?sslmode=verify-ca', '?sslmode=verify-full', '?ssl=true', '?sslmode=require&channel_binding=require']) {
  const options=postgresPoolOptions('postgres://fixture:fixture@db.invalid/lilac'+query);
  const effective=new pg.Client(options).connectionParameters.ssl;
  assert.notEqual(effective,false);assert.notEqual(effective.rejectUnauthorized,false);
  assert.equal(effective.checkServerIdentity,undefined);
  assert.equal(new URL(options.connectionString).searchParams.get('sslmode'),'verify-full');checks++;
}
for(const query of ['?sslmode=disable','?sslmode=no-verify','?ssl=false','?ssl=0','?sslmode=require&uselibpqcompat=true','?sslmode=disable&sslmode=verify-full','?host=localhost','?hostaddr=127.0.0.1']) {
  assert.throws(()=>postgresPoolOptions('postgres://fixture:fixture@db.invalid/lilac'+query));checks++;
}
for(const host of ['localhost','127.0.0.1','[::1]']) {
  assert.equal(new pg.Client(postgresPoolOptions(`postgres://fixture:fixture@${host}/lilac?sslmode=disable`)).connectionParameters.ssl,false);checks++;
}
const persist=await readFile(new URL('../backend/lib/persist.mjs',import.meta.url),'utf8');
assert.match(persist,/new pg\.Pool\(\{ \.\.\.postgresPoolOptions\(url\)/);
assert.doesNotMatch(persist,/rejectUnauthorized:\s*false/);checks++;
console.log(`PASS ${checks} PostgreSQL TLS regression cases (offline)`);
