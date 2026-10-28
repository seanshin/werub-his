import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **모바일 화면이 서버 응답에 없는 필드를 읽고 있었다** (2026-08-31 · 발굴 35회차).
 *
 * 환자 토큰으로 모바일 GET 39종의 **실응답**을 저장하고 화면의 필드 접근과 대조했다:
 *   · `notices.tsx` — 서버는 `date` 를 주는데 `createdAt` 을 읽어 **모든 공지의 날짜가 빈칸**
 *   · `labs.tsx` — 서버 FE 계약은 `orderedAt`(portal.service 가 완료시각을 그 이름으로 정규화,
 *     주석으로 계약을 못박아 둠)인데 `completedAt` 을 읽어 **완료된 검사가 전부 "검사 중"**
 *     — 화면이 실제보다 덜 진행된 것으로 말했다.
 *
 * 오탐으로 접은 것: notifications(items[] 중첩에 실재) · vaccinations(표본 0 + 화면 폴백) ·
 * guardians(`include` 라 전 컬럼 실림) · imaging(PACS 503 — 자격 미설정 사람 대기).
 */
const mobile = (p: string) => readFileSync(join(process.cwd(), '..', 'mobile', 'app', p), 'utf8');
const api = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');

describe('🔴 모바일이 서버 계약 필드를 읽는다', () => {
  it('공지 날짜 — 서버가 주는 `date` 를 읽는다', () => {
    const s = mobile('(tabs)/notices.tsx');
    expect(s).toMatch(/item\.date \? formatDate\(item\.date\)/);
    expect(s, '응답에 없는 createdAt 을 다시 읽는다').not.toMatch(/item\.createdAt/);
  });

  it('검사 결과 — 서버 FE 계약 `orderedAt` 을 읽는다', () => {
    const s = mobile('(tabs)/labs.tsx');
    expect(s).toMatch(/item\.orderedAt \? formatDate\(item\.orderedAt\)/);
    expect(s, '응답에 없는 completedAt 으로 되돌아갔다 — 전부 "검사 중"이 된다')
      .not.toMatch(/item\.completedAt \?/);
  });

  it('🔴 서버 계약이 실제로 그 모양이다(대조군 — 화면만 보고 단정하지 않는다)', () => {
    const svc = api('portal/portal.service.ts');
    expect(svc).toContain('orderedAt: lr.completedAt');
    expect(svc).toContain("orderName: lr.notes ?? '검사 결과'");
  });
});

/**
 * 🔴 **표면 전수 후 잠금**(2026-08-31 · 발굴). notices·labs 외 27개 모바일 화면을
 * 서버 반환과 대조하니 실결함 0(정본 필드 우선 + 방어 폴백). 그 건강한 상태를 못박는다 —
 * 여기 필드를 서버가 개명/제거하면(다음 notices·labs 사고) 이 대조군이 먼저 실패한다.
 * 서버 쪽(내구성 있는 정본)을 검증한다. imaging 은 PACS 소유라 제외.
 */
describe('🔴 검증된 EP 의 서버 반환 필드 잠금(회귀 방지)', () => {
  const svc = api('portal/portal.service.ts');
  it('vaccinations — 화면이 읽는 vaccineName·administeredAt 을 서버가 select 한다', () => {
    const m = svc.match(/async getVaccinations[\s\S]*?\n  \}/)![0];
    expect(m).toMatch(/vaccineName: true/);
    expect(m).toMatch(/administeredAt: true/);
  });
  it('medications — 화면이 읽는 name 을 서버가 map 한다', () => {
    const m = svc.match(/async getCurrentMedications[\s\S]*?\n  \}/)![0];
    expect(m).toMatch(/name: p\.medicationCode\?\.nameKo/);
  });
  it('billings/unpaid — 화면이 읽는 totalAmount·createdAt·paidAmount 를 서버가 select 한다', () => {
    const m = svc.match(/async getUnpaidBillings[\s\S]*?\n  \}/)![0];
    for (const f of ['totalAmount: true', 'createdAt: true', 'paidAmount: true']) expect(m).toContain(f);
  });
  // 🔴 2026-10-20 결정 portal.visitSummaryScope = GENERAL — 의사 소견 원문은 환자에게 싣지 않는다(종전 잠금을 뒤집는다).
  //    모바일 진료 상세·AI 요약도 같은 릴리즈에서 진단명 기준으로 바꿨다(앱이 읽는 필드 = 서버가 주는 필드).
  it('encounters — 의사 소견 원문(assessment·plan)을 select 하지 않고, 앱도 읽지 않는다', async () => {
    const m = svc.match(/async getEncounters[\s\S]*?diagnoses:/)![0];
    expect(m).not.toMatch(/assessment: true/);
    expect(m).not.toMatch(/plan: true/);
    const { readFileSync } = await import('node:fs');
    const enc = readFileSync('../mobile/app/(tabs)/encounters.tsx', 'utf8');
    expect(enc).not.toMatch(/selected\.assessment|selected\.plan/);
  });
});
