/**
 * Q5 (2026-09-14)
 *  ① 외국인 환자 동의서 첨부 — 서버가 말한 첨부 수만 쓴다. 응답에서 못 읽으면 `null`(모름) — 이전 수 + 1 로 지어내지 않는다.
 *  ② ESS 근태 신청 상태 — 로컬 STATUS_KO·STATUS_CLS 표 대신 결재함과 같은 shared 정본(`StatusBadge domain="hrRequest"`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachmentCountFrom } from '@/lib/upload';

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('① 첨부 수는 서버가 말한 값만', () => {
  it('응답의 attachments 길이를 읽는다(한 겹·두 겹 감싼 모양)', () => {
    expect(attachmentCountFrom({ data: { attachments: [1, 2, 3] } })).toBe(3);
    expect(attachmentCountFrom({ data: { data: { attachments: [1] } } })).toBe(1);
  });

  it('못 읽으면 null — 추정하지 않는다', () => {
    expect(attachmentCountFrom(null)).toBeNull();
    expect(attachmentCountFrom({ data: { id: 'x' } })).toBeNull();
  });

  it('등록 화면에 `이전 수 + 1` 추정이 없다', () => {
    const page = src('app/(main)/patients/register/foreign/page.tsx');
    expect(page).toContain('attachmentCountFrom(body)');
    expect(page).not.toMatch(/attachCounts\[consentId\]\s*\?\?\s*0\)\s*\+\s*1/);
  });
});

describe('③ nurse-station 모달 저장 결과 toast 는 i18n 을 지난다(안전 문구·AI 책임 고지는 규약상 원문 유지)', () => {
  const page = src('app/(main)/nurse-station/page.tsx');
  const WIRED = [
    '활력징후를 기록했습니다.', '활력징후 기록에 실패했습니다.', '간호 기록이 저장되었습니다.', '간호 기록 저장에 실패했습니다.',
    '인수 확인했습니다.', '인수 확인에 실패했습니다.', '인계를 등록했습니다 — 인수 간호사 확인 대기.', '인계 등록에 실패했습니다.',
  ];
  it.each(WIRED)('%s — tAttr 로만 나간다(생 문자열 toast 없음)', (k) => {
    expect(page).toContain(`tAttr('${k}')`);
    expect(page).not.toMatch(new RegExp(`toast\\.(success|error)\\('${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
  });
  it('저장 실패 사유 문장은 한 문장 한 키(보간)', () => {
    expect(page).toContain("tfAttr('활력징후가 저장되지 않았습니다 — {사유}'");
  });
  it('활력 입력 검증 문구(onError 가 e.message 를 toast 로 그대로 띄운다)도 tAttr 로 — 생 문자열 Error 0(2026-09-15 I3)', () => {
    expect(page).toContain("throw new Error(tAttr('환자를 선택하세요'))");
    expect(page).toContain("throw new Error(tAttr('기록할 항목을 하나 이상 입력하세요'))");
    expect(page).not.toMatch(/new Error\('[^']*[가-힣]/);
  });
  it('대조군 — AI 책임 고지 toast 는 규약대로 원문 유지(nursing 카탈로그 머리말)', () => {
    expect(page).toContain("toast.success('AI 초안을 채웠습니다 — 검토 후 확정하세요.')");
  });
});

describe('② ESS 인사 신청 상태는 shared 정본', () => {
  const ess = src('app/(main)/ess/_components/AttendanceSelfServiceSection.tsx');
  it('로컬 상태 라벨·색 표가 없다', () => {
    expect(ess).not.toMatch(/STATUS_KO\s*:/);
    expect(ess).not.toMatch(/STATUS_CLS\s*:/);
  });
  it('결재함과 같은 StatusBadge 도메인을 쓴다(대조군 — 결재함)', () => {
    expect(ess.match(/StatusBadge domain="hrRequest"/g)?.length).toBe(2);
    expect(src('app/staff/approvals/HrApprovalSection.tsx')).toContain('StatusBadge domain="hrRequest"');
  });
});
