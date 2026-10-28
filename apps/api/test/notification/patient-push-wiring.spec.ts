/**
 * 🔴 환자 푸시 **발화 지점** 가드 — 2026-08-20.
 *
 * 이 파일이 지키는 것은 두 가지다:
 *   ① 발행 지점이 **사라지면 실패**한다(리스너만 남고 발행이 없던 상태로 되돌아가지 않게 —
 *      그 상태가 개통 이래 이 알림들이 한 번도 발화하지 않은 원인이었다).
 *   ② 발행 지점이 **엉뚱한 자리로 옮겨가면 실패**한다(검사 결과는 VERIFIED 이후에만 —
 *      COMPLETED 에서 보내면 검증 전 값을 환자에게 알리는 것이다).
 *
 * 재주입 검증(2026-08-20 실제 수행 — 되돌린 것 → 깨진 테스트):
 *   · `lab.service.verifyResult` 의 `emit('lab.patient_result_ready')` 삭제 → "검사 결과 발행 지점" 실패
 *   · 그 emit 을 `completeResult`(COMPLETED) 로 옮김 → "VERIFIED 블록 안에서만" 실패
 *   · `waiting-queue.callNext` 의 emit 삭제 → "진료 호출 발행 지점" 실패
 *   · 등록부에서 PATIENT_PUSH_CALLED 삭제 → "배선한 것만 등재·등재한 것만 배선" 실패
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ALERT_REGISTRY } from '../../src/modules/notification/alert-registry';
import {
  PATIENT_PUSH_TYPES,
  PATIENT_PUSH_TYPE_LIST,
  patientPushTypeKey,
  PATIENT_PUSH_MASTER_KEY,
  PATIENT_PUSH_QUIET_HOURS_KEY,
} from '../../src/modules/notification/patient-push.contract';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** 문자열 리터럴을 건너뛰며 `(`…`)` 균형 — 여는 괄호 인덱스를 받아 닫는 괄호 다음 인덱스를 준다 */
function balanceParen(src: string, i: number): number {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return i;
}

/**
 * `fn` 이름의 메서드 본문(중괄호 균형).
 *
 * 🔴 이 도구가 먼저 거짓말한 자리다 — 첫 판에서는 메서드 이름 뒤 **첫 `{`** 를 본문 시작으로 삼았는데,
 *    `verifyDispensing(id, blockchainSignature?: { … })` 처럼 **파라미터 안에 객체 타입**이 있으면
 *    그 중괄호를 본문으로 읽어 본문이 시그니처에서 끝나 버린다(실제로 발행 지점을 못 찾고 오탐했다).
 *    파라미터 괄호를 먼저 균형 맞춰 건너뛰고, 반환 타입의 `<…>` 안 중괄호도 제외한 뒤 본문을 연다.
 */
function methodBody(src: string, fn: string): string {
  const i = src.indexOf(`async ${fn}(`);
  expect(i, `${fn}() 를 찾지 못했다 — 메서드가 사라졌거나 이름이 바뀌었다`).toBeGreaterThan(-1);
  let j = balanceParen(src, src.indexOf('(', i)); // 파라미터 목록 건너뛰기
  let angle = 0;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '<') angle++;
    else if (c === '>') angle--;
    else if (c === '{' && angle === 0) break; // 본문 시작
  }
  let depth = 0;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      j++;
      while (j < src.length && src[j] !== q) {
        if (src[j] === '\\') j++;
        j++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`${fn}() 본문의 중괄호 균형을 찾지 못했다`);
}

