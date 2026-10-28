'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * PACU 퇴실 목적지 — 2026-09-30.
 * 🔴 종전 퇴실은 구분(WARD/ICU/HOME)만 적고 병상·입원·ICU 는 아무것도 바뀌지 않았다. 서버가 퇴실과 같은 트랜잭션에서
 *    원 병상 복귀·전실·ICU 입실을 처리하고, 이 부품은 **서버가 준 선택지**만 보인다(가능한 것만).
 *  · 고르기 전에는 준비 안 됨(초기값 미선택) · 권한은 서버가 정한다(전실=간호사·관리자 · 새 ICU 입실=의사)
 */
export type Destination = { mode: '' | 'RETURN' | 'MOVE' | 'ICU_EXISTING' | 'ICU_NEW' | 'HOME'; targetBedId?: string; icuBedId?: string; icuAdmitReason?: string };
type Options = {
  discharged: boolean;
  activeAdmission: { id: string; bedId: string; bed: { id: string; roomNumber: string; bedNumber: string; ward: { name: string } } | null } | null;
  activeIcuAdmission: { id: string; icuBed: { id: string; unitName: string; bedNumber: string } | null } | null;
  wardBeds: { id: string; roomNumber: string; bedNumber: string; ward: { name: string } }[];
  wardBedsTruncated: boolean;
  icuBeds: { id: string; unitName: string; bedNumber: string }[];
  icuBedsTruncated: boolean;
};

/** 목적지가 서버에 보낼 만큼 정해졌는가 */
export function destinationReady(disposition: string, d: Destination, o: Options | undefined): boolean {
  if (!o) return false;
  if (disposition === 'WARD') return !!o.activeAdmission && (d.mode === 'RETURN' || (d.mode === 'MOVE' && !!d.targetBedId));
  if (disposition === 'ICU') return o.activeIcuAdmission ? d.mode === 'ICU_EXISTING' : d.mode === 'ICU_NEW' && !!d.icuBedId && !!d.icuAdmitReason?.trim();
  if (disposition === 'HOME') return !o.activeAdmission && d.mode === 'HOME';
  return false;
}

export function useDestinationOptions(recordId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['pacu-destination-options', recordId],
    queryFn: () => apiClient.get<{ data: Options }>(`/api/v1/pacu/${recordId}/destination-options`).then((r) => r.data),
    enabled: !!recordId && enabled,
  });
}

export function DestinationPicker({ disposition, value, onChange, q, role }: {
  disposition: string; value: Destination; onChange: (d: Destination) => void;
  q: ReturnType<typeof useDestinationOptions>; role?: string;
}) {
  const tAttr = useTAttr();
  if (!disposition) return null;
  if (q.isLoading) return <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  const o = q.data;
  if (!o) return null;
  const radio = (mode: Destination['mode'], label: React.ReactNode, extra?: Partial<Destination>) => (
    <label className="flex min-h-[36px] items-center gap-2 text-xs text-gray-700">
      <input type="radio" name="pacu-dest" checked={value.mode === mode} onChange={() => onChange({ mode, ...extra })} data-pacu-dest={mode} />
      {label}
    </label>
  );
  const bedLabel = (b: { roomNumber: string; bedNumber: string; ward: { name: string } }) => `${b.ward.name} ${b.roomNumber}-${b.bedNumber}`;

  if (disposition === 'WARD') {
    if (!o.activeAdmission) {
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-pacu-dest-block="NO_ADMISSION">
          <T k="입원 중이 아닙니다 — 병동으로 보내려면 먼저 입원 수속이 필요합니다." /> <Link href="/inpatient" className="underline"><T k="입원 관리" /></Link>
        </p>
      );
    }
    const cur = o.activeAdmission.bed;
    return (
      <div className="space-y-1 rounded-lg border border-gray-100 p-2" data-pacu-dest-ward>
        {radio('RETURN', <><T k="원 병상 복귀" />{cur ? ` · ${bedLabel(cur)}` : ''}</>)}
        {radio('MOVE', <><T k="다른 병상으로" />{role && !['NURSE', 'ADMIN'].includes(role) ? <span className="text-gray-400"> (<T k="간호사·관리자만" />)</span> : null}</>, { targetBedId: '' })}
        {value.mode === 'MOVE' && (
          o.wardBeds.length === 0 ? <p className="text-[11px] text-gray-500"><T k="비어 있는 병상이 없습니다." /></p> : (
            <select value={value.targetBedId ?? ''} onChange={(e) => onChange({ ...value, targetBedId: e.target.value })} data-pacu-dest-bed
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs">
              <option value="">{tAttr('병상 선택')}</option>
              {o.wardBeds.map((b) => <option key={b.id} value={b.id}>{bedLabel(b)}</option>)}
            </select>
          )
        )}
        {o.wardBedsTruncated && value.mode === 'MOVE' && <p className="text-[10px] text-amber-700"><T k="비어 있는 병상이 많아 앞의 200개만 보입니다." /></p>}
      </div>
    );
  }
  if (disposition === 'ICU') {
    if (o.activeIcuAdmission) {
      return (
        <div className="rounded-lg border border-gray-100 p-2" data-pacu-dest-icu="EXISTING">
          {radio('ICU_EXISTING', <><T k="먼저 열린 ICU 입실로" />{o.activeIcuAdmission.icuBed ? ` · ${o.activeIcuAdmission.icuBed.unitName} ${o.activeIcuAdmission.icuBed.bedNumber}` : ''}</>)}
        </div>
      );
    }
    return (
      <div className="space-y-1 rounded-lg border border-gray-100 p-2" data-pacu-dest-icu="NEW">
        {radio('ICU_NEW', <><T k="새 ICU 입실" />{role && !['DOCTOR', 'ADMIN'].includes(role) ? <span className="text-gray-400"> (<T k="의사만" />)</span> : null}</>, { icuBedId: '', icuAdmitReason: '' })}
        {value.mode === 'ICU_NEW' && (
          o.icuBeds.length === 0 ? <p className="text-[11px] text-gray-500"><T k="비어 있는 ICU 병상이 없습니다." /></p> : (
            <>
              <select value={value.icuBedId ?? ''} onChange={(e) => onChange({ ...value, icuBedId: e.target.value })} data-pacu-dest-icubed
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs">
                <option value="">{tAttr('ICU 병상 선택')}</option>
                {o.icuBeds.map((b) => <option key={b.id} value={b.id}>{`${b.unitName} ${b.bedNumber}`}</option>)}
              </select>
              <input value={value.icuAdmitReason ?? ''} onChange={(e) => onChange({ ...value, icuAdmitReason: e.target.value })} maxLength={500} data-pacu-dest-reason
                placeholder={tAttr('ICU 입실 사유(필수)')} className="w-full rounded-lg border border-gray-200 px-2 py-2 text-xs" />
            </>
          )
        )}
      </div>
    );
  }
  // HOME
  if (o.activeAdmission) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-pacu-dest-block="ADMITTED">
        <T k="입원 중인 환자입니다 — 귀가는 퇴원 절차(퇴원요약·정산)로 합니다." /> <Link href={`/inpatient/${o.activeAdmission.id}/discharge-summary`} className="underline"><T k="퇴원요약" /></Link>
      </p>
    );
  }
  return <div className="rounded-lg border border-gray-100 p-2">{radio('HOME', <T k="귀가" />)}</div>;
}
