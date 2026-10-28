import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 축 A — 데이터 정합성 스윕.
 *
 * 🔴 **기존 도구를 다시 만들지 않는다.** `infra/scripts/data-integrity-scan.sql` 은 이미
 *    도메인 횡단 불변식을 훑는다(읽기 전용 · 2026-09-13 실측 71개 = SQL 의 `SELECT '<심각도>'` 행 수 — 종전 표기 67 은 낡았다).
 *    그동안 **손으로만** 실행됐고,
 *    2026-09-02 운영에 돌려보니 20개가 위반 중이었다(적색 6). 보는 화면이 없었을 뿐이다.
 *
 * 이 모듈은 그 SQL 을 **그대로 읽어 실행**한다. 규칙을 여기 옮겨 적으면 정본이 둘이 된다.
 */

/** psql 메타커맨드(`\pset` 등)만 걷어낸다 — SQL 본문은 손대지 않는다 */
function stripPsqlMeta(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*\\/.test(l)).join('\n');
}

/**
 * 🔴 **0건 항목도 받아야 한다.** 원본 SQL 의 꼬리는 `WHERE n > 0` 으로 위반만 낸다.
 *    그러면 "평가했는데 0" 과 "평가하지 않음" 을 구분할 수 없다 — 이 감시자가 가장 피해야 할 혼동이다.
 *
 * 🔴 치환이 무동작이면 조용히 위반만 담고 "전부 해결됨"처럼 보인다.
 *    그래서 기대한 꼬리가 **정확히 한 번** 있는지 확인하고, 없으면 던진다.
 */
export function toFullScanSql(raw: string): string {
  const sql = stripPsqlMeta(raw);
  const needle = '\nWHERE n > 0\n';
  const hits = sql.split(needle).length - 1;
  if (hits !== 1) {
    throw new Error(
      `정합성 SQL 의 꼬리(WHERE n > 0)를 ${hits}회 찾았습니다(1회여야 합니다) — ` +
      '스캔 구조가 바뀌었습니다. 0건 항목을 잃은 채 돌지 않도록 중단합니다.',
    );
  }
  return sql.replace(needle, '\n');
}

export interface IntegrityRow { sev: string; chk: string; n: number }
export interface IntegrityCheck {
  /** 'integrity.09' */
  key: string;
  severity: 'RED' | 'AMBER' | 'INFO';
  label: string;
  value: number;
}

const SEVERITY: Record<string, IntegrityCheck['severity']> = {
  '🔴': 'RED',
  '🟡': 'AMBER',
  '⚪': 'INFO',
};

/**
 * `{ sev: '🔴', chk: '09 서명된 진료인데 진단 없음', n: 83 }` → 구조화.
 * 🔴 모르는 심각도를 임의로 낮추지 않는다 — 알 수 없으면 RED 로 올려 사람이 보게 한다.
 */
export function parseIntegrityRows(rows: IntegrityRow[]): IntegrityCheck[] {
  return rows.map((r) => {
    const m = /^(\S+)\s+(.*)$/.exec(String(r.chk ?? '').trim());
    const code = m ? m[1] : String(r.chk ?? '').trim();
    const label = m ? m[2] : String(r.chk ?? '').trim();
    return {
      key: `integrity.${code}`,
      severity: SEVERITY[String(r.sev ?? '').trim()] ?? 'RED',
      label,
      value: Number(r.n ?? 0),
    };
  });
}

/**
 * 워크리스트 딥링크 — "누가 어디서 고치는가"까지가 항목의 정의다.
 *
 * 🔴 **모르는 경로를 지어내지 않는다.** 확인한 것만 적고 나머지는 `null` 이며,
 *    화면은 그 자리에 "연결된 화면 없음"이라고 쓴다(빈 링크를 그리지 않는다).
 *    이 저장소에서 href 를 추측해 적었다가 실측으로 정정한 이력이 있다.
 */
export const INTEGRITY_DRILLDOWN: Record<string, string> = {
  'integrity.19': '/workstation/discharge',  // 퇴원했는데 퇴원요약 없음
  'integrity.23': '/reception',              // 하루 넘게 대기중인 접수
  'integrity.39': '/admin/voucher/list',     // 검진권 체인 불일치
  'integrity.48e': '/admin/er-beds',         // 24시간 넘게 청소 중인 베드
  'integrity.72': '/admin/retention',        // 보존기간 넘긴 전사 잔존 — DRY-RUN·파기 요청은 보존 관제 한 곳(2026-09-23 실재 확인)
  'integrity.72b': '/admin/retention',       // 기간 미설정 — 같은 화면이 설정 출처(기본값/미설정)를 말한다
};
// 🔴 처음에 /encounters·/admin/vouchers·/admin/db-health 를 적었다가 **셋 다 실재하지 않아** 지웠다
//    (추측한 6개 중 3개가 없었다). 나머지 항목은 아직 갈 화면을 확인하지 못했다 —
//    비워 두고 화면이 "연결된 화면 없음"이라 말하게 한다. 이것도 줄여야 할 목록이다.

export function readIntegritySql(repoRoot: string): string {
  return readFileSync(resolve(repoRoot, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
}
