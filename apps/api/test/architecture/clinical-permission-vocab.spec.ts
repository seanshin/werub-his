import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **임상 기록 EP 는 `PATIENT_EDIT`(인적정보 수정) 를 요구하지 않는다** (2026-08-30 운영 실측).
 *
 * DOCTOR 에서 PATIENT_EDIT 를 걷어낸 정당한 조치(정의를 실제에 맞춤)가, 그 어휘를
 * "환자 관련 쓰기 만능키"로 잘못 쓰던 임상 EP 32곳을 함께 막았다:
 *   · 의사가 **응급 트리아지·활력·입원 전환·입퇴원·전과·법정감염병 신고·격리 배정** 전부 403
 *   · 거꾸로 **접수원**(PATIENT_EDIT 보유)은 퇴원 처리·격리 배정까지 **통과**(권한 역전 —
 *     빈 body 실측: 의사 403 / 접수원 400 = 가드를 넘어 DTO 검증까지 감)
 *   · 같은 원인을 예리물 신고 자리(2026-08-18)에서 **그 핸들러만** 고친 기록이 있다 — 층이 틀렸던 것.
 *
 * 임상 기록의 어휘는 `ENCOUNTER_EDIT`(ADMIN·DOCTOR·NURSE) 다. 접수원 화면 소비처 0 을
 * 확인하고 좁혔다(admissions·infection 쓰기 소비처는 전부 의사·간호 화면).
 */
const read = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 임상 컨트롤러에 PATIENT_EDIT 가 되돌아오지 않는다', () => {
  for (const f of [
    'emergency/emergency.controller.ts',
    'admission/admission.controller.ts',
    'infection-control/infection-control.controller.ts',
  ]) {
    it(`${f} — 요구 권한에 PATIENT_EDIT 0건`, () => {
      expect(read(f)).not.toMatch(/RequirePermission\([^)]*PATIENT_EDIT/);
    });
  }

  it('checkup 임상 흐름(결과 입력·스테이션·코스 진행)도 PATIENT_EDIT 를 걷었다', () => {
    const s = read('checkup/checkup.controller.ts');
    for (const h of ["@Post('visits/:id/results')", "@Post('station/:stationId/complete')",
                     "@Post('ws/:visitId/arrive')", "@Patch('ws/:visitId/complete')"]) {
      const i = s.indexOf(h);
      expect(i, `${h} 를 찾지 못했다`).toBeGreaterThan(-1);
      expect(s.slice(i, i + 200), `${h} 가 다시 PATIENT_EDIT 를 요구한다`).not.toMatch(/PATIENT_EDIT/);
    }
  });

  it('🔴 인적정보 수정 본연의 자리는 그대로 PATIENT_EDIT 다(대조군 — 전부 걷은 게 아니다)', () => {
    expect(read('patient/patient.controller.ts')).toMatch(/RequirePermission\(Permission\.PATIENT_EDIT/);
  });

  it('🔴 DOCTOR 권한 정의에 PATIENT_EDIT 를 되돌리는 우회를 막는다', () => {
    const s = readFileSync(join(process.cwd(), 'src/modules/auth/rbac/permission.types.ts'), 'utf8');
    const blk = s.slice(s.indexOf('[UserRole.DOCTOR]'), s.indexOf(']),', s.indexOf('[UserRole.DOCTOR]')));
    expect(blk.replace(/\/\/.*$/gm, ''), 'DOCTOR 에 PATIENT_EDIT 가 복원됐다 — 어휘를 고치는 쪽이 정본이다')
      .not.toMatch(/Permission\.PATIENT_EDIT\b/);
  });

  it('접수원 본업은 열려 있다 — 예약 가용시간·통계·일 뷰(운영 403 실측분)', () => {
    const s = read('schedule/schedule.controller.ts');
    for (const h of ["@Get('availability')", "@Get('stats')", "@Get('day')"]) {
      const i = s.indexOf(h);
      expect(s.slice(i, i + 300), `${h} 에 RECEPTIONIST 없음`).toMatch(/UserRole\.RECEPTIONIST/);
    }
  });
});
