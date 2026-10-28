'use client';

import Link from 'next/link';

/**
 * 스테이션 검사항목 설정 불일치 알림 — 2026-08-12 (화면 점검 W1).
 *
 * 🔴 `workstation_configs.order_codes` 가 `CBC`·`HbA1c` 같은 **별칭**인데 실제 오더는
 *    `E6591`·`E6502` 같은 **EDI 수가코드**여서, 설정 코드 중 코드 마스터에 실재하는 것이
 *    **0개**였다. 그 결과 검사 5탭·영상 6탭·진단 7탭이 **구조적으로 영원히 0건**이었다
 *    — 에러도 경고도 없이 "대기 중인 검사가 없습니다"라고만 했다.
 *
 * 서버는 이제 설정이 하나도 안 맞으면 **필터를 걸지 않고 부서 전체**를 준다(업무를 잃지 않는다).
 * 다만 그 사실을 숨기면 안 된다 — 이 배너가 "지금 보이는 것은 이 스테이션 몫이 아니라
 * 부서 전체"임을 밝힌다.
 */
export function StationConfigNotice({ meta }: {
  meta?: { configuredCodes?: number; matchedCodes?: number; configMismatch?: boolean; queueWired?: boolean };
}) {
  // 🔴 빈 목록의 뜻을 구분한다 — "할 일이 없다" 와 "아직 연결되지 않았다" 는 다르다.
  //    접수 워크스테이션은 오늘 예약이 23건인데도 0 을 보이고 있었다(2026-08-12).
  if (meta?.queueWired === false) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="mt-0.5 text-slate-500">🔌</span>
        <div className="text-xs leading-relaxed text-slate-700">
          <p className="font-semibold">이 워크스테이션에는 아직 업무 목록이 연결되지 않았습니다</p>
          <p className="mt-0.5 text-slate-600">
            비어 있는 것은 <span className="font-medium">할 일이 없다는 뜻이 아닙니다.</span>
            {' '}해당 업무는 각 도메인 화면(대기열·입원·수납 등)에서 처리해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (!meta?.configMismatch) return null;

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <span className="mt-0.5 text-amber-600">⚠️</span>
      <div className="text-xs leading-relaxed text-amber-900">
        <p className="font-semibold">
          이 스테이션의 검사항목 설정이 실제 코드와 맞지 않습니다 — 부서 전체를 표시하는 중입니다
        </p>
        <p className="mt-0.5 text-amber-800">
          설정된 {meta.configuredCodes ?? 0}개 항목이 <code className="rounded bg-amber-100 px-1">CBC</code> 같은
          별칭이라, 실제 처방코드(<code className="rounded bg-amber-100 px-1">E6591</code>)와 맞지 않습니다.
          {' '}
          {/* 🔴 S9(2026-09-13 외부 실측) — 종전 "이 설정을 고칠 화면은 아직 없습니다"는 사실이었다.
              고칠 자리를 만들었으니(/admin/workstations 「스테이션 검사항목(수가코드) 설정」) 그 자리를 가리킨다.
              편집은 관리자(ADMIN) 권한이라 이 화면 사용자에게는 "관리자가" 고친다고 말한다. */}
          목록을 이 스테이션 몫으로 좁히려면 관리자가{' '}
          <Link href="/admin/workstations" className="font-medium underline">워크스테이션-디바이스 설정</Link>
          의 「스테이션 검사항목(수가코드) 설정」에서 수가코드를 바로잡아야 합니다.
        </p>
      </div>
    </div>
  );
}
