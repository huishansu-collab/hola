import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {createCaseId} from '../lib/case-package/id.ts';
// RFC 9562 Appendix A.6 interoperability vector.
const clock=mock.method(Date,'now',()=>1645557742000);
let count=0;
const random=mock.method(crypto,'getRandomValues',bytes=>{
 bytes.set(Buffer.from('0000000000000cc318c4dc0c0c07398f','hex'));
 bytes[15]+=count++;
 return bytes;
});
const first=createCaseId();
assert.equal(first,'017f22e2-79b0-7cc3-98c4-dc0c0c07398f');
count=0;
assert.equal(createCaseId(new Set([first])),'017f22e2-79b0-7cc3-98c4-dc0c0c073990');
random.mock.restore();
const sameMillisecond=Array.from({length:1000},()=>createCaseId());
assert.equal(new Set(sameMillisecond).size,1000);
assert(sameMillisecond.every(id=>/^017f22e2-79b0-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
clock.mock.restore();
const before=Date.now(),id=createCaseId(),after=Date.now();
const embedded=parseInt(id.replaceAll('-','').slice(0,12),16);
assert(embedded>=before&&embedded<=after);
console.log('PASS RFC UUID v7 vector, collision retry, same-millisecond generation and timestamp');
