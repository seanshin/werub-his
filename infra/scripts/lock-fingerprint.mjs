#!/usr/bin/env node
/**
 * lockfile 지문 — **의존성 해석에 영향을 주는 내용만**으로 sha256 을 만든다.
 *
 * 🔴 왜 파일 해시가 아닌가: 버전 동기화(`scripts/sync-version.mjs`)는 lock 의 **워크스페이스 자기 버전**을 바꾼다.
 *    파일째 비교하면 버전만 올려도 "의존성이 바뀌었다"가 되어 매 릴리즈마다 운영에서 `npm ci`(node_modules 재설치)를
 *    강요한다 — 거짓 경보이고, 운영 중 재설치는 위험하다. 그래서 설치 결과를 바꾸지 않는 필드를 뺀다:
 *      · 최상위 `version` · 워크스페이스 링크 대상(`packages["apps/api"]` 등)의 `version` · 루트 `engines`
 *    나머지(의존성 트리 전체)는 그대로 — 새 의존성·버전 변경은 반드시 지문을 바꾼다.
 *
 * 로컬(deploy.sh)과 서버에서 **같은 스크립트**로 계산한다(서버에 rsync 로 올린 뒤 실행).
 * 사용: `node infra/scripts/lock-fingerprint.mjs <package-lock.json 경로>` → 64자리 hex 한 줄
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function lockFingerprint(lock) {
  const copy = JSON.parse(JSON.stringify(lock));
  delete copy.version;
  const pkgs = copy.packages ?? {};
  if (pkgs['']) { delete pkgs[''].version; delete pkgs[''].engines; }
  // 워크스페이스 = `node_modules/<name>` 이 `link: true` 로 가리키는 경로
  for (const [key, entry] of Object.entries(pkgs)) {
    if (key.startsWith('node_modules/') && entry && entry.link && typeof entry.resolved === 'string') {
      if (pkgs[entry.resolved]) delete pkgs[entry.resolved].version;
    }
  }
  return createHash('sha256').update(stable(copy)).digest('hex');
}

// realpath 비교 — 심링크 경로(서버 nvm·macOS /var)에서 본문이 조용히 안 돌면 빈 지문이 나온다
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const p = process.argv[2];
  if (!p) { console.error('사용: node lock-fingerprint.mjs <package-lock.json>'); process.exit(2); }
  console.log(lockFingerprint(JSON.parse(readFileSync(p, 'utf8'))));
}
