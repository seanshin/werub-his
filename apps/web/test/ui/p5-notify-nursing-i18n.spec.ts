/**
 * 🔴 (2026-09-14 P5) 환자 앱 알림 발송 결과 문장·간호 스테이션 알림 문구 — UI 언어 배선.
 *
 * 왜: `patientPushMessage()` 가 한국어 리터럴을 돌려줘 약국·외래간호·대기열·환자 메시지 화면의 toast 가
 *     영어·일본어 UI 에서도 한국어였다. 간호 스테이션 부분 실패 배너는 `<b>` 조각 사이에 끼어 한 문장 한 키가 아니었다.
 *
 * 지키는 것:
 *  ① ko 출력은 종전 문장과 **글자 단위로 같다**(키=원문) — 사유 어휘 전수
 *  ② en/ja 에서는 번역되고(한글 없음), 모르는 사유 코드는 번역하지 않고 코드값 그대로 보인다
 *  ③ 🔴 간호 안전 문구는 **의도적 미등재**다(nursing 카탈로그 헤더 규약 — 부분 실패 배너·BCMA 대조 문구는
 *     오역이 안전사고가 되는 자리라 원문+티가 정직하다). 배선은 한 문장 한 키(<Tf>)로 하되 등재하지 않는다.
 *  ④ 대조군 — 같은 파일의 비안전 toast 는 실제로 등재돼 있다(③이 "아무것도 등재 안 됨"으로 통과하지 않게)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AREA_CATALOGS, catalogCopyReport, tOf } from '@hospital-run/shared';
import { patientPushMessage } from '@/components/notification/PatientNotifyConfirm';
import { useUiLocaleStore } from '@/stores/ui-locale-store';

const KO: Record<string, string | null> = {
  NOT_REQUESTED: null,
  DISABLED_BY_CONFIG: '환자 알림이 전체 설정에서 꺼져 있어 보내지 않았습니다.',
  TYPE_DISABLED: '이 종류의 환자 알림이 설정에서 꺼져 있어 보내지 않았습니다.',
  QUIET_HOURS: '야간 시간대라 보내지 않았습니다(나중에 보내지 않습니다).',
  NO_PATIENT_ACCOUNT: '환자 앱 계정이 없어 보낼 곳이 없습니다.',
  DUPLICATE_SUPPRESSED: '같은 알림이 방금 나가 중복으로 보내지 않았습니다.',
  NOT_APPLICABLE: '이 경우에는 환자 알림 대상이 아닙니다.',
  CRITICAL_WITHHELD: '위급값이 포함되어 환자 알림은 보류했습니다(의료진 통보 경로를 따릅니다).',
  NO_LISTENER: '환자 알림 처리기가 없어 아무 일도 일어나지 않았습니다.',
  ERROR: '환자 알림 발송 중 오류가 발생했습니다.',
};
const setLocale = (l: string) => useUiLocaleStore.setState({ locale: l as never });

describe('patientPushMessage — UI 언어 배선', () => {
  afterEach(() => setLocale('ko'));

  it('① ko 는 종전 문장과 같다(사유 전수·성공 2종·모르는 사유·결과 없음)', () => {
    setLocale('ko');
    for (const [reason, text] of Object.entries(KO)) expect(patientPushMessage({ sent: false, reason }), reason).toBe(text);
    expect(patientPushMessage({ sent: true })).toBe('환자 앱으로 알림을 보냈습니다.');
    expect(patientPushMessage({ sent: true, pushChannel: 'UNAVAILABLE' })).toBe('환자 앱에 알림을 기록했습니다(단말 푸시는 설정되지 않아 앱을 열어야 보입니다).');
    expect(patientPushMessage({ sent: false, reason: 'SOMETHING_NEW' })).toBe('환자 알림 미발송(SOMETHING_NEW).');
    expect(patientPushMessage({ sent: false })).toBeNull();
    expect(patientPushMessage(null)).toBeNull();
    // 프로토타입 이름을 사유로 받아도 매핑표로 오인하지 않는다
    expect(patientPushMessage({ sent: false, reason: 'toString' })).toBe('환자 알림 미발송(toString).');
  });

  it.each(['en', 'ja'])('② %s 에서는 한글이 남지 않고, 모르는 사유는 코드값을 그대로 보인다', (loc) => {
    setLocale(loc);
    for (const reason of Object.keys(KO).filter((r) => KO[r])) {
      const out = patientPushMessage({ sent: false, reason }) ?? '';
      expect(out, `${loc}/${reason}`).not.toMatch(/[가-힣]/);
      expect(out.length, `${loc}/${reason}`).toBeGreaterThan(0);
    }
    expect(patientPushMessage({ sent: true, pushChannel: 'UNAVAILABLE' })).not.toMatch(/[가-힣]/);
    const unknown = patientPushMessage({ sent: false, reason: 'SOMETHING_NEW' }) ?? '';
    expect(unknown).toContain('SOMETHING_NEW');
    expect(unknown).not.toMatch(/[가-힣]/);
  });
});

describe('간호 스테이션 — 안전 문구 의도적 미등재 · 비안전 toast 등재', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/app/(main)/nurse-station/page.tsx'), 'utf8');
  const SAFETY_UNREGISTERED = [
    '투약 스케줄 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다.',
    '활력징후 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다.',
    'I/O 기록 조회에 실패한 환자 {명수}명: {명단} — {강조}입니다.',
    '기록이 없는 것이 아니라 모르는 상태',
    '스캔 대조 일치 — 투약 확인 완료',
    '대조 실패 — 투약 중단',
  ];

  it('③ 부분 실패 배너 3종이 한 문장 한 키(<Tf>)로 배선되고, 안전 문구는 어느 언어에도 등재되지 않았다', () => {
    for (const k of SAFETY_UNREGISTERED.slice(0, 3)) expect(src, k).toContain(`<Tf k="${k}"`);
    expect(src).not.toMatch(/<span>[^<]*조회에 실패한 환자/);
    for (const k of SAFETY_UNREGISTERED) {
      for (const l of ['en', 'ja', 'ar']) expect(tOf(k, l).missing, `${k} 가 ${l} 에 등재됐다 — 간호 카탈로그 안전 문구 규약 위반`).toBe(true);
    }
  });

  it('④ 대조군 — 같은 파일의 비안전 toast 는 등재돼 있다', () => {
    for (const k of ['담당 배정 완료', 'I/O 기록이 저장되었습니다.', 'I/O 기록 저장에 실패했습니다.']) {
      expect(src, k).toContain(`tAttr('${k}')`);
      for (const l of ['en', 'ja', 'ar']) expect(tOf(k, l).missing, `${k}/${l}`).toBe(false);
    }
  });
});

/**
 * 🔴 (2026-09-14 §12-E) 카탈로그 간 사본 — `tOf` 는 먼저 등록된 카탈로그가 이기므로 뒤엣것은 **죽은 키**다.
 * 값까지 같은 사본 84개를 지웠다(런타임 출력 불변 — 이기는 쪽이 같은 값을 준다). 값이 다른 사본은
 * **어느 번역이 맞는지가 검수 몫**이라 지우지 않고 수를 동결한다(늘면 실패 — 새 사본을 만들지 말 것 · 줄면 낮춘다).
 *
 * 🔴 (2026-09-15 재실측) 종전 판정은 en/ja/ar 를 **통째로** 비교해 "같은 사본 0 · 다른 사본 91"이라 했다.
 *    그런데 조회·팩 조립은 **언어별로** 첫 값을 고른다 — 판정도 언어별이어야 한다. 91 을 언어별로 가르니
 *      · 죽은 같은 값 사본 **7**(checkup 영역 — ar 을 등재하지 않는 영역이라 "ar 없음"이 "값 다름"으로 세였다) → 삭제
 *      · 앞 영역에 없는 ar 을 **공급하는** 살아 있는 사본 **7**(components2·checkup 은 ar 미등재 영역) → 유지
 *      · 승자와 번역이 다른 죽은 사본 **77** → 지우지 않음(목록 docs/04-report/i18n-catalog-copies-2026-09-15.md)
 *    종전 가드는 en 키만 돌아 ja/ar 에만 있는 사본도 보지 못했다. 분류 정본은 shared `catalogCopyReport`
 *    (픽스처 대조군은 packages/shared/test/i18n-catalog-copies.spec.ts).
 */
describe('카탈로그 간 사본 키', () => {
  const DEAD_CONFLICT = 77;
  const LIVE_FILL = 7;

  it('죽은 같은 값 사본 0 · 번역이 다른 죽은 사본과 언어 공급 사본은 동결 수와 정확히 같다', () => {
    const r = catalogCopyReport(AREA_CATALOGS);
    expect(r.totalKeys, '카탈로그를 읽지 못했다 — 검사가 헛돈다').toBeGreaterThan(10000);
    expect(
      r.deadSame.map((x) => `${x.key} (${x.first} ← ${x.copy})`),
      '뒤 영역에 앞 영역과 같은 번역을 또 적었다 — 어떤 언어로도 화면에 나가지 않는 죽은 키다',
    ).toEqual([]);
    expect(r.deadConflict.length, '승자와 번역이 다른 새 사본 — 문맥 키(원문@문맥)로 가르거나 등재하지 말 것').toBe(DEAD_CONFLICT);
    expect(r.liveFill.length).toBe(LIVE_FILL);
  });
});
