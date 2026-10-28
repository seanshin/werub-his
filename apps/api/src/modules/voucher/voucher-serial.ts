import { createHmac, createHash, randomBytes, randomInt } from 'crypto';

import { devSwitchOn, DEV_SECRET_LITERALS } from '../../common/release-security';
// 검진권 시리얼/활성화코드 — 설계 §4(plan) · §14.11
// 시리얼: WGC-<군2><연2>-<배치4>-<일련6>-<체크4>  (체크 = HMAC(secret, 앞부분)[:4])
// 활성화코드: 별도 생성 → 해시만 저장(원문 미저장).

// 시리얼 HMAC 시크릿 — 운영(production)에서 미설정 시 fail-fast(공개 dev 폴백으로 가동 금지).
// 🔴 2026-08-25: fail-fast 조건이 `NODE_ENV === 'production'` 이었는데 운영에 그 변수가 없다 —
//    그래서 **운영에서도 공개 dev 시크릿 폴백이 열려 있었다**(시리얼 위조 가능). 기본은 fail-fast,
//    dev 폴백은 명시적 옵트인으로만(위험한 쪽이 옵트인이다).
const SERIAL_SECRET = (() => {
  const s = process.env.VOUCHER_SERIAL_SECRET || process.env.ENCRYPTION_KEY;
  if (!s) {
    if (!devSwitchOn('ALLOW_DEV_VOUCHER_SECRET')) // 🔴 T4-3 — REAL 은 옵트인으로도 공개 dev 시크릿 불가
      throw new Error('VOUCHER_SERIAL_SECRET(또는 ENCRYPTION_KEY) 미설정 — 공개 dev 시크릿으로 시리얼 발급 불가(fail-fast · 개발은 ALLOW_DEV_VOUCHER_SECRET=true 를 명시)');
    return DEV_SECRET_LITERALS.VOUCHER_SERIAL_SECRET;
  }
  return s;
})();

const CATEGORY_GROUP: Record<string, string> = {
  BASIC: 'BS', PLUS: 'PL', PRECISION: 'PR', PREMIUM: 'PM', SPECIAL: 'SP', PET_PRECISION: 'PT',
};

/** 프로그램 category → 시리얼 군 코드. 금액권형(programless)은 'AM'. */
export function groupCode(form: string, category?: string | null): string {
  if (form === 'AMOUNT') return 'AM';
  return (category && CATEGORY_GROUP[category]) || 'GN';
}

function check4(body: string): string {
  return createHmac('sha256', SERIAL_SECRET).update(body).digest('hex').slice(0, 4).toUpperCase();
}

/** 시리얼 생성. year=2자리, batchSeq/serialNo는 0패딩. */
export function makeSerial(opts: { prefix: string; group: string; year2: string; batchSeq: number; serialNo: number }): string {
  const body = `${opts.prefix}-${opts.group}${opts.year2}-${String(opts.batchSeq).padStart(4, '0')}-${String(opts.serialNo).padStart(6, '0')}`;
  return `${body}-${check4(body)}`;
}

/** 시리얼 형식·체크값 검증(오프라인 1차). */
export function verifySerialFormat(serial: string): boolean {
  const m = /^(.+-[A-Z]{2}\d{2}-\d{4}-\d{6})-([0-9A-F]{4})$/.exec(serial);
  if (!m) return false;
  return check4(m[1]) === m[2];
}

/** 활성화코드 생성(원문) — 발행 시 1회 노출, 저장은 해시만. */
export function makeActivationCode(): { code: string; hash: string } {
  // 사람이 입력 가능한 10자리 base32-ish (혼동문자 제외)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) code += alphabet[randomInt(alphabet.length)];
  return { code, hash: hashActivation(code) };
}

export function hashActivation(code: string): string {
  return createHmac('sha256', SERIAL_SECRET).update(`act:${code}`).digest('hex');
}

/** 키 정렬 canonical JSON — JSONB 라운드트립(키 재정렬)에도 해시 재현성 보장 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** 이벤트 해시(해시체인) — sha256(prevHash + serial + type + payloadHash + actorId + ts) */
export function eventHash(input: { prevHash: string; serial: string; type: string; payload: unknown; actorId: string | null; ts: string }): string {
  const payloadHash = createHash('sha256').update(stableStringify(input.payload ?? {})).digest('hex');
  return createHash('sha256')
    .update(`${input.prevHash}|${input.serial}|${input.type}|${payloadHash}|${input.actorId ?? ''}|${input.ts}`)
    .digest('hex');
}

export const GENESIS_PREV = '0'.repeat(64);

/** merkle root — leaf 해시 배열 → root(짝수 패딩, sha256 pairwise) */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return GENESIS_PREV;
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a; // 홀수면 마지막 복제
      next.push(createHash('sha256').update(a + b).digest('hex'));
    }
    level = next;
  }
  return level[0];
}

export function newIdempotencyKey(): string {
  return randomBytes(16).toString('hex');
}
