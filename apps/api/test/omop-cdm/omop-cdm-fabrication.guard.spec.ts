import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * 날조 재발 방지 가드 — OMOP CDM 화면.
 *
 * 🔴 2026-08-14 W7 실측: 이 모듈은 CDM 테이블 행수를 하드코딩(PERSON 124,500 · MEASUREMENT 3,456,700
 *    …합계 약 1,005만)하고, 품질 지표를 `Math.random()` 으로 만들고, `setTimeout(5000)` 뒤에
 *    'COMPLETED' 를 대입했다. DB 에는 OMOP 테이블이 하나도 없었다.
 *    코드가 다시 이 형태로 돌아가지 못하게 소스 자체를 검사한다(런타임 단언만으로는
 *    "그럴듯한 상수"의 부활을 막을 수 없다).
 */

const SERVICE = path.resolve(__dirname, '../../src/modules/omop-cdm/omop-cdm.service.ts');
const CONTROLLER = path.resolve(__dirname, '../../src/modules/omop-cdm/omop-cdm.controller.ts');
const WEB_PAGE = path.resolve(
  __dirname,
  '../../../web/src/app/(main)/omop-cdm/page.tsx',
);

/** 종전 하드코딩 행수 — 하나라도 소스에 남아 있으면 실패 */
const FABRICATED_COUNTS = ['124500', '892340', '1567800', '2345600', '987200', '3456700', '678900', '3240'];

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 주석(설명용으로 숫자를 인용한 줄)을 제거한 실행 코드만 검사한다 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('OMOP CDM 날조 방지 가드', () => {
  const serviceCode = codeOnly(read(SERVICE));

  it('서비스에 난수가 없다 (품질 점수·진행률·파일크기 전부 Math.random 이었다)', () => {
    expect(serviceCode).not.toMatch(/Math\.random/);
  });

  it('서비스에 가짜 완료 타이머가 없다 (setTimeout 5초 후 COMPLETED)', () => {
    expect(serviceCode).not.toMatch(/setTimeout|setInterval/);
  });

  it('서비스에 하드코딩된 CDM 테이블 행수가 없다', () => {
    for (const n of FABRICATED_COUNTS) {
      expect(serviceCode, `하드코딩 행수 ${n} 이 되살아났다`).not.toContain(n);
    }
  });

  it('서비스에 mock/dummy 데이터 헬퍼가 없다', () => {
    expect(serviceCode).not.toMatch(/mockCount|randomScore/);
  });

  it('서비스가 실제 DB(PrismaService)를 주입받는다 (종전엔 주입조차 없었다)', () => {
    expect(serviceCode).toMatch(/constructor\(private readonly prisma: PrismaService\)/);
    // 건수는 반드시 DB 에서 온다
    expect(serviceCode).toMatch(/patient\.count\(/);
    expect(serviceCode).toMatch(/this\.prisma\.\$queryRaw/);
  });

  it('CDM 건수 필드는 null 을 허용한다 (테이블 부재를 0 으로 뭉개지 않는다)', () => {
    expect(serviceCode).toMatch(/cdmRecordCount:\s*number\s*\|\s*null/);
  });

  it('존재하지 않는 다운로드 경로를 만들어 내지 않는다', () => {
    expect(serviceCode).not.toContain('/api/v1/cdm/downloads/');
  });

  it('컨트롤러의 변환/추출 EP 는 501 을 문서화한다', () => {
    const controller = read(CONTROLLER);
    expect(controller).toContain('CDM_CONVERSION_NOT_IMPLEMENTED');
    expect(controller).toContain('CDM_EXTRACT_NOT_IMPLEMENTED');
  });

  it('화면이 하드코딩 수치·가짜 진행률을 다시 그리지 않는다', () => {
    if (!existsSync(WEB_PAGE)) return; // 모노레포 밖에서 api 만 체크아웃한 경우
    const page = codeOnly(read(WEB_PAGE));
    for (const n of FABRICATED_COUNTS) {
      expect(page, `화면에 하드코딩 행수 ${n} 이 있다`).not.toContain(n);
    }
    expect(page).not.toMatch(/Math\.random/);
    // 실행하지 않고 '완료'를 표시하던 상태 배지/진행바
    expect(page).not.toMatch(/STATUS_LABEL|activeJob\.progress/);
  });

  it('화면이 CDM 미구축 사실을 반드시 말한다', () => {
    if (!existsSync(WEB_PAGE)) return;
    const page = read(WEB_PAGE);
    expect(page).toContain('CDM 미구축');
    expect(page).toContain('산출 불가');
  });
});
