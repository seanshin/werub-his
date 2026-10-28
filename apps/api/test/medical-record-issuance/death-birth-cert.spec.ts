import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * N-W1 가드 — 사망진단서(DEATH_CERT)·출생증명서(BIRTH_CERT) 발급 배선.
 * 🔴 §17 게이트는 type 문자열 하드코딩이라(실측 2026-09-06) B_GROUP 에만 추가하면
 *    "아무 의사나 사망진단서 작성"이 조용히 열린다 — 게이트 존재를 소스로 못박는다.
 * 🔴 수수료는 정본 하나(fee-rules · 2026-10-10 portal TYPE_FEES 회수) — 종전 두 곳 동시 확장 규약은 같은 서류에 금액 둘(포털 60,000 / 창구 22,000)을 만들었다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');

const svc = read('modules/medical-record-issuance/issuance.service.ts');
const svcCode = strip(svc);

describe('N-W1 — B그룹 편입과 §17 게이트', () => {
  it('B_GROUP 에 DEATH_CERT·BIRTH_CERT 가 등재되어 있다', () => {
    expect(svcCode).toMatch(/DEATH_CERT:\s*\{\s*recordType:\s*'DEATH_CERT'/);
    expect(svcCode).toMatch(/BIRTH_CERT:\s*\{\s*recordType:\s*'BIRTH_CERT'/);
  });

  it('사망진단서 게이트 — 사망 기록 필수 + 작성 자격(진료 이력 또는 사망 확인 의사)', () => {
    expect(svcCode).toContain('DEATH_RECORD_REQUIRED');
    expect(svcCode).toContain('NOT_ATTENDING_DEATH');
    // 자격 조건이 실제로 검사식에 있다(문자열만 있고 분기가 없으면 가드가 헛돈다)
    expect(svcCode).toMatch(/!treated && patient\.deathConfirmedBy !== userId/);
  });

  it('직접 사인(가)은 필수 — 빈 사인체인으로 발급되지 않는다', () => {
    expect(svcCode).toContain('CAUSE_A_REQUIRED');
    expect(svcCode).toMatch(/!causeChain\.a\?\.trim\(\)/);
  });

  it('출생증명서 게이트 — 분만 기록 필수 + 다태아는 순번 지정 필수', () => {
    expect(svcCode).toContain('DELIVERY_RECORD_REQUIRED');
    expect(svcCode).toContain('NOT_ATTENDING_BIRTH');
    expect(svcCode).toContain('NEWBORN_REQUIRED');
  });

  it('서식 종류(진단서/검안서)는 48시간 규칙으로 제안만 한다 — 자동 단정 금지', () => {
    // suggestedKind 산출식 + 의사 입력(dto) 우선 소비가 함께 있어야 한다
    expect(svcCode).toMatch(/DEATH_CERT_WINDOW_MS/);
    expect(svcCode).toMatch(/d\.certKind \?\? 'DEATH_CERT'/);
    // 최종 진료 기록 부재 시 null(판정 불가) — 0/기본값으로 접지 않는다
    expect(svcCode).toMatch(/suggestedKind = hasDeath && lastEnc/);
  });

  it('issueBGroup snapshot 이 death/birth 블록을 실어낸다(서식이 원문을 받는다)', () => {
    expect(svcCode).toMatch(/\.\.\.\(a\.death \? \{ death: a\.death \} : \{\}\)/);
    expect(svcCode).toMatch(/\.\.\.\(a\.birth \? \{ birth: a\.birth \} : \{\}\)/);
  });
});

describe('수수료 정본 하나(2026-10-10 — 포털 전용 금액표 회수)', () => {
  it('fee-rules 에 신설 2종이 있고, 포털은 따로 금액표를 두지 않고 정본 적재(loadFeeRules)를 쓴다', () => {
    const feeRules = read('modules/medical-record-issuance/fee-rules.ts');
    const portal = strip(read('modules/portal/portal.service.ts'));
    expect(feeRules.match(/DEATH_CERT:\s*\{[^}]*base:\s*(\d+)/)?.[1]).toBeTruthy();
    expect(feeRules.match(/BIRTH_CERT:\s*\{[^}]*base:\s*(\d+)/)?.[1]).toBeTruthy();
    expect(portal).not.toMatch(/TYPE_FEES/);
    expect(portal).toMatch(/loadFeeRules\(this\.prisma\)/);
    // 발급도 같은 적재 — 조회 실패를 기본값으로 접지 않는다
    expect(svcCode).toMatch(/loadFeeRules\(this\.prisma\)/);
    expect(svcCode).not.toMatch(/fee_rules'\s*\}\s*\}\)\.catch/);
  });
});

describe('N-W1 — 창구 접수(staffCreateRequest)', () => {
  it('미지 종류는 조용한 0원이 아니라 400 이다(UNKNOWN_DOC_TYPE)', () => {
    expect(svcCode).toContain('UNKNOWN_DOC_TYPE');
    expect(svcCode).toMatch(/if \(!rules\[dto\.type\]\)/);
  });

  it('수수료는 규칙엔진 정본으로 산정한다 — TYPE_FEES 중복표를 늘리지 않는다', () => {
    // staffCreateRequest 함수 블록 안에서 computeFeeWith 를 쓴다
    const fn = svcCode.slice(svcCode.indexOf('async staffCreateRequest'), svcCode.indexOf('async staffQueue'));
    expect(fn).toContain('computeFeeWith');
    expect(fn).not.toContain('TYPE_FEES');
    expect(fn).toMatch(/requesterType:\s*'STAFF'/);
  });

  it('컨트롤러에 접수 EP 가 있다(POST — 신청 경로 없는 죽은 기능 방지)', () => {
    const ctrl = read('modules/medical-record-issuance/staff-document.controller.ts');
    expect(strip(ctrl)).toMatch(/@Post\(\)\s*[\s\S]{0,600}staffCreateRequest/);
  });
});
