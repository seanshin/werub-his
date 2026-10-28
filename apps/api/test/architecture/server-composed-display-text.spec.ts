import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **서버가 한국어 문장을 조립하면 화면 언어를 무엇으로 바꿔도 그 줄은 한국어다.**
 *
 * 2026-09-10 실측으로 드러난 자리: `safety-quality-board.service.ts` 가 QI 표본 창 각주를
 * `지표별 최신 측정… ${qiLatestPeriod}… ${qiStaleMonths}개월 전` 로 **조립해** 내려줬고,
 * 화면은 그 문자열을 그대로 그렸다. **카탈로그로는 고칠 수 없다** — 값이 문장 안에 녹아 있기 때문이다.
 * (회수: 서버는 조각만 주고 화면이 `<Tf>` 로 조립한다.)
 *
 * 🔴 **이 수는 상한이지 확정이 아니다.** 여기서 세는 것은 "한글 + 보간이 든 템플릿 리터럴"이고,
 *    그중에는 로그·예외 메시지·내부 계산도 섞여 있다(로그는 제외했다). 화면에 실제로 닿는지는
 *    한 건씩 봐야 안다 — 그래서 "N건이 결함"이라고 말하지 않는다. 지키는 것은 **늘지 않는다** 하나다.
 *
 * 새로 늘리려면: 문장을 만들지 말고 **조각(값)을 내려보내고 화면이 조립**하게 하라.
 */

