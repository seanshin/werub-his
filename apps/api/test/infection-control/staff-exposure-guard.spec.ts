import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RecordStaffExposureDto } from '../../src/modules/infection-control/dto/infection-control.dto';
import {
  STAFF_EXPOSURE_TYPES,
  serologyOf,
  sourceStatusOf,
  sourceStatusNote,
} from '../../src/modules/infection-control/staff-exposure';

/**
 * 🔴 직원 노출 사고 영속화 가드 — 2026-08-18.
 *
 * 무엇이 잘못이었나
 *  ① 사고 기록이 **프로세스 메모리 배열**에만 남아 pm2 재기동(=매 배포)마다 전량 소실됐다.
 *     산업안전보건법·감염관리 법정기록인데 남는 것이 없었다.
 *  ② 손쉬운 오답: `SafetyIncident`(환자안전 사고 정본) 재사용. 그러면 patient-safety 통계·
 *     QI 보드·경영 대시보드가 직원 사고를 환자안전 사고로 세어 **지표가 오염된다**.
 *  ③ 손쉬운 오답 2: 원환자 감염상태 `Boolean?` 의 null 을 false 로 접기.
 *     그건 '모른다'를 '음성'이라고 말하는 것이고, PEP(노출 후 예방요법) 판단을 뒤집는다.
 *
 * 이 스펙은 셋 다 **되살아나지 못하게** 문자열·계약 수준에서 고정한다.
 */
const SERVICE = join(process.cwd(), 'src/modules/infection-control/infection-control.service.ts');
const CANON = join(process.cwd(), 'src/modules/infection-control/staff-exposure.ts');
const src = readFileSync(SERVICE, 'utf-8');

/** 주석을 뺀 코드 줄만 본다(주석 속 설명은 결함이 아니다) */
const codeLines = src.split('\n').filter((l) => {
  const t = l.trim();
  return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
});
const code = codeLines.join('\n');

/** 직원 노출 관련 코드 구간만 잘라 본다 */
function exposureSection(): string {
  const start = code.indexOf('async recordStaffExposure(');
  const end = code.indexOf('async getInfectionDashboard(');
  expect(start, 'recordStaffExposure 를 찾지 못했다').toBeGreaterThan(-1);
  return code.slice(start, end > start ? end : undefined);
}

describe('직원 노출 사고 — 영속·격리·미상(구조 가드)', () => {
  it('🔴 원장(StaffExposureIncident)에 쓴다 — 인메모리 배열로 되돌아가지 않는다', () => {
    expect(code).toContain('this.prisma.staffExposureIncident.create(');
    expect(code).toContain('this.prisma.staffExposureIncident.findMany(');
    // 종전 인메모리 구현의 흔적이 남아 있으면 실패
    expect(code, '인메모리 배열(staffExposures)이 되살아났다').not.toMatch(/private\s+staffExposures/);
    expect(code, "휘발성 상태값('RECORDED_VOLATILE')이 되살아났다").not.toContain('RECORDED_VOLATILE');
    expect(code, "IN_MEMORY_VOLATILE 표식이 되살아났다").not.toContain('IN_MEMORY_VOLATILE');
  });

  it('🔴 환자안전 정본(SafetyIncident)을 직원 사고에 재사용하지 않는다 — 지표 오염', () => {
    const section = exposureSection();
    expect(section, 'safetyIncident 를 직원 노출 기록에 쓰면 환자안전 지표가 오염된다').not.toMatch(
      /prisma\.safetyIncident/i,
    );
    expect(section).not.toMatch(/SafetyIncident/);
  });

  it('🔴 원환자 감염상태를 false 로 접지 않는다 — 미상은 null 이다', () => {
    const section = exposureSection();
    // `?? false` / `|| false` 로 접는 순간 '음성'이 원장에 박힌다
    expect(section, "sourceHbv 를 false 로 접는 코드").not.toMatch(/sourceHbv[^\n]*(\?\?|\|\|)\s*false/);
    expect(section, "sourceHcv 를 false 로 접는 코드").not.toMatch(/sourceHcv[^\n]*(\?\?|\|\|)\s*false/);
    expect(section, "sourceHiv 를 false 로 접는 코드").not.toMatch(/sourceHiv[^\n]*(\?\?|\|\|)\s*false/);
    // 3상 판정은 정본 함수 하나로만
    expect(code).toContain('sourceStatusOf(');
  });

  it('🔴 인라인 @Body(Record) 가 아니라 DTO 로 받는다 — 인라인은 ValidationPipe 를 스킵한다', async () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/modules/infection-control/infection-control.controller.ts'),
      'utf-8',
    );
    const at = controller.indexOf("@Post('staff-exposure')");
    expect(at).toBeGreaterThan(-1);
    const block = controller.slice(at, at + 800);
    expect(block).toContain('RecordStaffExposureDto');
    expect(block, '인라인 Record<string, unknown> 로 되돌아가면 검증이 통째로 빠진다').not.toMatch(
      /@Body\(\)\s*\w+:\s*Record<string, unknown>/,
    );

    // 어휘 밖 노출 유형·비UUID 는 파이프 단계에서 막힌다
    expect((await validate(plainToInstance(RecordStaffExposureDto, { exposureType: 'BOGUS' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(RecordStaffExposureDto, {}))).length).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(RecordStaffExposureDto, { exposureType: 'NEEDLESTICK', staffId: 'nope' }))).length,
    ).toBeGreaterThan(0);
    expect(
      await validate(plainToInstance(RecordStaffExposureDto, { exposureType: 'NEEDLESTICK' })),
    ).toHaveLength(0);
  });

  it('닫히지 않은 사고에 종결 시각을 박지 않는다', () => {
    const section = exposureSection();
    expect(section).toMatch(/closing\s*\?/); // closing 삼항으로만 closedAt 을 정한다
    expect(section, '무조건 closedAt: new Date() 를 쓰면 열린 사고가 종결로 보인다').not.toMatch(
      /closedAt:\s*new Date\(\),/,
    );
  });
});

