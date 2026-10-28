'use client';

/**
 * 진료 후 요약(2026-10-20 포털 P3 B2 · 결정 `portal.visitSummaryScope` = GENERAL).
 *  · 일반 수준 — 진단명(추정은 추정으로)·처방 약·검사/처치 이름·다음 예약·병원 연락처 · 의사 소견 원문은 없다
 *  · 펼칠 때만 부른다 · 전체 기록은 서류 발급 신청으로(그 사실을 화면이 말한다)
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { telHref } from '@/lib/hospital-contact';
import { fmt, fmtTime } from '../_helpers';
import { PT } from '../_shared/PT';

export interface VisitSummary {
  encounterId: string;
  visitedAt: string;
  department: string | null;
  doctorName: string | null;
  diagnoses: { name: string | null; code: string | null; primary: boolean; provisional: boolean }[];
  medications: { name: string | null; dosage: string | null; frequency: string | null; durationDays: number | null; route: string | null; instructions: string | null; discontinued: boolean; dischargeMed: boolean }[];
  orders: { type: string; name: string | null }[];
  nextAppointment: { id: string; scheduledAt: string; department: string | null; doctorName: string | null } | null;
  hospitalPhone: string | null;
}

export function VisitSummaryPanel({ encounterId }: { encounterId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['portal-visit-summary', encounterId],
    queryFn: () => apiClient.get<{ data: VisitSummary }>(`/api/v1/portal/encounters/${encounterId}/summary`),
    enabled: open,
    retry: false,
  });
  const s = q.data?.data;
  const diagnoses = s?.diagnoses.filter((d) => d.name) ?? [];
  const orderNames = s?.orders.map((o) => o.name).filter((n): n is string => !!n) ?? [];

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-portal-visit-summary-toggle
        className="w-full py-2 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100">
        <PT k="진료 후 요약" /> {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-emerald-100 px-3 py-2 space-y-2 text-xs" data-portal-visit-summary>
          {q.isLoading && <p className="text-gray-500"><PT k="불러오는 중…" /></p>}
          {q.isError && <p className="text-rose-600"><PT k="진료 요약을 불러오지 못했습니다." /></p>}
          {s && (
            <>
              <section>
                <p className="font-semibold text-gray-700 mb-0.5"><PT k="진단" /></p>
                {diagnoses.length === 0
                  ? <p className="text-gray-500"><PT k="기록된 진단이 없습니다." /></p>
                  : <ul className="list-disc pl-4 text-gray-800">
                      {diagnoses.map((d, i) => (
                        <li key={i}>{d.name}{d.provisional && <span className="text-gray-500"> (<PT k="추정" />)</span>}</li>
                      ))}
                    </ul>}
              </section>
              <section>
                <p className="font-semibold text-gray-700 mb-0.5"><PT k="처방 약" /></p>
                {s.medications.length === 0
                  ? <p className="text-gray-500"><PT k="이번 진료에 처방된 약이 없습니다." /></p>
                  : <ul className="space-y-0.5 text-gray-800">
                      {s.medications.map((m, i) => (
                        <li key={i} className={m.discontinued ? 'text-gray-400 line-through' : ''}>
                          {m.name ?? <PT k="약 이름 미기록" />}
                          {[m.dosage, m.frequency, m.durationDays != null ? `${m.durationDays}일` : null].filter(Boolean).length > 0 && (
                            <span className="text-gray-500"> · {[m.dosage, m.frequency, m.durationDays != null ? `${m.durationDays}일` : null].filter(Boolean).join(' · ')}</span>
                          )}
                          {m.discontinued && <span className="no-underline"> (<PT k="중단됨" />)</span>}
                        </li>
                      ))}
                    </ul>}
              </section>
              {orderNames.length > 0 && (
                <section>
                  <p className="font-semibold text-gray-700 mb-0.5"><PT k="검사·처치" /></p>
                  <p className="text-gray-800">{orderNames.join(', ')}</p>
                  <p className="text-[11px] text-gray-500"><PT k="결과는 건강 탭에서 확인할 수 있습니다(판정은 의료진 확인 후)." /></p>
                </section>
              )}
              <section>
                <p className="font-semibold text-gray-700 mb-0.5"><PT k="다음 예약" /></p>
                {s.nextAppointment
                  ? <p className="text-gray-800">{fmt(s.nextAppointment.scheduledAt)} {fmtTime(s.nextAppointment.scheduledAt)}{s.nextAppointment.department ? ` · ${s.nextAppointment.department}` : ''}{s.nextAppointment.doctorName ? ` · ${s.nextAppointment.doctorName}` : ''}</p>
                  : <p className="text-gray-500"><PT k="잡힌 예약이 없습니다." /></p>}
              </section>
              <section className="rounded bg-gray-50 px-2 py-1.5 text-gray-600 space-y-0.5" data-portal-visit-summary-guide>
                <p><PT k="처방받은 약은 안내받은 대로 드시고, 임의로 끊거나 양을 바꾸지 마세요." /></p>
                <p><PT k="증상이 나빠지거나 새로운 증상이 생기면 병원에 문의하세요. 응급 상황이면 119에 연락하세요." /></p>
                {s.hospitalPhone
                  ? <p><PT k="병원 문의" />: <a href={telHref(s.hospitalPhone)} className="text-blue-600 underline">{s.hospitalPhone}</a></p>
                  : <p className="text-gray-400"><PT k="병원 전화번호가 등록되어 있지 않습니다." /></p>}
              </section>
              <p className="text-[11px] text-gray-400">
                <PT k="이 요약은 일반 안내 수준입니다. 진료기록 전체는 서비스 탭의 서류 발급 신청으로 받을 수 있습니다." />
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