const API_SRC = path.join(__dirname, '..', '..', 'src');
const HAN = /[가-힣]/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 로그 호출의 시작 줄 — `this.logger.warn(` 처럼 인자 없이 줄이 끝나는 형태 */
const LOG_CALL_OPEN = /(logger|console)\s*\.\s*(log|warn|error|debug|verbose|info)\s*\($/;

/**
 * 한글 + 보간이 함께 든 템플릿 리터럴(주석 제거 후) — **로그 줄은 뺀다.**
 *
 * 🔴 로그 제외는 줄 단위로만 보면 새는다 — prettier 는 긴 로그를
 * `this.logger.warn(` / 템플릿 / `);` 세 줄로 나누고, 그러면 템플릿 줄에는 `logger.` 가 없다.
 * 그래서 **직전 비어 있지 않은 줄이 로그 호출의 시작인지**도 함께 본다(2026-09-22 교정).
 */
export function scanComposedKorean(code: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = stripComments(code).split('\n');
  lines.forEach((line, i) => {
    if (!HAN.test(line) || !line.includes('${')) return;
    // 로그는 화면에 나가지 않는다 — 이 축의 대상이 아니다
    if (/logger\.|console\.|this\.log\b/.test(line)) return;
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    if (j >= 0 && LOG_CALL_OPEN.test(lines[j].trimEnd())) return;
    for (const m of line.matchAll(/`([^`]*)`/g)) {
      const t = m[1];
      if (!HAN.test(t) || !t.includes('${')) continue;
      out.push({ line: i + 1, text: t.slice(0, 80) });
    }
  });
  return out;
}

function composedKoreanTemplates(): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const f of tsFiles(API_SRC)) {
    const rel = path.relative(API_SRC, f);
    for (const h of scanComposedKorean(fs.readFileSync(f, 'utf8'))) hits.push({ file: rel, ...h });
  }
  return hits;
}

/**
 * 🔴 실측 기준선(2026-09-10). **늘면 실패**, 줄면 이 수를 내린다.
 *    회수 1건(QI 표본 창 각주) 반영 후의 값이다.
 *
 * 1774 → 1792(2026-09-11 병원 정체 정본화): **새 문장이 아니라 형태 변화다.** 예약 챗·컨시어지의 기존
 *    한국어 응답 문장 17자리가 정적 문자열이었다가 병원 이름·대표전화·진료시간을 정본(hospital.* DB 행)에서
 *    끼워 넣게 되면서 "한글+보간" 으로 세어졌다(날조 상수 'Hospital RUN'·'02-1234-5678'·'09:00~18:00' 회수).
 *    +1 은 AI 프롬프트용 "확인되지 않은 항목(기관 설정 없음)" 줄(`config/hospital-facts.ts`) — 화면 문장이 아니다.
 *    두 채널 모두 한국어 전용 대화(프롬프트가 한국어 응답을 지시)라 조각 전송 대상이 아니다.
 *    (문자열 연결로 바꿔 스캐너를 피해 가지 않았다 — 그것은 가드를 속이는 것이다.)
 *
 * 1792 → 1798(2026-09-13 상용 릴리즈 T10-5 감시자 백업 상태 프로브 `sentinel/pipe-sweep.ts` `probeBackupStatus`):
 *    감시자 파이프 축 detail 6자리(사본 통과 시각·복사 실패 사유·복원 실패 파일/사유·검증 경과 시간 2·파일 읽기 오류).
 *    기존 프로브(`probeFileAge` 등)와 같은 형태 — **관리자 전용 `/admin/sentinel`**(한국어 운영 화면) 한 줄 사유다.
 *    보간 없이 말할 수 있는 3자리(경로·모르는 상태값·시각 파싱)는 정적 문장으로 바꿔 세지 않게 했다(연결로 피해 가지 않았다).
 *
 * 1798 → 1800(2026-09-13 같은 프로브에 파일 저장소 아카이브 축 `filesArchive`): detail 2자리(ARCHIVED 파일 수 · FAILED/NOT_ENCRYPTED 사유).
 *    같은 관리자 전용 감시자 한 줄 사유다. 관측 불가 3자리·필드 부재·모르는 상태값은 정적 문장으로 썼다(연결로 피해 가지 않았다).
 *
 * 1800 → 1798(2026-09-14 예약 챗 시설 안내를 CMS 3상태로): 주차 안내(대표전화 보간)·층별 안내(병원명 보간) 두 템플릿이 사라졌다.
 *    대신 정적 머리말과 CMS 본문(기관이 쓴 텍스트)을 잇는다 — 서버가 값을 끼워 만든 문장이 아니다.
 *
 * 1798 → 1797(2026-09-14 예약 여정 설명에서 예약 사유 보간을 걷었다 — 일시만 싣는다).
 *
 * 1797 → 1769(2026-09-15 I1 배치 1 · go-live 관제 사유 28자리): `go-live.service.ts` 의 항목 사유·준비율 근거를
 *    shared `serverMsg(k, params)` 로 — 화면은 `detailMsg`/`basisMsg` 를 `<ServerText>`(`<Tf>`)로 조립한다(카탈로그 `servermsg`).
 *    종전 `detail`/`basis` 문자열은 `renderServerMessageKo(msg)` 로 **같은 정본에서 파생**한다(템플릿 조립이 아니다 —
 *    `opening.service.ts` 가 아직 `item.detail` 을 읽는다). 설계 `docs/01-plan/features/server-display-text-i18n.plan.md`.
 *
 * 1769 → 1740(2026-09-15 I2 배치 2 · opening 9 + code-master 20 = 29자리): `opening.service.ts` 파생 사유(결정·위원회)·주기 라벨과
 *    `code-master/*` 고시 반영 미리보기(행 변경·오류·안내)·분류 유도·중복·내보내기 안내·분류 없음 안내·동의어 승인 경고·자동 매핑 사유를
 *    `serverMsg` 로 — 화면 `/admin/opening`·`/admin/codes` 가 `<ServerText>`(속성·토스트 자리는 `useServerTextAttr`)로 조립한다.
 *    opening 은 go-live `detailMsg` 를 옮기고 `detail` 문자열을 더 읽지 않는다. 종전 문자열 필드는 같은 정본의 한국어 파생.
 *    잔여 opening 9 = 예외 message(§2 별도 배치) · code-master 59 = 예외 20 · 감사/로그/저장 21 · AI 프롬프트 3 · 화면 소비처 없는 가져오기 응답 15.
 *    (연결로 피해 가지 않았다 — 조각 잇기는 한글 없는 키 `{head} · {tail}` 로 중첩한다.)
 * 1740 → 1717(2026-09-15 I3 배치 3 · record-timeline `record-insights.ts` 23자리): 환자 기록 '의미찾기' 묶음의 근거 문장(`noteMsg`)·
 *    항목 문장(`labelMsg`/`detailMsg`)·제목·힌트를 `serverMsg`/`{ k }` 로 — 화면 `InsightView` 가 `<ServerText>` 로 조립한다.
 *    같은 모듈의 잔여 26 = record-summary 16(규칙 요약 `lines`·`context` 는 **AI 프롬프트 재료** 겸용 — 번역하면 프롬프트가 갈라진다) ·
 *    record-issues 5(임상 판정 사유 `why` — 안전 문구 · 요약 응답·프롬프트 겸용) · 서비스 3(`{n}건` 이슈 값·검사 묶음 제목 — 시계열 카드 제목 겸 약품 동일성 재료) ·
 *    예외 1 · 프롬프트 1. checkup 44·gld 44 는 예외·AI 프롬프트·저장되는 알림 제목/게이트 위반 문구·화면 소비처 없는 판정 사유가 전부라 옮기지 않았다(설계 §6).
 * 1717 → 1692(2026-09-15 I4 예외 배치 · 25자리): 예외 message 를 `msgException(status, serverMsg(k, params))`(`common/msg-exception.ts`)로 —
 *    전역 예외 필터가 `error.msg` 로 보존하고 화면(`ApiError.msg`)이 카탈로그로 조립한다. `message` 는 같은 정본의 한국어 파생(하위 호환).
 *    opening 9(기관 항목 추가·수정·삭제 검증 — I2 가 남긴 예외 전부) · diagnostic-test 10(기초검사 워크스테이션 검사값 범위·선택지·자리 설정 —
 *    기사가 입력하다 매일 보는 오류) · 전역 쿼리 파이프 `common/pipes/date-query.pipe.ts` 6(모든 화면의 날짜·페이지 파라미터 400).
 *    diagnostic-test 잔여 1 = 델타체크 사유(`이전 대비 급변: …` — 결과에 저장되는 문장, (b)).
 * 1692 → 1690: 포털·환자 프로필·미디어의 오류 봉투 7자리를 2xx `{error}` 에서
 *    예외로 바꾸며 조립 문장 2개가 사라졌다. PACS 쓰기 실패 예외는 처음부터 조립하지 않고
 *    상태 코드를 `details` 로 내려보낸다(`pacs-proxy.service.ts` writeFailure).
 *
 * 1690 → 1647(2026-09-22 **계측 교정** — 가려진 것이 아니라 잘못 세던 것이다): 여러 줄로 나뉜 로그 호출의
 *    인자 템플릿 44자리를 세고 있었다. 이 축은 처음부터 "로그는 화면에 나가지 않는다"고 적어 두고 제외했는데,
 *    판정이 **줄 단위**라 `this.logger.warn(` 다음 줄에 놓인 템플릿에는 그 규칙이 닿지 않았다.
 *    44자리 전건을 눈으로 확인했다 — 전부 `logger.*` 인자다(감사 버퍼 폐기·NIMS 배치·감시자 스윕 요약 등).
 *    (1691 이던 실측이 1647 로 내려간 것이지, 코드에서 문장이 사라진 것이 아니다.)
 * 1647 → 1648 (2026-09-27 D3): `record-summary` 에 대화 유래 진료 출처 한 줄. 위 §잔여 26 의 사유 그대로 —
 *    규칙 요약 `lines` 는 **AI 프롬프트 재료 겸용**이라 번역하면 프롬프트가 갈라진다(화면 문장이 아니다).
 * 1648 → 1647 (2026-10-01 여정 P2): 응급 처분 구 경로가 결과와 무관하게 `응급실 처분: ${status}` 를 한 번 더 발행하던 것 제거(정본이 발행).
 * 1647 → 1645 (2026-10-02 어시스턴트 재구성): `/ai/chat` 의 `/재입원` 미산출 문장 2자리를 이유 코드(`AiChatReason`)로 — 문장은 화면이 shared 표로 만든다.
 * 1645 → 1643 (2026-10-05 수술): 부르는 화면 0 이던 `ai-opnote`(수술명·시각을 한국어 프롬프트로 조립) 제거.
 * 1643 → 1644 (2026-10-07 재입원 예측): AI 서버 권장 키 `admission_info` 의 "입원 중 수술: <수술명>"(`medical-ai/readmission-context.ts`) —
 *    AI 프롬프트 재료(patient_data)이지 화면 문장이 아니다(문자열 연결로 피해 가지 않았다).
 * 1644 → 1645 (2026-10-07 간호 인계 SBAR 초안): 투약 지연 "이름 10건 외 N건"(잘린 수를 전체로 말하지 않기) — 기존 SBAR 조립 문장 안의 중첩 1자리.
 * 1645 → 1657 (2026-10-08 QI 흐름): 저장되는 기록문 12자리 — 질 지표 알림 제목·본문 6(목표 미달·측정 미입력·직접 변경 · 기존 알림과 같은 원장 텍스트) · 위원회 안건 제목·본문 6(사고 검토·QI 보고서 — 회의록에 남는 문서). 당시 기록이라 언어 전환 대상이 아니다.
 * 1657 → 1658 (2026-10-10 이식 TDM 목표범위 이탈 알림 본문 — 기존 경보 알림과 같은 저장 원장 텍스트).
 */
const BASELINE = 1664; // 1662 → 1664 (2026-10-26 포털 B3 — 진료 차례 임박 환자 푸시 본문 2줄(앞 N명/다음 차례) · 휴대폰 잠금 화면 문구는 보낼 때 서버가 만든다 — 기존 환자 푸시 본문과 같은 자리 · 값(진료과·인원)만 끼운다) · 1661 → 1662 (2026-10-14 P3-1 — 비대면 진료 48시간 자동 취소 의사 알림이 결제 전/후로 갈려 같은 모양 문장이 하나 더 · 환불 아닌 것을 환불이라 말하지 않기 위한 분기) · 1659 → 1661 (2026-10-14 수납·청구 P2 — 일괄 청구 XML 의 `<보험유형>` 요소(파일 형식 · 표시 문장 아님)·실손 서류 ZIP 미동봉 안내 한 줄(같은 파일의 기존 안내와 같은 모양) · 새 오류 문장은 값을 details 로 내려 고정 문장으로) · 1658 → 1659 (2026-10-12 동의서 HTML 출력 시각 줄을 서명용이면 빼는 조건부 템플릿으로 — 같은 문장이 중첩 템플릿으로 한 번 더 세어진다 · HTML 문서 생성기는 서버 조립이 정본)

describe('🔴 서버가 조립한 한국어 표시 문장 — 늘지 않는다', () => {
  const hits = composedKoreanTemplates();

  it('대조군 — 스캐너가 실제로 읽었다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(tsFiles(API_SRC).length, 'api 소스를 훑지 못했다').toBeGreaterThan(1000);
    expect(hits.length, '한 건도 못 찾았다 — 정규식이 죽었다').toBeGreaterThan(100);
  });

  it('🔴 대조군 — 제외 규칙이 넓지 않다(로그만 빠지고 표시 문장은 그대로 세어진다)', () => {
    const fixture = [
      'class X {',
      '  a() {',
      '    this.logger.warn(',
      '      `로그 문장 ${v} 입니다`,',
      '    );',
      '    return {',
      '      detail:',
      '        `표시 문장 ${v} 입니다`,',
      '    };',
      '  }',
      '}',
    ].join('\n');
    const got = scanComposedKorean(fixture).map((h) => h.text);
    expect(got, '로그 인자가 세어졌거나 표시 문장을 놓쳤다').toEqual(['표시 문장 ${v} 입니다']);
  });

  it('🔴 회수한 자리가 되살아나지 않았다 — QI 표본 창 각주는 서버가 만들지 않는다', () => {
    const qi = hits.filter((h) => h.file.includes('safety-quality-board'));
    expect(qi, `서버가 다시 표시 문장을 조립하고 있다:\n${qi.map((h) => `${h.file}:${h.line} ${h.text}`).join('\n')}`).toEqual([]);
  });

  it('총량이 기준선을 넘지 않는다(늘리려면 조각을 내려보내고 화면이 조립하게 하라)', () => {
    expect(
      hits.length,
      `서버 조립 한국어 문장이 ${hits.length}건으로 기준선(${BASELINE})을 넘었다.\n` +
        '이 자리는 화면 언어를 바꿔도 한국어로 남는다 — 문장을 만들지 말고 값을 내려보내라.',
    ).toBeLessThanOrEqual(BASELINE);
  });

  it('🔴 기준선이 낡지 않았다 — 줄었으면 내려라(여유를 남기면 신규 위반을 흡수한다)', () => {
    expect(
      hits.length,
      `실측 ${hits.length} < 기준선 ${BASELINE} — 줄었으니 기준선을 ${hits.length} 로 내려라.`,
    ).toBe(BASELINE);
  });
});
