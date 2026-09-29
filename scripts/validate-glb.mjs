// Khronos glTF-Validator on the exported GLB; report saved to project/reports.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';

const here = dirname(fileURLToPath(import.meta.url));
const glb = join(here, '..', '..', 'project', 'exports', 'second_floor.glb');
const report = await validator.validateBytes(new Uint8Array(readFileSync(glb)), { maxIssues: 500 });
writeFileSync(join(here, '..', '..', 'project', 'reports', 'gltf_validator_report.json'), JSON.stringify(report, null, 1));
const i = report.issues;
console.log(`glTF-Validator ${report.validatorVersion}: errors=${i.numErrors} warnings=${i.numWarnings} infos=${i.numInfos} hints=${i.numHints}`);
const byCode = {};
for (const m of i.messages) byCode[`${m.severity}:${m.code}`] = (byCode[`${m.severity}:${m.code}`] || 0) + 1;
console.log(byCode);
console.log('drawCalls(est)', report.info?.drawCallCount, 'totalTriangles', report.info?.totalTriangleCount, 'maxUVs', report.info?.maxUVs);
process.exit(i.numErrors > 0 ? 1 : 0);
