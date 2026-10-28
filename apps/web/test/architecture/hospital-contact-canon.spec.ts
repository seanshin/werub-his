import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 병원 연락처 정본 가드.
 *
 * 🔴 실측 결함(2026-08-19): 환자 포털이 응급실 번호를 `02-717-1119`, 대표번호를 `02-717-1000` 으로
 *    하드코딩하고 있었다. **둘 다 틀린 번호다**(정본 `02-000-0119` / `02-000-0000`).
 *    환자가 응급 상황에서 화면을 보고 거는 번호가 틀렸다는 뜻이고,
 *    같은 앱 안에 올바른 값이 이미 있었는데도 그랬다.
 *
 * 재주입하면 실패한다: 화면에 전화번호 리터럴을 다시 적으면 곧바로 잡힌다.
 */
const APP = path.join(__dirname, '..', '..', 'src', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const FILES = walk(APP);
const rel = (f: string) => path.relative(path.join(__dirname, '..', '..'), f);

describe('병원 연락처는 화면에 적지 않는다', () => {
  it('🔴 틀린 번호(02-717-*)가 화면에 남아 있지 않다', () => {
    const hits = FILES.filter((f) => /064-?717/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits, `틀린 병원 번호가 남아 있다:\n${hits.join('\n')}`).toEqual([]);
  });

  it('🔴 환자 포털 화면에 병원 유선번호 리터럴이 없다 — 정본에서 import 한다', () => {
    const portal = FILES.filter((f) => f.includes(`${path.sep}portal${path.sep}`));
    expect(portal.length, '포털 화면을 하나도 못 찾았다면 이 가드는 헛돈다').toBeGreaterThan(5);

    // 🔴 분류를 좁힌다 — 휴대폰(01x)은 **환자 본인** 번호 입력 placeholder 라 대상이 아니다.
    //    (넓게 잡았더니 `010-0000-0000` placeholder 가 걸렸다. 분류 정규식은 갭을 부풀린다.)
    //    병원 유선(02·0xx 지역번호)만 본다. 전부 0인 예시 번호도 제외.
    const LANDLINE = /\b0(?:2|[3-6]\d)-\d{3,4}-\d{4}\b/g;
    const offenders: string[] = [];
    for (const f of portal) {
      const hits = (fs.readFileSync(f, 'utf8').match(LANDLINE) ?? [])
        .filter((n) => !/^0\d{1,2}-0+-0+$/.test(n));
      if (hits.length) offenders.push(`${rel(f)} → ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders, `포털이 병원 번호를 직접 적고 있다:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('정본 파일이 존재하고 응급 번호를 갖는다', async () => {
    const canon = await import('../../src/lib/hospital-contact');
    expect(canon.HOSPITAL_CONTACT.emergency).toBe('02-000-0119');
    expect(canon.HOSPITAL_CONTACT.main).toBe('02-000-0000');
    expect(canon.telHref('02-000-0119')).toBe('tel:020000119');
  });

  it('🔴 서버 값이 없어도 틀린 번호를 그리지 않는다 — 모르면 119 로 접는다', async () => {
    const { emergencyPhoneOf, HOSPITAL_CONTACT } = await import('../../src/lib/hospital-contact');
    expect(emergencyPhoneOf('02-999-0000')).toBe('02-999-0000'); // 서버 값 우선
    expect(emergencyPhoneOf(null)).toBe(HOSPITAL_CONTACT.emergency);
    expect(emergencyPhoneOf('   ')).toBe(HOSPITAL_CONTACT.emergency);
  });
});
