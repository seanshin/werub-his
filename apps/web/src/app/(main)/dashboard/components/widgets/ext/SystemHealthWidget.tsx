'use client';
import Link from 'next/link';
import { useWidgetQuery } from '../../../hooks/use-widget-query';
import WidgetForbidden from '../../WidgetForbidden';
import { T } from '@/components/ui/i18n-text';

/**
 * 시스템 상태 — 서버 `GET /api/v1/system-health`(API·DB·Redis 점검 · 관리자 전용).
 * 🔴 (2026-10-02 실화면) 종전엔 `/health` 하나를 "상태·버전" 두 칸으로 그리려 했는데, 공용 조회가 봉투 없는 응답을
 *    버려 개통 이래 "데이터 없음"이었다. 설명은 "API/DB/Redis 상태"인데 DB·Redis 는 아예 묻지 않았다.
 *    (`/health/ready` 는 외부 경로에 열려 있지 않아 브라우저가 부를 수 없다 → 같은 점검을 `/api/v1` 아래로 냈다.)
 *    점검한 것만 말한다 — 잰 적 없는 것을 초록으로 칠하지 않고, 실패는 실패라고 쓴다.
 */
type Probe = 'ok' | 'error' | null;
const TONE: Record<string, string> = { ok: 'text-emerald-700', error: 'text-rose-600 font-semibold' };

function Row({ label, value, detail }: { label: string; value: Probe | 'fail'; detail?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500"><T k={label} /></span>
      <span className={`flex items-center gap-1.5 ${value === 'ok' ? TONE.ok : value == null ? 'text-gray-400' : TONE.error}`}>
        {value === 'ok' ? <T k="정상" /> : value === 'error' ? <T k="응답 오류" /> : value === 'fail' ? <T k="조회 실패" /> : <T k="확인 중" />}
        {detail ? <span className="text-[11px] text-gray-400">{detail}</span> : null}
      </span>
    </div>
  );
}

export default function SystemHealthWidget() {
  const q = useWidgetQuery<{ api?: string; db?: string; redis?: string; version?: string; checkedAt?: string }>(
    ['widget', 'system-health'], '/api/v1/system-health', { refetchInterval: 60000 },
  );
  if (q.isForbidden) return <WidgetForbidden widgetId="system-health" />;

  // 응답이 오지 않으면 API 자체를 확인하지 못한 것이다 — DB·Redis 도 "확인 못 함"(정상으로도 오류로도 말하지 않는다)
  const state = (v: string | undefined): Probe | 'fail' => (q.error ? 'fail' : q.isLoading ? null : v === 'ok' ? 'ok' : v == null ? null : 'error');
  return (
    <div className="flex h-full flex-col text-xs">
      <Row label="API 서버" value={state(q.data?.api)} detail={q.data?.version ?? undefined} />
      <Row label="데이터베이스" value={state(q.data?.db)} />
      <Row label="캐시(Redis)" value={state(q.data?.redis)} />
      <p className="mt-2 text-[11px] text-gray-400"><T k="1분마다 다시 확인 · 데이터 정합성·흐름은 상시 감시자가 판정합니다" /></p>
      <div className="mt-auto pt-2 text-[11px]"><Link href="/admin/sentinel" className="text-blue-600 hover:underline"><T k="상시 감시자" /></Link></div>
    </div>
  );
}
