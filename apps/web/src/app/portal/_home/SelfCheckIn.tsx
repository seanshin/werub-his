'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QrImage } from '@/components/ui/QrImage';
import { buildPatientQr } from '@hospital-run/shared';
import { PT, usePortalTAttr } from '../_shared/PT';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

const DEPARTMENTS = ['내과', '외과', '소아청소년과', '산부인과', '정형외과', '안과', '이비인후과', '피부과', '비뇨의학과', '정신건강의학과', '신경외과', '가정의학과', '치과', '재활의학과'];

interface DocItem { id: string; doctorId: string; doctor?: { familyName: string; givenName: string }; waitingCount?: number; period?: string; roomName?: string }

export default function SelfCheckIn({ mrn }: { mrn?: string }) {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [dept, setDept] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<{ queueNumber?: number; departmentName?: string } | null>(null);

  const { data: docData, isError: docIsError, error: docError, refetch: refetchDocs } = useQuery({
    queryKey: ['portal-clinic-schedule', dept],
    queryFn: () => apiClient.get<{ data: DocItem[] }>(`/api/v1/portal/clinic-schedule?department=${encodeURIComponent(dept)}`),
    enabled: !!dept,
  });
  const docsRaw = docData?.data;
  const docs: DocItem[] = Array.isArray(docsRaw) ? docsRaw : (docsRaw as unknown as { data?: DocItem[] })?.data ?? [];

  const checkIn = useMutation({
    mutationFn: () => apiClient.post<{ data: { queueNumber?: number; departmentName?: string } }>('/api/v1/portal/check-in', {
      departmentName: dept, doctorId: doctorId || undefined, reason: reason || undefined, visitType: 'FOLLOW_UP',
    }),
    onSuccess: (r) => {
      setDone(r.data ?? {});
      setOpen(false); setDept(''); setDoctorId(''); setReason('');
      qc.invalidateQueries({ queryKey: ['portal-waiting'] });
    },
  });

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
        <div className="text-3xl mb-1">✅</div>
        <p className="text-sm font-bold text-gray-900"><PT k="접수 완료" /></p>
        {done.queueNumber != null && <p className="text-2xl font-bold text-emerald-700 mt-1">대기번호 {done.queueNumber}</p>}
        <p className="text-xs text-gray-500 mt-1">{done.departmentName} · 대기 현황에서 순번을 확인하세요</p>
        <button onClick={() => setDone(null)} className="mt-3 text-xs text-gray-500 underline"><PT k="닫기" /></button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-blue-100 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white">🩺</div>
          <div>
            <p className="text-sm font-bold text-gray-900"><PT k="셀프 체크인" /></p>
            <p className="text-[10px] text-gray-500"><PT k="진료과·의료진 선택 후 바로 접수" /></p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {mrn && !open && <button onClick={() => setShowQr((v) => !v)} className="px-3 py-1.5 border border-blue-200 text-blue-700 rounded-xl text-xs font-semibold hover:bg-blue-50"><PT k="내 QR" /></button>}
          {!open && <button onClick={() => setOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700"><PT k="접수하기" /></button>}
        </div>
      </div>

      {showQr && mrn && (
        <div className="mt-3 rounded-2xl bg-blue-50 border border-blue-100 p-4 text-center">
          {/* 외부 QR API 로 MRN 을 URL 쿼리에 실어 보내던 것 봉합 — 로컬 생성 + 발급 정본(buildPatientQr) */}
          <QrImage value={buildPatientQr(mrn)} size={160} alt={tAttr('체크인 QR')} className="mx-auto rounded-xl bg-white p-2" />
          <p className="text-xs text-gray-600 mt-2"><PT k="접수 데스크에서 이 QR을 보여주세요" /></p>
          <p className="text-[11px] text-gray-400">{mrn}</p>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500"><PT k="진료과" /></label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {DEPARTMENTS.map((d) => (
                <button key={d} onClick={() => { setDept(d); setDoctorId(''); }}
                  className={`px-2.5 py-1 rounded-full text-xs ${dept === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{d}</button>
              ))}
            </div>
          </div>

          {dept && (
            <div>
              <label className="text-xs font-medium text-gray-500"><PT k="의료진 (선택 안 하면 자동 배정)" /></label>
              <div className="space-y-1.5 mt-1">
                {docs.map((d) => (
                  <button key={d.id} onClick={() => setDoctorId(d.doctorId)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm ${doctorId === d.doctorId ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                    <span className="font-medium">{d.doctor?.familyName}{d.doctor?.givenName} 선생님</span>
                    <span className="text-xs text-gray-400">대기 {d.waitingCount ?? 0}명{d.roomName ? ` · ${d.roomName}` : ''}</span>
                  </button>
                ))}
                {/* 🔴 (포털 A6) 조회 실패를 "의료진 정보 없음 — 자동 배정"으로 말하지 않는다 */}
                {docIsError && <QueryErrorFallback error={docError} onRetry={() => refetchDocs()} size="compact" />}
                {!docIsError && !docs.length && <p className="text-xs text-gray-400 py-1">오늘 진료 가능한 의료진 정보가 없습니다. 자동 배정으로 접수됩니다.</p>}
              </div>
            </div>
          )}

          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('증상/사유 (선택)')} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100" />

          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm">취소</button>
            <button onClick={() => checkIn.mutate()} disabled={!dept || checkIn.isPending}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {checkIn.isPending ? '접수 중...' : '접수하기'}
            </button>
          </div>
          {checkIn.isError && <p className="text-xs text-red-500">접수 실패. 잠시 후 다시 시도하세요.</p>}
        </div>
      )}
    </div>
  );
}
