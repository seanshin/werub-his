#!/usr/bin/env node
// CMS 표현 정본(packages/shared/src/cms-style-preset.ts) → apps/homepage 사본 복사.
// apps/homepage 는 격리 빌드(자체 npm install)라 workspace 패키지를 참조할 수 없다.
// 드리프트는 packages/shared/src/cms-style-preset.spec.ts 가 막는다.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANON = join(root, 'packages/shared/src/cms-style-preset.ts');
const COPY = join(root, 'apps/homepage/src/lib/cms-style-preset.ts');
const HEADER = `/* eslint-disable */
// 🔴 이 파일은 \`packages/shared/src/cms-style-preset.ts\` 의 **기계 대조 사본**이다.
//    \`apps/homepage\` 는 격리 빌드(자체 npm install)라 workspace 패키지를 참조할 수 없어 사본을 둔다.
//    정본은 shared 이며, 두 파일이 갈라지면 \`packages/shared/src/cms-style-preset.spec.ts\` 가 실패한다.
//    **여기를 직접 고치지 말 것** — shared 를 고치고 \`npm run sync:cms-style\` 로 복사한다.
`;
writeFileSync(COPY, HEADER + readFileSync(CANON, 'utf8'));
console.log(`✅ 동기화 완료 — ${COPY.replace(root + '/', '')}`);
