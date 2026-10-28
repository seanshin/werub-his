/**
 * 🔴 활력 수집 결과 해석 — **정본은 여기 하나다.**
 *
 * 배경(2026-08-20 실측): `POST /api/v1/vitals` 는 중복 재수신·저장 보류일 때 **200 에 `data: null`**
 * 을 돌려줬고, 사유는 **서버 로그에만** 있었다. 화면은 "저장됨"으로 보이거나 아무 말도 하지 않았다.
 * 이제 서버가 `meta.ingest` 로 판정을 함께 준다. 그 판정을 문장으로 바꾸는 일을 화면마다
 * 다시 쓰면 어휘가 갈라지므로(정본이 둘이면 갈라진다) 이 파일만 쓴다.
 *
 * 🔴 `dedupeChecked === false` 는 **"중복 없음"이 아니라 "판정 불가"** 다 — 측정 시각을 모르면
 * 중복을 잴 수 없다. 그 사실을 "확인했다"로 바꿔 말하지 않는다.
 */
import { vitalsTimeFlagText } from '@hospital-run/shared';

export type VitalsIngestStatus = 'STORED' | 'DUPLICATE' | 'PENDING';

export interface VitalsIngestMeta {
  status: VitalsIngestStatus;
  pendingReason: string | null;
  duplicateOfId: string | null;
  timeFlags: string[];
  dedupeChecked: boolean;
  measuredAt: string | null;
}

export interface VitalsIngestNotice {
  level: 'ok' | 'warn' | 'error';
  /** 화면·토스트에 그대로 쓰는 한 문장 */
  text: string;
  /** 저장됐는가 — 이 값만이 "기록됨"의 근거다 */
  stored: boolean;
}

/**
 * 🔴 2026-08-20 사고 — 이 자리에 화면이 **자기 어휘**를 적어 뒀다
 * (`FUTURE`/`UNKNOWN_MEASURED_AT`/`FAR_PAST`). 서버가 내는 값과 **교집합이 0**이라
 * 모든 플래그가 폴백 문구로 떨어졌고, 가드는 **화면이 지어낸 어휘를 테스트해서** 통과했다.
 * 값과 문구의 정본은 이제 shared 하나다.
 */

/**
 * `meta.ingest` 를 한 문장으로. 저장됐고 특이사항이 없으면 `null`(조용히 통과).
 * 🔴 meta 자체가 없으면 **저장 여부를 모른다** — "저장됨"이라 단정하지 않는다.
 */
export function vitalsIngestNotice(meta?: VitalsIngestMeta | null): VitalsIngestNotice | null {
  if (!meta) return null;

  if (meta.status === 'DUPLICATE') {
    return { level: 'warn', stored: false, text: '같은 측정이 이미 기록되어 있어 저장하지 않았습니다(중복 재수신).' };
  }
  if (meta.status === 'PENDING') {
    const why = meta.pendingReason ? `사유: ${meta.pendingReason}` : '사유가 전달되지 않았습니다';
    return { level: 'error', stored: false, text: `활력이 저장되지 않았습니다 — ${why}. 다시 입력해 주세요.` };
  }

  const notes: string[] = [];
  for (const f of meta.timeFlags ?? []) notes.push(vitalsTimeFlagText(f));
  // 🔴 판정을 못 한 것을 "중복 아님"으로 말하지 않는다
  if (meta.dedupeChecked === false) notes.push('측정 시각을 몰라 중복 여부를 확인하지 못했습니다');

  if (notes.length === 0) return null;
  return { level: 'warn', stored: true, text: `저장했습니다 — 다만 ${notes.join(' · ')}.` };
}

/** 응답 봉투에서 `meta.ingest` 만 꺼낸다(모양이 다르면 `null`) */
export function ingestOf(res: unknown): VitalsIngestMeta | null {
  const m = (res as { meta?: { ingest?: VitalsIngestMeta } } | null)?.meta?.ingest;
  return m && typeof m.status === 'string' ? m : null;
}
