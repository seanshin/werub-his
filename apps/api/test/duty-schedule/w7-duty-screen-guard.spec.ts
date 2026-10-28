import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * W7 화면 가드 — 당직/근무(/duty-schedule) 화면이 "사실이 아닌 것"을 다시 말하게 되는
 * 재유입을 막는다.
 *
 * 실측된 원래 결함(2026-08-14):
 *   ① 교환/휴가 탭 전체가 프론트 하드코딩 날조(P15) — 교대 2건·휴가 4건이 `useMemo` 리터럴,
 *      API 호출 자체가 없었다. 실제 테이블은 0행.
 *   ② 그 날조 행의 [승인] 버튼이 진짜 API 를 때렸다(`swap-request/swap-001` → uuid 아님 → 500).
 *   ③ 근무시간 탭 직원 목록 10명이 실존하지 않는 mock id(`doc-001`…) — 실직원 60명 중 아무도
 *      고를 수 없었고 화면은 늘 "0시간"이라 말했다.
 *   ④ "80시간 초과 위반" 헤더가 간호사 기준(52h)을 감췄다.
 *   ⑤ 미배정일을 표에서 아예 빼서 "총 3일"이라 말했다(31일 중 28일 미배정).
 *   ⑥ 서버가 보낸 leaves·understaffed 를 화면이 버렸다.
 *   ⑦ 날짜 기본값이 UTC(`toISOString().slice(0,10)`) — KST 00:00~09:00 에 하루가 밀렸다.
 *   ⑧ 표 헤더 두 열이 모두 "야간"(야간(전) / 야간).
 *
 * 렌더 테스트가 아니라 **소스 계약** 가드다 — 위 사실이 되돌아오면 즉시 실패한다.
 */
const WEB_APP = join(__dirname, '../../../web/src/app');
const DUTY_PAGE = join(WEB_APP, '(main)/duty-schedule/page.tsx');
const SERVICE = join(__dirname, '../../src/modules/duty-schedule/duty-schedule.service.ts');

