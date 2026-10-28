/**
 * 홈페이지 빌드 상태 시각 파싱.
 *
 * 🔴 2026-09-02 실측: 상태 파일의 `ts` 는 아티팩트 파일명과 같은 압축 형식(`20260617-1748`)이라
 *    `new Date()` 가 **Invalid Date** 를 낸다. 배포 화면은 그 값을 그대로 그려 "Invalid Date" 를
 *    보여줬고, 경과 시간·상태 만료 판정이 전부 죽은 채 6월 기록이 오늘도 '배포 전환 중'으로 보였다.
 *
 * 이후 빌드는 오프셋을 포함한 ISO(`at`)를 함께 남긴다. 여기서는 **둘 다** 받는다 —
 * 옛 기록도 사람이 읽을 수 있어야 한다.
 */

import { localeDateTimeText } from '@hospital-run/shared';

/** 압축 형식은 서버 로컬시각(KST·pm2 TZ)으로 기록된다 — 오프셋이 없으므로 그렇게 읽는다. */
const KST_OFFSET = '+09:00';

export function parseBuildTs(raw?: string | null): Date | null {
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  const iso = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:00${KST_OFFSET}`
    : raw;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** 표시용 — 읽을 수 없는 값이면 원문을 그대로 보여준다(지어내지 않는다). */
export function formatBuildTs(raw?: string | null): string {
  if (!raw) return '';
  const d = parseBuildTs(raw);
  return d ? localeDateTimeText(d, 'ko-KR') : raw;
}

/**
 * 경과 시간 — 시각만 적으면 아무도 그 시각을 읽지 않는다.
 * 읽을 수 없는 값이면 빈 문자열(모르는 것을 아는 척하지 않는다).
 */
export function buildTsAge(raw?: string | null): string {
  const d = parseBuildTs(raw);
  if (!d) return '';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/** 경과 밀리초 — 판정용. 읽을 수 없으면 null(=판정하지 않는다). */
export function buildTsAgeMs(raw?: string | null): number | null {
  const d = parseBuildTs(raw);
  return d ? Date.now() - d.getTime() : null;
}