describe('발행 지점이 존재한다 — 리스너만 있고 발행이 없던 상태로 돌아가지 않는다', () => {
  it('진료 호출: waiting-queue.callNext 가 호출 확정 후 patient.called 를 발행한다', () => {
    const body = methodBody(read('modules/waiting-queue/waiting-queue.service.ts'), 'callNext');
    expect(body).toContain("emitAsync('patient.called'");
    // 🔴 상태 전이가 끝난 뒤여야 한다 — update 보다 앞이면 "호출했다"가 아직 사실이 아니다
    expect(body.indexOf("status: 'CALLED'")).toBeLessThan(body.indexOf("emitAsync('patient.called'"));
    expect(body).toContain('notifyPatient');
  });

  it('약 조제: pharmacy.verifyDispensing(검수 완료=불출 가능) 이 prescription.ready 를 발행한다', () => {
    const src = read('modules/pharmacy/pharmacy.service.ts');
    const body = methodBody(src, 'verifyDispensing');
    expect(body).toContain("emitAsync('prescription.ready'");
    // 🔴 외래만 — 입원 조제는 병동 인계라 "약국에서 수령"이 사실이 아니다
    expect(body).toContain("careType === 'OUTPATIENT'");
    // 🔴 불출(ISSUED) 시점에서 보내면 이미 건네준 뒤라 "수령해주세요"가 거짓이 된다
    expect(methodBody(src, 'issueDispensing')).not.toContain('prescription.ready');
  });

  it('🔴 검사 결과: lab.verifyResult(VERIFIED) 에서만 발행한다 — COMPLETED(검증 전)에서는 발행하지 않는다', () => {
    const src = read('modules/lab/lab.service.ts');
    const verify = methodBody(src, 'verifyResult');
    expect(verify).toContain("emit('lab.patient_result_ready'");
    expect(verify).toContain('LabResultStatus.VERIFIED');
    // 파일 전체에서 이 이벤트는 verifyResult 안에서만 발행돼야 한다
    const all = src.split("emit('lab.patient_result_ready'").length - 1;
    expect(all, '검사 결과 환자 알림 발행은 VERIFIED 경로 1곳뿐이어야 한다').toBe(1);
    // 🔴 위급값 포함 결과는 환자에게 먼저 알리지 않는다
    expect(verify).toContain('isCriticalFlag');
  });

  it('수납 대기: billing.createFromEncounter 가 청구 생성 후 billing.patient_pending 을 발행한다', () => {
    const body = methodBody(read('modules/billing/billing.service.ts'), 'createFromEncounter');
    expect(body).toContain("emitAsync('billing.patient_pending'");
    expect(body.indexOf('billing.create(')).toBeLessThan(body.indexOf("emitAsync('billing.patient_pending'"));
    expect(body).toContain('notifyPatient');
  });

  it('🔴 담당의 답변: patient-message.reply 가 DOCTOR 행 저장 후 patient.message_replied 를 발행한다(2026-09-14)', () => {
    const body = methodBody(read('modules/patient-message/patient-message.service.ts'), 'reply');
    expect(body).toContain("emitAsync('patient.message_replied'");
    // 저장이 끝난 뒤여야 한다 — 앞이면 "답변했다"가 아직 사실이 아니다
    expect(body.indexOf("sender: 'DOCTOR'")).toBeLessThan(body.indexOf("emitAsync('patient.message_replied'"));
    expect(body).toContain('notifyPatient');
  });

  it('리스너가 7종을 모두 받는다(수신자 0 이면 아무 일도 일어나지 않는다)', () => {
    const src = read('modules/notification/notification.listener.ts');
    // 2026-10-10 +2 서류 발급 완료·반려(개별 신청 — 종전엔 실손 번들만 알림)
    for (const ev of ['patient.called', 'prescription.ready', 'lab.patient_result_ready', 'billing.patient_pending', 'patient.message_replied', 'document.ready', 'document.rejected']) {
      expect(src, `@OnEvent('${ev}') 수신자가 없다`).toContain(`@OnEvent('${ev}')`);
    }
    // 🔴 판정은 게이트 한 곳에서만 — 리스너가 직접 설정을 읽기 시작하면 정본이 둘이 된다
    expect(src).toContain('patientPush.deliver(');
    expect(src).not.toContain(PATIENT_PUSH_MASTER_KEY);
  });

  it('🔴 배선하지 않은 것의 죽은 핸들러를 남기지 않는다 — 있으면 다음 사람이 "있다"고 읽는다', () => {
    const src = read('modules/notification/notification.listener.ts');
    // 회진 예정: Round 모델에 예정 시각이 없다(roundedAt = 끝난 시각) / 예약 리마인더: 크론·통보 어댑터 부재
    expect(src).not.toContain("@OnEvent('admission.round_scheduled')");
    expect(src).not.toContain("@OnEvent('appointment.reminder')");
  });
});

