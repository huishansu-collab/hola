import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const dirs=readdirSync('case-packages',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>`case-packages/${d.name}`);
for(const d of dirs)execFileSync(process.execPath,['scripts/case-package/cli.mjs','build',d],{stdio:'inherit'});
console.log(`BUILD ${dirs.length} 个 Case 包`);
