'use client';

import { T, Data, useTAttr } from '@/components/ui/i18n-text';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, Unit } from '@/components/ui/display';
import { ImagingSafetyPrecheck } from '@/components/imaging/ImagingSafetyPrecheck';

/**
 * 간호 워크스테이션 — 환자 영상.
 *
 * 🔴 종전에는 PACS 를 직접 부르면서 `localStorage['pacs-token']` 을 읽었다. 그 토큰은 `/pacs-portal`
 *    에서 **별도 PACS 로그인**을 해야만 생기므로, 간호사가 이 화면에 바로 들어오면 토큰이 없어
 *    조회가 빈 배열을 반환하고 "등록된 영상이 없습니다"로 표시됐다 — 영상이 있어도. 401·오류도
 *    같은 문구로 삼켜졌다. 차트 영상 탭이 쓰는 **HIS 프록시**(`/api/v1/pacs/*`)로 바꾼다(HIS 로그인 그대로).
 *
 * 간호 업무에 맞춰 세 가지를 함께 본다:
 *  1. 오늘 촬영 대상(워크리스트) — 이름을 알아야만 쓰는 검색 전용 화면은 병동에서 쓸 수 없다
 *  2. 환자별 영상 + 판독문(예비/최종 구분)
 *  3. 이송 전 안전 확인 — `components/imaging/ImagingSafetyPrecheck`(조영제·신기능·임신·누적선량)
 */
interface PacsStudy {
  study_instance_uid?: string;
  study_uid?: string;
  study_date?: string;
  modality?: string;
  description?: string;
  study_description?: string;
  instances?: number;
}

interface PacsReport {
  id?: string;
  study_uid?: string;
  status?: string;
  findings?: string;
  conclusion?: string;
  radiologist_name?: string;
}

interface WorklistItem {
  accession_number?: string;
  patient_id?: string;
  patient_name?: string;
  modality?: string;
  study_description?: string;
  scheduled_date?: string;
  scheduled_time?: string;
}

const REPORT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: '초안', cls: 'bg-gray-100 text-gray-600' },
  PRELIMINARY: { label: '예비판독', cls: 'bg-amber-50 text-amber-700' },
  FINAL: { label: '최종판독', cls: 'bg-emerald-50 text-emerald-700' },
};

const fmtDate = (v?: string) => (v ? v.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : '-');