describe('등록부 ↔ 배선 기계 대조 — 배선한 것만 등재하고, 등재한 것만 배선한다', () => {
  const registered = ALERT_REGISTRY.filter((d) => d.channel === 'PATIENT');

  it('등록부의 PATIENT 채널 = 실제 배선된 유형(양방향)', () => {
    expect(new Set(registered.map((d) => d.patientNotificationType))).toEqual(
      new Set(PATIENT_PUSH_TYPE_LIST.map((d) => d.type)),
    );
    expect(new Set(registered.map((d) => d.code))).toEqual(
      new Set(PATIENT_PUSH_TYPE_LIST.map((d) => d.alertCode)),
    );
  });

  it('🔴 억제 창 정본이 갈라지지 않는다 — 등록부 dedupHours × 60 = 계약 dedupMinutes', () => {
    for (const d of registered) {
      const def = PATIENT_PUSH_TYPES[d.patientNotificationType as keyof typeof PATIENT_PUSH_TYPES];
      expect(d.dedupHours, `${d.code}: 억제 없음(null)은 환자 알림에 허용하지 않는다`).not.toBeNull();
      expect(Math.round(d.dedupHours! * 60), `${d.code}: 등록부와 계약의 억제 창이 다르다`).toBe(def.dedupMinutes);
    }
  });

  it('사람 승인 전이다 — 전부 UNAPPROVED · 대상 역할은 비어 있다(직원이 아니라 환자에게 간다)', () => {
    expect(registered.length).toBeGreaterThan(0);
    for (const d of registered) {
      expect(d.approvedBy).toBe('UNAPPROVED');
      expect(d.targetKind).toBe('PATIENT');
      expect(d.targetRoles).toEqual([]);
      expect(d.emitters.length).toBeGreaterThan(0);
    }
  });

  it('발화 지점 file:line 이 실재하고 그 줄이 실제 emit 이다(옮기면 사람이 갱신한다)', () => {
    for (const d of registered) {
      for (const e of d.emitters) {
        const [rel, lineNo] = e.split(':');
        const lines = read(path.join('modules', rel)).split('\n');
        const line = lines[Number(lineNo) - 1] ?? '';
        expect(line, `${d.code}: ${e} 가 emit 지점이 아니다 — 등록부의 발화 지점을 갱신하라`).toMatch(
          /emitAsync?\(|\.emit\(/,
        );
      }
    }
  });
});

describe('설정 키가 실제로 등록돼 있다 — 관리 화면이 켤 수 있어야 한다', () => {
  const cfg = read('modules/config/config-runtime.service.ts');

  it('마스터·타입별·야간 창 키가 DEFAULTS 에 있고 기본값이 전부 OFF 다', () => {
    expect(cfg).toContain(`'${PATIENT_PUSH_MASTER_KEY}': { key: '${PATIENT_PUSH_MASTER_KEY}', value: false`);
    for (const d of PATIENT_PUSH_TYPE_LIST) {
      const k = patientPushTypeKey(d.type);
      expect(cfg, `${k} 가 시스템 설정에 없다 — 운영이 배포 없이 켤 수 없다`).toContain(
        `'${k}': { key: '${k}', value: false`,
      );
    }
    expect(cfg).toContain(`'${PATIENT_PUSH_QUIET_HOURS_KEY}'`);
  });

  it('설정 조회 EP 가 있다 — EP 를 만들면 부르는 화면까지가 한 벌(화면은 코디네이터가 붙인다)', () => {
    expect(read('modules/notification/notification.controller.ts')).toContain("@Get('patient-push/settings')");
  });
});