describe('원환자 혈청 3상 — UNKNOWN 은 NEGATIVE 가 아니다', () => {
  it('null·undefined 는 UNKNOWN, false 만 NEGATIVE', () => {
    expect(serologyOf(null)).toBe('UNKNOWN');
    expect(serologyOf(undefined)).toBe('UNKNOWN');
    expect(serologyOf(false)).toBe('NEGATIVE');
    expect(serologyOf(true)).toBe('POSITIVE');
    // 🔴 결함 재주입 방지: UNKNOWN 을 NEGATIVE 로 접으면 아래가 깨진다
    expect(serologyOf(null)).not.toBe('NEGATIVE');
  });

  it('하나라도 미상이면 anyUnknown 이고, 사람이 읽을 문구를 준다', () => {
    const s = sourceStatusOf({ sourcePatientId: 'p1', sourceHbv: false, sourceHcv: null, sourceHiv: false });
    expect(s.anyUnknown).toBe(true);
    expect(s.anyPositive).toBe(false);
    expect(sourceStatusNote(s)).toContain('HCV');
    expect(sourceStatusNote(s)).toContain('미확인');
  });

  it('🔴 전부 판명된 경우에는 침묵한다 — 거짓 경보는 진짜 경보를 죽인다', () => {
    const s = sourceStatusOf({ sourcePatientId: 'p1', sourceHbv: false, sourceHcv: false, sourceHiv: false });
    expect(s.anyUnknown).toBe(false);
    expect(sourceStatusNote(s)).toBeNull();
  });

  it('원환자 자체가 없으면 "음성으로 간주하지 말라"고 말한다', () => {
    const s = sourceStatusOf({ sourcePatientId: null, sourceHbv: null, sourceHcv: null, sourceHiv: null });
    expect(s.sourceIdentified).toBe(false);
    expect(sourceStatusNote(s)).toContain('음성으로 간주하지 마십시오');
  });

  it('노출 유형 어휘는 정본 한 곳에서만 나온다(스키마 주석과 일치)', () => {
    const canon = readFileSync(CANON, 'utf-8');
    expect(canon).toContain("'NEEDLESTICK'");
    expect([...STAFF_EXPOSURE_TYPES]).toEqual([
      'NEEDLESTICK',
      'SHARPS',
      'SPLASH_MUCOSA',
      'SKIN_CONTACT',
      'OTHER',
    ]);
  });
});
