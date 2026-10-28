/**
 * 🔴 청구 '제출' 배지가 전송을 뜻하지 않는다 — 2026-08-20.
 *
 * BE 는 심평원 전송 채널이 없어 **전송하지 않고도** `status:'SUBMITTED'` 로 남긴다
 * (`ClaimStatus` 가 Prisma enum 이라 `LOCAL_RECORDED` 를 넣지 못했다 — 스키마 승인 대기).
 * BE 는 `submittedAt` 을 미전송이면 `null` 로 두고 근거를 `claimData.transmission` 에 적지만,
 * **화면이 그것을 읽지 않으면 거짓말은 그대로 남는다.** 종전 `/claims` 는
 * `toast.success('청구가 제출되었습니다.')` 를 무조건 띄웠다.
 *
 * 재주입: `claimTransmission` 이 근거 없는 건에 `transmitted: true` 를 주게 하거나,
 * 화면에서 `claimTransmission(` 호출을 빼면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { claimTransmission } from '../../src/lib/claim-transmission';

describe('claimTransmission — 3상태(전송됨·미전송·확인 불가)', () => {
  it('제출 전 상태는 따지지 않는다', () => {
    expect(claimTransmission({ status: 'DRAFT' })).toBeNull();
    expect(claimTransmission(null)).toBeNull();
  });

  it('전송된 건만 전송됨이라 말하고 접수번호를 붙인다', () => {
    const v = claimTransmission({ status: 'SUBMITTED', claimData: { transmission: { outcome: 'SENT', receiptNo: 'R-1' } } });
    expect(v?.transmitted).toBe(true);
    expect(v?.note).toContain('R-1');
  });

  it('🔴 전송되지 않았으면 사유와 수기 조치를 함께 낸다', () => {
    const v = claimTransmission({ status: 'SUBMITTED', claimData: { transmission: { outcome: 'NOT_TRANSMITTED', note: '채널 미구축', manualFallback: '포털 수기 제출' } } });
    expect(v?.transmitted).toBe(false);
    expect(v?.label).toBe('미전송');
    expect(v?.note).toContain('채널 미구축');
    expect(v?.note).toContain('포털 수기 제출');
  });

  it('🔴 근거가 없으면 "전송됨"으로 접지 않는다 — 확인 불가로 말한다(봉합 이전 과거 건)', () => {
    const v = claimTransmission({ status: 'SUBMITTED', submittedAt: '2026-01-01T00:00:00Z' });
    expect(v?.transmitted).toBeNull();
    expect(v?.label).toContain('확인 불가');
  });

  it('심사·승인 등 후속 상태도 전송 여부를 따진다', () => {
    expect(claimTransmission({ status: 'UNDER_REVIEW' })?.transmitted).toBeNull();
    expect(claimTransmission({ status: 'PAID', claimData: { transmission: { outcome: 'SENT' } } })?.transmitted).toBe(true);
  });
});

describe('구조 — /claims 화면이 정본 해석을 쓴다', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'claims', 'page.tsx'), 'utf8');

  it('제출·일괄제출 토스트가 응답을 해석한 뒤에 말한다', () => {
    expect(page).toContain('claimTransmission(');
    expect(page, "'청구가 제출되었습니다' 를 무조건 띄우던 문구가 남아 있다").not.toContain("toast.success('청구가 제출되었습니다.')");
    expect(page).not.toContain("toast.success('선택된 청구가 일괄 제출되었습니다.')");
  });

  it('🔴 목록이 미전송 건을 표시한다', () => {
    expect(page).toMatch(/claimTransmission\(c\)/);
    expect(page).toContain('aria-label={t.label}');
  });
});
