import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 운영 산출물 기록 — `deploy.sh` 가 **빌드가 성공한 뒤에만** `apps/api/BUILD_INFO.json` 에 쓴다(2026-09-13 상용 릴리즈 T1-4).
 *
 * 🔴 왜: 배포 원천이 working tree rsync 라 "운영에 떠 있는 코드가 어느 커밋인가"를 증명할 길이 없었다.
 *    표시 버전(`HIS_VERSION`)만으로는 모자랐다 — v4.19.0 뒤로 20커밋이 더 나갔는데 버전은 그대로였다.
 *
 * 🔴 **모르면 지어내지 않는다** — 파일이 없거나(로컬 개발·기록 도입 전 빌드) 형식이 틀리면 각 필드는 `null`,
 *    `source: 'unavailable'` 로 그 사실을 말한다. 추정 커밋·현재 시각을 빌드 시각으로 쓰지 않는다.
 */
export interface BuildInfo {
  /** 빌드 시점 커밋(7~40자 hex) · 모르면 null */
  commit: string | null;
  /** 커밋되지 않은 변경을 포함해 배포했는가(`--allow-dirty`) · 모르면 null */
  dirty: boolean | null;
  /** 빌드 완료 시각(ISO-8601 UTC) · 모르면 null */
  builtAt: string | null;
  /** 기록이 가리키는 버전(배포 당시 HIS_VERSION) · 모르면 null — 실행 중 코드의 HIS_VERSION 과 다르면 기록이 낡은 것 */
  recordedVersion: string | null;
  /** 'file' = 기록을 읽었다 · 'unavailable' = 기록이 없거나 읽을 수 없다 */
  source: 'file' | 'unavailable';
}

const UNAVAILABLE: BuildInfo = { commit: null, dirty: null, builtAt: null, recordedVersion: null, source: 'unavailable' };

/** 후보 경로 — 명시 env > 실행 디렉터리 > 저장소 루트에서 실행한 경우 */
export function buildInfoCandidates(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  if (env.BUILD_INFO_PATH) out.push(env.BUILD_INFO_PATH);
  out.push(join(cwd, 'BUILD_INFO.json'), join(cwd, 'apps/api/BUILD_INFO.json'));
  return out;
}

export function parseBuildInfo(raw: string): BuildInfo {
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw) as Record<string, unknown>; } catch { return UNAVAILABLE; }
  if (!o || typeof o !== 'object') return UNAVAILABLE;
  const commit = typeof o.commit === 'string' && /^[0-9a-f]{7,40}$/.test(o.commit) ? o.commit : null;
  const dirty = typeof o.dirty === 'boolean' ? o.dirty : null;
  const builtAt = typeof o.builtAt === 'string' && !Number.isNaN(Date.parse(o.builtAt)) ? o.builtAt : null;
  const recordedVersion = typeof o.version === 'string' && /^\d+\.\d+\.\d+/.test(o.version) ? o.version : null;
  return { commit, dirty, builtAt, recordedVersion, source: 'file' };
}

export function readBuildInfo(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  read: (p: string) => string = (p) => readFileSync(p, 'utf8'),
): BuildInfo {
  for (const p of buildInfoCandidates(env, cwd)) {
    let raw: string;
    try { raw = read(p); } catch { continue; }
    return parseBuildInfo(raw);
  }
  return UNAVAILABLE;
}
