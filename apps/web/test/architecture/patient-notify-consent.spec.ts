/**
 * 🔴 환자 앱 알림 — **승인 없이 나가지 않는다** (2026-08-20).
 *
 * 정책(사람 지시): 대외 발신은 **구현 + 설정 + 승인** 셋을 모두 만족할 때만 나간다.
 * 서버는 `notifyPatient: true` 가 없으면 설정이 켜져 있어도 보내지 않는다(`NOT_REQUESTED`).
 *
 * 이 가드가 막는 두 가지:
 * ① 훅을 쓰면서 **다이얼로그를 렌더하지 않는 것** — 물어보지 못하면 알림은 영원히 안 나간다
 *    (이 저장소가 반복해서 다친 "만들었는데 부르는 화면이 없다"의 UI 판)
 * ② 옵트인 EP 를 부르면서 `notifyPatient` 를 **빼먹는 것** — 조용히 안 나간다
 *
 * 재주입: `{notify.dialog}` 를 지우거나 `notifyPatient` 를 빼면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', 'src');
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
};
const FILES = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);

describe('환자 알림 승인 — 물어볼 수 있어야 보낼 수 있다', () => {
  it('🔴 훅을 쓰는 화면은 다이얼로그를 렌더한다', () => {
    const users = FILES.filter((f) => !f.includes('PatientNotifyConfirm') && fs.readFileSync(f, 'utf8').includes('usePatientNotifyConfirm('));
    expect(users.length, '훅 사용처를 하나도 못 찾았다 — 정본 위치가 바뀌었는가').toBeGreaterThan(0);
    const missing = users.filter((f) => !/\{\s*\w+\.dialog\s*\}/.test(fs.readFileSync(f, 'utf8')));
    expect(missing.map(rel), '승인 다이얼로그를 렌더하지 않는다 — 물어보지 못하면 알림이 영원히 안 나간다').toEqual([]);
  });

  it('🔴 옵트인 EP 호출은 notifyPatient 를 실어 보낸다', () => {
    // 서버가 옵트인을 요구하는 경로(`{ notifyPatient }` 없으면 NOT_REQUESTED 로 조용히 미발송)
    const OPT_IN = [/\/(?:waiting-)?queue\/\$\{[^}]+\}\/call`/, /dispense\/\$\{[^}]+\}\/verify`/];
    const offenders: string[] = [];
    for (const f of FILES) {
      const s = fs.readFileSync(f, 'utf8');
      for (const re of OPT_IN) {
        for (const m of s.matchAll(new RegExp(re.source, 'g'))) {
          const around = s.slice(m.index!, m.index! + 220);
          if (!around.includes('notifyPatient')) offenders.push(`${rel(f)} :: ${m[0]}`);
        }
      }
    }
    expect(offenders, 'notifyPatient 없이 호출한다 — 환자 알림이 조용히 나가지 않는다').toEqual([]);
  });

  it('발송 결과 문구는 서버 사유를 그대로 옮긴다 — 없는 사유를 지어내지 않는다', () => {
    const src = fs.readFileSync(path.join(SRC, 'components', 'notification', 'PatientNotifyConfirm.tsx'), 'utf8');
    // 서버 계약(patient-push.contract.ts)의 사유가 모두 문구를 갖는다
    for (const r of ['NOT_REQUESTED', 'DISABLED_BY_CONFIG', 'TYPE_DISABLED', 'QUIET_HOURS',
                     'NO_PATIENT_ACCOUNT', 'DUPLICATE_SUPPRESSED', 'NOT_APPLICABLE',
                     'CRITICAL_WITHHELD', 'NO_LISTENER', 'ERROR']) {
      expect(src, `${r} 사유에 대한 문구가 없다`).toContain(`'${r}'`);
    }
    // 🔴 단말 푸시가 없으면 "보냈습니다"라 말하지 않는다
    expect(src).toContain('UNAVAILABLE');
    expect(src).toContain('앱을 열어야');
  });
});
