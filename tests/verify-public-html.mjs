import assert from 'node:assert/strict';
import {readPublicHtml} from '../backend/lib/live/assistance.mjs';
const dns=async()=>[{address:'93.184.216.34',family:4}];
async function redirect(location){let calls=0;try{await readPublicHtml('https://artist.example/',{lookup:dns,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}})}});throw Error('unexpected success')}catch(e){assert.equal(calls,1);return e}}
const www=await redirect('https://www.artist.example/profile');assert.equal(www.location,'https://www.artist.example/profile');
const http=await redirect('http://www.artist.example/profile');assert.equal(http.location,'https://www.artist.example/profile');
for(const target of ['https://other.example/profile','https://api.artist.example/profile','https://127.0.0.1/profile','https://localhost/profile','https://user:fixture@www.artist.example/profile','https://www.artist.example/profile?token=fixture','https://www.artist.example/login']){const e=await redirect(target);assert.equal(e.location,undefined)}
let calls=0;const result=await readPublicHtml('https://artist.example/',{lookup:dns,fetchImpl:async(url,init)=>{calls++;assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(init.address.address,'93.184.216.34');return calls===1?new Response(null,{status:302,headers:{location:'/profile'}}):new Response('<main>Profile</main>',{headers:{'content-type':'text/html'}})}});assert.equal(calls,2);assert.equal(result.url,'https://artist.example/profile');
console.log('PASS public HTML: same-origin still enforced; only validated www/apex HTTPS error metadata, no cross-site/private/credential/query disclosure, DNS pinning and anonymous reads preserved');
