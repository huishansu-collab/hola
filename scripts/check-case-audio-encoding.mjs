import {base64,unbase64} from '../lib/case-package/audio.ts';
import assert from 'node:assert/strict';
for(const n of [0,1,2,3,3071,3072,3073,8192,8*1024*1024+1]){
 const bytes=Uint8Array.from({length:n},(_,i)=>i%256);
 const encoded=base64(bytes);
 assert.equal(encoded,Buffer.from(bytes).toString('base64'));
 assert.deepEqual(unbase64(encoded),bytes);
}
for(const text of ['A===','====','abc?','A','a bc','AA=A'])assert.throws(()=>unbase64(text));
console.log('PASS large audio encoding, chunk boundaries, byte parity and malformed input');