const read = (p: string) => readFileSync(p, 'utf8');
/** 결함 회고 주석에는 원래의 잘못된 코드가 그대로 적혀 있다 — 가드는 실행되는 코드만 본다 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('W7 화면 가드 — 당직/근무(/duty-schedule)', () => {
  it('가드 대상 파일이 실제로 존재한다(경로 변경 시 조용히 통과하지 않도록)', () => {
    expect(existsSync(DUTY_PAGE), `${DUTY_PAGE} 없음`).toBe(true);
    expect(existsSync(SERVICE), `${SERVICE} 없음`).toBe(true);
  });

  /* ── ①③ 날조 인물·mock id 재유입 차단 ─────────────────── */
  describe('① ③ 하드코딩 인물·mock id 는 화면에 다시 들어올 수 없다 (P15)', () => {
    it('mock staff id 패턴(doc-001·nur-001·swap-001·leave-001)이 없다', () => {
      const src = code(DUTY_PAGE);
      for (const bad of [/['"`]doc-\d{3}['"`]/, /['"`]nur-\d{3}['"`]/, /['"`]swap-\d{3}['"`]/, /['"`]leave-\d{3}['"`]/]) {
        expect(src, `mock id 재유입: ${bad}`).not.toMatch(bad);
      }
    });

    it('날조 교대/휴가 데이터에 쓰이던 인물 이름이 없다', () => {
      const src = code(DUTY_PAGE);
      // 실제 DB 에 없는데 화면이 "근무 중"이라 말하던 이름들
      for (const name of ['김태현', '이수진', '박준혁', '최미영', '정성호', '한지원', '윤서연', '장민지', '오현우', '배소영']) {
        expect(src, `하드코딩 인물명 재유입: ${name}`).not.toContain(name);
      }
    });

    it('직원 목록을 리터럴 배열로 들고 있지 않다 (STAFF_LIST 부활 금지)', () => {
      expect(code(DUTY_PAGE)).not.toMatch(/const\s+STAFF_LIST\s*=/);
    });

    it('직원 목록은 실 사용자 EP 에서 온다', () => {
      expect(code(DUTY_PAGE)).toContain('/api/v1/users');
    });

    it('교대/휴가 목록을 useMemo 리터럴로 만들지 않는다', () => {
      const src = code(DUTY_PAGE);
      expect(src).not.toMatch(/const\s+swapRequests[^=]*=\s*useMemo/);
      expect(src).not.toMatch(/const\s+leaveRequests[^=]*=\s*useMemo/);
    });
  });

  /* ── ② 존재하지 않는 요청에 승인 버튼을 달지 않는다 ────── */
  describe('② 목록 없는 승인/거절 버튼 금지', () => {
    it('조회 EP 가 없는 상태에서 swap/leave PATCH 를 호출하지 않는다', () => {
      const src = code(DUTY_PAGE);
      expect(src).not.toMatch(/duty\/swap-request\//);
      expect(src).not.toMatch(/duty\/leave-request\//);
    });

    it('교환/휴가 목록 조회 EP 는 아직 컨트롤러에 없다 (생기면 이 가드를 갱신하고 화면을 배선할 것)', () => {
      const controller = read(join(__dirname, '../../src/modules/duty-schedule/duty-schedule.controller.ts'));
      const hasGetSwap = /@Get\(\s*['"]swap-request/.test(controller);
      const hasGetLeave = /@Get\(\s*['"]leave-request/.test(controller);
      expect(
        hasGetSwap || hasGetLeave,
        '조회 EP 가 생겼다 — 화면에 "미구현" 안내 대신 실목록을 붙여야 한다',
      ).toBe(false);
    });

    it('미구현임을 화면이 정직하게 말한다', () => {
      const src = read(DUTY_PAGE);
      expect(src).toMatch(/조회할 수 없|미구현|목록 조회 API/);
    });
  });

  /* ── ④ 규정 기준 은폐 금지 ──────────────────────────── */
  describe('④ 직군별 상한을 감추지 않는다', () => {
    it('"80시간 초과"를 헤더에 고정 문구로 쓰지 않는다', () => {
      expect(code(DUTY_PAGE)).not.toMatch(/80시간\s*초과/);
    });

    it('서버가 준 직군별 상한(maxWeeklyHours·maxAllowed)을 렌더한다', () => {
      const src = code(DUTY_PAGE);
      expect(src).toContain('maxWeeklyHours');
      expect(src).toContain('maxAllowed');
      expect(src).toMatch(/v\.maxAllowed/); // 위반 행마다 적용 상한을 밝힌다
    });

    it('서버도 개인 근무시간 상한을 상수 80 으로 고정하지 않는다', () => {
      const src = code(SERVICE);
      expect(src).not.toMatch(/maxAllowed:\s*MAX_WEEKLY\b/);
      expect(src).toMatch(/weeklyLimits\(\)/);
    });
  });

  /* ── ⑤⑥ 미배정·휴가·인력부족을 숨기지 않는다 ─────────── */
  describe('⑤ ⑥ 빈 날은 "아무 일 없음"이 아니라 경고다', () => {
    it('당직표가 그 달 전체 날짜를 축으로 세운다', () => {
      const src = code(DUTY_PAGE);
      expect(src).toMatch(/function daysOfMonth/);
      expect(src).toContain('미배정');
    });

    it('서버가 보낸 leaves·understaffed 를 렌더한다', () => {
      const src = code(DUTY_PAGE);
      expect(src).toMatch(/day\.leaves\.map/);
      expect(src).toMatch(/day\.understaffed\.map/);
    });

    it('오늘 당직자 EP(on-call)를 실제로 부른다', () => {
      expect(code(DUTY_PAGE)).toContain('/api/v1/duty/on-call');
    });
  });

  /* ── ⑦ 날짜 기본값은 로컬(KST) ──────────────────────── */
  describe('⑦ 날짜 기본값은 UTC 절단이 아니다', () => {
    it('화면에 toISOString 날짜 절단이 없다', () => {
      const src = code(DUTY_PAGE);
      expect(src).not.toMatch(/toISOString\(\)\s*\.\s*split\(/);
      expect(src).not.toMatch(/toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*(10|7)\s*\)/);
    });

    it('주 시작일·현재월이 로컬 달력 성분으로 만들어진다', () => {
      const src = code(DUTY_PAGE);
      expect(src).toMatch(/function localDateKey/);
      expect(src).toMatch(/function currentWeekStart[\s\S]{0,200}localDateKey/);
      expect(src).toMatch(/function currentMonth[\s\S]{0,150}localDateKey/);
    });

    it('서버 기본 날짜/월도 UTC 가 아니다 (fmtDate(new Date()) 금지)', () => {
      const src = code(SERVICE);
      expect(src).not.toMatch(/fmtDate\(\s*new Date\(\)\s*\)/);
      expect(src).toMatch(/localDateKey\(new Date\(\)\)/);
    });
  });

  /* ── ⑧ 교대 라벨은 이 화면 안에서 한 벌·중복 금지 ─────── */
  describe('⑧ 교대 라벨 드리프트', () => {
    it('DAY/EVENING/NIGHT 라벨이 서로 다르다 (두 열이 모두 "야간"이던 것)', () => {
      const src = read(DUTY_PAGE);
      const m = src.match(/const SHIFT_LABEL[^=]*=\s*\{([^}]*)\}/);
      expect(m, 'SHIFT_LABEL 정의를 찾지 못했다').toBeTruthy();
      const body = m![1];
      const labels = [...body.matchAll(/(DAY|EVENING|NIGHT)\s*:\s*'([^']+)'/g)].map((x) => x[2]);
      expect(labels).toHaveLength(3);
      expect(new Set(labels).size, `라벨 중복: ${labels.join(' / ')}`).toBe(3);
      // 두 열이 같은 낱말로 읽히던 조합
      expect(labels).not.toContain('야간(전)');
    });

    it('교대 열 헤더를 문자열로 직접 적지 않는다 (라벨 상수로만 그린다)', () => {
      const src = code(DUTY_PAGE);
      // <th>주간</th> 처럼 상수를 우회한 헤더가 있으면 상수와 갈라진다
      expect(src).not.toMatch(/>\s*(주간|저녁|심야|야간|초번|준야)\s*(\([DEN]\))?\s*</);
    });
  });

  /* ── ⑨ 직군 스냅샷 재검증 ───────────────────────────── */
  describe('⑨ 배정 당시 직군 스냅샷을 그대로 믿지 않는다', () => {
    it('서버가 현재 UserRole 을 함께 보낸다', () => {
      const src = code(SERVICE);
      expect(src).toContain('roleNow');
      expect(src).toContain('roleMismatch');
    });

    it('화면이 재검증 결과를 쓴다', () => {
      const src = code(DUTY_PAGE);
      expect(src).toContain('roleMismatch');
      expect(src).not.toMatch(/e\.role\s*===\s*'doctor'\s*\?\s*'bg-blue/);
    });
  });
});
