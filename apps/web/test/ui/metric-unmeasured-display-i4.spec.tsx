import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 🔴 I4(2026-09-16) — **서버가 `null`(미측정·산출 불가)을 줘도 화면이 `?? 0` 으로 그리면 같은 거짓말이다.**
 *
 * 실측 결함:
 *  · PACU Aldrete `?? 0` → "0/10" = 완전 무반응·무호흡을 단정(퇴실 기준 ≥9)
 *  · PACU 통증 `?? 0` → **초록 0/10** = 재지도 않은 환자를 "통증 없음"으로 단정
 *  · 문진 작성률 `?? 0` → 발송 0건인데 "0%"(아무도 안 썼다)
 *  · 병상 가동률 `?? 0` → 등록 병상 0인데 "가동률 0%"
 * 서버는 이미 `null` + 사유를 준다(`pacu.service`·`questionnaire-admin.service`·`dashboard.service`).
 */
const WEB = resolve(__dirname, '../../src');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

/** 주석은 코드가 아니다 — 주석에 적힌 `?? 0` 을 위반으로 세지 않는다(이 저장소에서 반복된 함정) */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

describe('🔴 미측정·산출 불가를 0 으로 그리지 않는다', () => {
  it('PACU — Aldrete·통증 점수에 `?? 0` 폴백이 없다', () => {
    const src = stripComments(read('app/(main)/surgery/components/SurgeryAdvanced.tsx'));
    expect(src).not.toMatch(/aldretScore\s*\?\?\s*0/);
    expect(src).not.toMatch(/painScore\s*\?\?\s*0/);
  });

  it('PACU — 미측정이면 값 대신 미측정 라벨을 쓰고, 게이지 막대를 그리지 않는다', () => {
    const src = read('app/(main)/surgery/components/SurgeryAdvanced.tsx');
    expect(src).toContain('UNMEASURED_LABEL'); // 정본 lib/vital-flags 의 라벨(화면마다 다른 표기 금지)
    expect(src).toMatch(/aldrete\s*!==\s*null\s*&&/); // 미측정이면 막대 자체를 렌더하지 않는다
    expect(src).toMatch(/pain\s*===\s*null\s*\?\s*'text-gray-400'/); // 미측정은 초록(정상)이 아니다
  });

  it('대조군 — 측정된 값은 그대로 그린다(구간 색도 유지)', () => {
    const src = read('app/(main)/surgery/components/SurgeryAdvanced.tsx');
    expect(src).toMatch(/aldrete >= 9 \? 'bg-emerald-500'/);
    expect(src).toMatch(/pain >= 7 \? 'text-red-600' : pain >= 4 \? 'text-amber-600'/);
  });

  it('문진 작성률 — `?? 0` 없이 서버 사유를 표시한다', () => {
    const src = stripComments(read('app/(main)/admin/forms/page.tsx'));
    expect(src).not.toMatch(/completionRate\s*\?\?\s*0/);
    expect(src).toContain('completionRateUnavailableReason');
  });

  it('병상 가동률 위젯 — `rate ?? 0` 없이 산출 불가를 말한다', () => {
    const src = stripComments(read('app/(main)/dashboard/components/widgets/ext/ChartBedsWidget.tsx'));
    expect(src).not.toMatch(/rate\s*\?\?\s*0/);
    expect(src).toMatch(/rate\s*==\s*null/);
  });

  it('대조군 — 스캐너가 주석 속 `?? 0` 을 코드로 읽지 않는다', () => {
    const fake = '// const x = rate ?? 0;\nconst y = 1;';
    expect(stripComments(fake)).not.toMatch(/rate\s*\?\?\s*0/);
  });
});
