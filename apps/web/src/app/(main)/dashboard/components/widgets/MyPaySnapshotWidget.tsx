'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';
import type { ErpReadFailure } from '@hospital-run/shared';
import { useErpFailureText } from '@/app/(main)/ess/_components/ErpFailureNote';

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR') + '원';

export default function MyPaySnapshotWidget() {
  // 🔴 종전 `.catch(() => null)` — 조회 실패가 "확정 명세 없음"으로 둔갑했다(P17)
  const slip = useQuery({ queryKey: ['wt-payslip'], queryFn: () => apiClient.get<{ data: { available: boolean; failure?: ErpReadFailure; payslip?: { net?: number; period?: string; issued?: boolean } } }>('/api/v1/ess/payslip').then((r) => r.data), staleTime: 300000 });
  const p = slip.data?.payslip;
  // 🔴 R59 — `available:false`(ERP 를 못 물어봄)도 "확정 명세 없음"이 아니다. 서버가 가른 사유를 그대로 말한다.
  const erpDown = slip.data?.available === false;
  const failureText = useErpFailureText();
  return (
    <div className="flex flex-col h-full">
      <div className="text-xs text-gray-400 mb-0.5">{p?.period ? <>{`${p.period.slice(0, 4)}.${p.period.slice(4)} `}<T k="실수령" /></> : <T k="급여명세" />}</div>
      {/* 미발행(net 부재)을 '0원'으로 말하지 않는다 — 모름과 0 은 다르다(P1-ⓐ) */}
      {slip.isError ? <div className="text-xs text-red-600 py-1 font-medium"><T k="명세 조회 실패 — 확인 필요" /></div>
        : erpDown ? <div className="text-xs text-amber-600 py-1 font-medium">{failureText(slip.data?.failure)}</div>
        : p?.net != null ? <div className="text-lg font-bold text-gray-900">{won(p.net)}</div>
        : p && p.issued === false ? <div className="text-xs text-amber-600 py-1 font-medium"><T k="이번 달 명세 미발행" /></div>
        : <div className="text-xs text-gray-400 py-1"><T k="확정 명세 없음" /></div>}
      <div className="mt-auto pt-2 flex gap-3 text-[11px]">
        <Link href="/staff/payroll" className="text-blue-600 hover:underline"><T k="급여 기초정보" /></Link>
      </div>
    </div>
  );
}
