'use client';

import Link from 'next/link';
import { useWidgetQuery } from '../../../hooks/use-widget-query';
import WidgetForbidden from '../../WidgetForbidden';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 직원 혈액·체액 노출 사고(니들스틱) — `GET /api/v1/infection-control/dashboard` 의 `staffSafety`.
 *
 * 배경(2026-08-18): 서버는 이 블록을 내려주고 있었으나 **읽는 위젯이 없었다.** 대시보드에서
 * 직원 안전은 통째로 보이지 않았다("EP 를 만들면 부르는 화면까지가 한 벌").
 *
 * 🔴 이 위젯이 지키는 것
 *  - **0 을 "사고 없음"이라 말하지 않는다.** 0 은 *이 시스템에 접수된 기록이 없다*는 뜻이고,
 *    수기 서식 접수분은 여기 없다. 그래서 서버가 주는 `zeroMeaning` 문장을 **그대로** 보여준다.
 *  - 서버가 `zeroMeaning` 을 주지 않는(=이 사실을 말하지 않는) 구버전 응답이면, 0 을 근거로
 *    안심시키지 않고 "의미 확인 불가"라고 말한다.
 *  - 값을 못 읽었으면 `0` 이 아니라 `-` 다(표본 부재 ≠ 0).
 *  - 조회 실패는 실패라고 말한다 — 빈 값·0 건으로 접지 않는다.
 */
interface StaffSafety {
  totalExposures?: number | null;
  openFollowUps?: number | null;
  sourceStatusUnknown?: number | null;
  persisted?: boolean;
  zeroMeaning?: string | null;
  /** 구버전(메모리 보관) 응답이 담던 경고 문장 */
  note?: string | null;
}

/** 못 읽은 값은 0 이 아니라 '-' */
const n = (v: number | null | undefined) => (typeof v === 'number' ? v : '-');

export default function StaffExposureWidget() {
  const tt = useTAttr();
  const { data, isLoading, isForbidden, error } = useWidgetQuery<{ staffSafety?: StaffSafety }>(
    ['widget', 'staff-exposure'],
    '/api/v1/infection-control/dashboard',
    { refetchInterval: 60000 },
  );

  if (isForbidden) return <WidgetForbidden widgetId="staff-exposure" />;
  if (isLoading) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k="로딩..." /></div>;
  if (error) return <div className="flex items-center justify-center h-full text-xs text-red-600"><T k="조회 실패 — 확인 필요" /></div>;

  const s = data?.staffSafety;
  // 🔴 응답에 블록 자체가 없으면 '0 건'이 아니라 '산출 불가'다(구버전 서버·필드 삭제).
  if (!s) {
    return (
      <div className="flex items-center justify-center h-full text-center text-xs text-amber-700 px-2">
        <T k="직원 노출 사고 집계를 서버 응답에서 찾지 못했습니다 — 산출 불가" />
      </div>
    );
  }

  const total = typeof s.totalExposures === 'number' ? s.totalExposures : null;
  const zero = total === 0;

  return (
    <div className="flex flex-col h-full justify-between gap-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{n(total)}</p>
          <p className="text-[10px] text-gray-500"><T k="접수된 노출 사고" /></p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-amber-600">{n(s.openFollowUps)}</p>
          <p className="text-[10px] text-gray-500"><T k="추적관찰 진행" /></p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-rose-600">{n(s.sourceStatusUnknown)}</p>
          <p className="text-[10px] text-gray-500"><T k="원환자 감염상태 미상" /></p>
        </div>
      </div>

      {/* 🔴 0 의 의미는 서버가 말한다 — 화면이 '사고 없음'으로 바꿔 말하지 않는다 */}
      {zero && (
        <p className="text-[10px] leading-snug text-amber-700 bg-amber-50 rounded px-2 py-1">
          {s.zeroMeaning
            ?? tt('0 건입니다. 이 응답에 0 의 뜻이 함께 오지 않아 안전하다고 읽을 수 없습니다 — 감염관리실에 확인하십시오.')}
        </p>
      )}

      {/* 원장 저장이 아니면(구버전) 법정기록으로 쓸 수 없다는 사실을 감춘 채 숫자만 보여주지 않는다 */}
      {s.persisted === false && (
        <p className="text-[10px] leading-snug text-red-700 bg-red-50 rounded px-2 py-1">
          {s.note ?? tt('이 집계는 원장에 저장되지 않아 재기동 시 소실됩니다 — 법정기록으로 쓸 수 없습니다.')}
        </p>
      )}

      <Link href="/infection/staff-exposure" className="text-[10px] text-blue-600 hover:text-blue-700 self-end">
        <T k="노출 사고 관리" /> →
      </Link>
    </div>
  );
}
