import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 청구 라인 `codeId`(내부 UUID) → 청구 파일에 싣는 **마스터 코드**(수가 코드 · 약은 보험 제품코드, 없으면 약 코드).
 *
 * 🔴 (2026-10-14 수납·청구 결함 발굴 P2-2) 청구 EDI·XML 이 `codeId` 를 그대로 `<코드>` 에 실어 내부 UUID 가
 *    청구 파일로 나갔다. 명세서 경로(hira-edi)만 마스터 코드로 바꾸고 있었고, 그마저 못 찾으면 UUID 로 폴백했다.
 *    두 경로가 이 함수 하나를 쓴다. **못 찾은 코드는 지어내지 않고** `unresolved` 로 돌려준다 — 호출부가 거부한다.
 */
export async function resolveEdiCodes(prisma: Pick<PrismaService, 'procedureCode' | 'medicationCode'>, codeIds: string[]) {
  const ids = [...new Set(codeIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const [procs, meds] = await Promise.all([
    ids.length ? prisma.procedureCode.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } }) : [],
    ids.length ? prisma.medicationCode.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, insuranceCode: true } }) : [],
  ]);
  const map = new Map<string, string>();
  for (const p of procs) if (p.code) map.set(p.id, p.code);
  for (const m of meds) if (m.insuranceCode ?? m.code) map.set(m.id, (m.insuranceCode ?? m.code) as string);
  return map;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 옛 청구 데이터는 `code` 칸에 내부 UUID 를 담았다 — 그 값은 코드가 아니라 codeId 다 */
export function isInternalCodeId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