export default function NurseImagingPage() {
  const tAttr = useTAttr();
  const [patientSearch, setPatientSearch] = useState('');
  const [selected, setSelected] = useState<{ mrn: string; name: string; id?: string } | null>(null);

  const { data: searchRes } = useQuery({
    queryKey: ['nurse-imaging-patient-search', patientSearch],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { id: string; mrn: string; familyName: string; givenName: string }[] }>(
        // 🔴 파라미터 이름은 `q` 다. 종전엔 `search` 를 보냈고, 전역 `whitelist:true` 가 그것을
        //    **조용히 지워** 서버가 필터 없이 첫 10명을 돌려줬다 — 화면은 "신현묵"을 쳐도
        //    전혀 다른 환자를 보여줬다(2026-08-26 사람 신고). 200 이고 오류도 없었다.
        '/api/v1/patients', { q: patientSearch, limit: 10 },
      );
      const raw = res.data;
      return Array.isArray(raw) ? raw : ((raw as Record<string, unknown> | undefined)?.data as { id: string; mrn: string; familyName: string; givenName: string }[]) ?? [];
    },
    enabled: patientSearch.length >= 2,
  });

  // 오늘 촬영 대상 — 병동에서는 "누가 언제 찍는가"를 먼저 본다
  const { data: worklistRes, isLoading: wlLoading } = useQuery({
    queryKey: ['nurse-imaging-worklist'],
    queryFn: () => apiClient.get<{ data: { items?: WorklistItem[]; results?: WorklistItem[] } }>('/api/v1/pacs/worklist'),
    refetchInterval: 60_000,
  });
  const worklist: WorklistItem[] = useMemo(() => {
    const d = worklistRes?.data as { items?: WorklistItem[]; results?: WorklistItem[] } | WorklistItem[] | undefined;
    if (Array.isArray(d)) return d;
    return d?.items ?? d?.results ?? [];
  }, [worklistRes]);

  const mrn = selected?.mrn ?? '';

  const { data: studyRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nurse-imaging-studies', mrn],
    queryFn: () => apiClient.get<{ data: { results?: PacsStudy[] } }>('/api/v1/pacs/studies', { patientId: mrn }),
    enabled: !!mrn,
  });
  const studies: PacsStudy[] = useMemo(() => {
    const d = studyRes?.data as { results?: PacsStudy[] } | PacsStudy[] | undefined;
    return Array.isArray(d) ? d : d?.results ?? [];
  }, [studyRes]);

  const { data: reportRes } = useQuery({
    queryKey: ['nurse-imaging-reports', mrn],
    queryFn: () => apiClient.get<{ data: { results?: PacsReport[] } }>(`/api/v1/pacs/patients/${encodeURIComponent(mrn)}/reports`),
    enabled: !!mrn,
  });
  const reportsByStudy = useMemo(() => {
    const d = reportRes?.data as { results?: PacsReport[] } | PacsReport[] | undefined;
    const list = Array.isArray(d) ? d : d?.results ?? [];
    const map: Record<string, PacsReport> = {};
    for (const r of list) if (r.study_uid) map[r.study_uid] = r;
    return map;
  }, [reportRes]);

  // 선택 환자의 **예정 영상 검사** — 이송 전 안전 확인은 오더 단위라 오더가 있어야 붙는다
  const { data: pendingRes } = useQuery({
    queryKey: ['nurse-imaging-pending-orders', selected?.id],
    queryFn: () => apiClient.get<{ data: { id: string; status: string; priority?: string; prescription?: { procedureCode?: { nameKo?: string } } }[] }>(
      '/api/v1/orders', { department: 'IMAGING', patientId: selected!.id!, limit: 20 },
    ),
    enabled: !!selected?.id,
  });
  const pendingOrders = useMemo(() => {
    const d = pendingRes?.data as { id: string; status: string; priority?: string; prescription?: { procedureCode?: { nameKo?: string } } }[] | { data?: unknown[] } | undefined;
    const list = Array.isArray(d) ? d : ((d as { data?: unknown[] })?.data as typeof d as never[]) ?? [];
    return (list as { id: string; status: string; priority?: string; prescription?: { procedureCode?: { nameKo?: string } } }[])
      .filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED');
  }, [pendingRes]);

  const openViewer = async (uid: string) => {
    try {
      const res = await apiClient.get<{ data: { url: string } }>(`/api/v1/pacs/viewer/${encodeURIComponent(uid)}`);
      window.open((res.data as { url: string }).url, '_blank', 'noopener');
    } catch {
      // Orthanc(/pacs/)는 자체 Basic 인증이라 브라우저 로그인 창이 뜬다 → OHIF(/viewer/)로
      window.open(`/viewer/?PatientID=${encodeURIComponent(mrn)}`, '_blank', 'noopener');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="환자 영상" /></h1>
        <p className="mt-0.5 text-sm text-gray-500"><T k="간호 워크스테이션 — 오늘 촬영 대상 · 환자별 영상·판독" /></p>
      </div>

      {/* 오늘 촬영 대상 */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-700">
          <T k="오늘 촬영 대상" /> <span className="ml-1 text-xs font-normal text-gray-400">{worklist.length}<Unit>건</Unit></span>
        </h2>
        {wlLoading ? (
          <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : worklist.length === 0 ? (
          <EmptyState icon="📷" title="예정된 촬영이 없습니다" hint="영상 오더가 발행되면 여기에 나타납니다" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
            {worklist.slice(0, 12).map((w, i) => (
              <button
                key={w.accession_number ?? i}
                onClick={() => { if (w.patient_id) { setSelected({ mrn: w.patient_id, name: w.patient_name ?? w.patient_id }); setPatientSearch(w.patient_name ?? ''); } }}
                className="rounded-xl border border-gray-100 px-3 py-2 text-left transition-colors hover:bg-blue-50/60"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{w.modality ?? '-'}</span>
                  <span className="truncate text-sm font-medium text-gray-900">{w.patient_name ?? '-'}</span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gray-400">{w.scheduled_time ?? ''}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">{w.study_description ?? '-'}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 환자 검색 */}
      <div className="relative max-w-md">
        <input
          type="text"
          value={patientSearch}
          onChange={(e) => { setPatientSearch(e.target.value); if (selected) setSelected(null); }}
          placeholder={tAttr('환자 이름 또는 등록번호 검색')}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500"
        />
        {patientSearch.length >= 2 && (searchRes?.length ?? 0) > 0 && !selected && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {searchRes!.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelected({ mrn: p.mrn, name: `${p.familyName}${p.givenName}`, id: p.id }); setPatientSearch(`${p.familyName}${p.givenName} (${p.mrn})`); }}
                className="w-full border-b px-4 py-2 text-left text-sm last:border-0 hover:bg-blue-50"
              >
                <span className="font-medium">{p.familyName}{p.givenName}</span>
                <span className="ml-2 text-gray-400">{p.mrn}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-700">{selected.name} <span className="font-normal text-gray-400">{selected.mrn}</span></h2>
            <button onClick={() => { setSelected(null); setPatientSearch(''); }} className="text-xs text-gray-400 hover:text-gray-600"><T k="변경" /></button>
          </div>

          {pendingOrders.length > 0 && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
              <p className="mb-2 text-xs font-bold text-gray-700">
                <T k="예정 검사" /> <span className="ml-1 font-normal text-gray-400">{pendingOrders.length}<Unit>건</Unit> · <T k="이송 전 확인" /></span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2">
                {pendingOrders.map((o) => (
                  <div key={o.id} className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                    <p className="mb-1 truncate text-xs font-medium text-gray-900">
                      {/* 🔴 수가 명칭은 마스터 데이터 — 폴백만 카탈로그 키 */}
                      {o.prescription?.procedureCode?.nameKo ? <Data>{o.prescription.procedureCode.nameKo}</Data> : <T k="영상 검사" />}
                      {(o.priority === 'STAT' || o.priority === 'URGENT') && (
                        <span className="ml-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">{o.priority}</span>
                      )}
                    </p>
                    <ImagingSafetyPrecheck orderId={o.id} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isError ? (
            <QueryErrorFallback error={error} onRetry={refetch} />
          ) : isLoading ? (
            <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>
          ) : studies.length === 0 ? (
            <EmptyState icon="📷" title="등록된 영상이 없습니다" hint="촬영 후 PACS 에 도착하면 표시됩니다" />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {studies.map((s) => {
                const uid = s.study_instance_uid ?? s.study_uid ?? '';
                const rep = reportsByStudy[uid];
                const rs = rep?.status ? REPORT_STATUS[rep.status] : undefined;
                return (
                  <div key={uid} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{s.modality ?? '-'}</span>
                      {rs ? (
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${rs.cls}`}><T k={rs.label} /></span>
                      ) : (
                        <span className="rounded bg-yellow-100 px-2 py-0.5 text-[10px] font-bold text-yellow-700"><T k="미판독" /></span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{s.description ?? s.study_description ?? '-'}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {fmtDate(s.study_date)}
                      {s.instances != null && <> · {s.instances}<Unit>장</Unit></>}
                    </p>
                    {(rep?.conclusion || rep?.findings) && (
                      <p className="mt-2 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                        {rep.conclusion || rep.findings}
                        {rep.radiologist_name && <span className="ml-1 text-gray-400">— {rep.radiologist_name}</span>}
                      </p>
                    )}
                    <button
                      onClick={() => openViewer(uid)}
                      className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <T k="영상 보기" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
