'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { useState } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { openPacsViewer } from '@/lib/pacs';
import { toast } from '@/stores/toast-store';
import { PatientAddModal } from '@/components/workstation/PatientAddModal';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, EmptyState, Unit, genderText } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

const IMG_STATIONS = [
  { id: 'img-xray', label: '일반촬영', icon: '📷' },
  { id: 'img-ct', label: 'CT', icon: '🖥' },
  { id: 'img-mri', label: 'MRI', icon: '🧲' },
  { id: 'img-ultrasound', label: '초음파', icon: '🔊' },
  { id: 'img-mammography', label: '유방촬영', icon: '🩺' },
  { id: 'img-nuclear', label: '핵의학', icon: '☢' },
];

/**
 * 선량이 기록되지 않은 사유 — 서버 `doseSkippedReason` 을 사람 말로 옮긴다.
 * 🔴 어휘는 서버가 정한다. 화면이 사유를 지어내지 않는다(미등재 값은 코드 그대로 보여준다).
 */
const DOSE_SKIP_TEXT: Record<string, string> = {
  NON_IONIZING: '이 촬영이 전리방사선(피폭) 대상으로 저장되지 않았습니다 — 촬영 종류를 확인하세요',
  NO_USER: '기록자를 확인할 수 없습니다(재로그인 후 다시 시도하세요)',
  SERVICE_UNAVAILABLE: '선량 기록 모듈을 사용할 수 없습니다',
};

const MODALITY_MAP: Record<string, string[]> = {
  'img-xray': ['CR', 'DX', 'RF'],
  'img-ct': ['CT', 'CTA'],
  'img-mri': ['MR', 'MRA'],
  'img-ultrasound': ['US'],
  'img-mammography': ['MG'],
  'img-nuclear': ['PT', 'NM'],
};

const BODY_PARTS = ['Head', 'Chest', 'Abdomen', 'Pelvis', 'Spine', 'Upper Extremity', 'Lower Extremity', 'Neck', 'Breast', 'Whole Body'];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED: { label: '대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED: { label: '준비', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '촬영중', cls: 'bg-amber-100 text-amber-700' },
};

interface CheckItem { label: string; checked: boolean; required: boolean }

export default function ImagingWorkstationPage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [station, setStation] = useState('img-xray');
  const [acquireTarget, setAcquireTarget] = useState<any>(null);
  const [modality, setModality] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [checklist, setChecklist] = useState<CheckItem[]>([]);
  // 피폭선량 입력(전리방사선 스테이션) — 장비 콘솔 판독값 수기
  const [doseDlp, setDoseDlp] = useState('');
  const [doseCtdi, setDoseCtdi] = useState('');
  const [doseDap, setDoseDap] = useState('');
  const [doseMsv, setDoseMsv] = useState('');

  const isIonizingStation = ['img-xray', 'img-ct', 'img-mammography', 'img-nuclear'].includes(station);

  const stationInfo = IMG_STATIONS.find((s) => s.id === station)!;

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-img-queue', station],
    queryFn: () => apiClient.get<any>(`/api/v1/workstation/station/${station}/queue`),
    refetchInterval: 8000,
  });
  const queue = queueRes?.data ?? [];
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;

  const receive = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/workstation/order/${orderId}/receive`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ws-img-queue'] }); toast.success('환자 접수'); },
  });

  const acquire = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: any }) =>
      apiClient.patch<any>(`/api/v1/workstation/imaging/${orderId}/acquired`, body),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['ws-img-queue'] });
      setAcquireTarget(null);
      toast.success('촬영 완료 → 판독 대기열 전송');
      // 서버 안전게이트 WARN 표출(조영제 신기능·임신 미확인·누적피폭)
      const warns = res?.data?.safetyWarnings as { level: string; message: string }[] | undefined;
      warns?.filter((w) => w.level === 'WARNING' || w.level === 'ERROR').forEach((w) => toast.error(`⚠ ${w.message}`));
      // 🔴 입력한 선량이 **기록되지 않았으면 그 사실을 말한다.** 종전엔 조용히 버려졌다
      //    (게이트가 modality 를 미상으로 판정하면 콘솔 판독값이 소실 — 성공 응답 + 데이터 소실).
      const skipped = res?.data?.doseSkippedReason as string | null | undefined;
      if (skipped) toast.error(`☢ 입력한 피폭선량이 기록되지 않았습니다 — ${DOSE_SKIP_TEXT[skipped] ?? skipped}`);
    },
    onError: (e: any) => toast.error(e?.message ?? '촬영 처리에 실패했습니다'),
  });

  const openAcquireModal = (item: any) => {
    setAcquireTarget(item);
    const defaultMod = MODALITY_MAP[station]?.[0] ?? 'CR';
    setModality(defaultMod);
    setBodyPart('');
    setDoseDlp(''); setDoseCtdi(''); setDoseDap(''); setDoseMsv('');
    // 스테이션별 체크리스트
    const baseChecks: CheckItem[] = [
      { label: '환자 확인 (이름+생년월일+팔찌)', checked: false, required: true },
      { label: '영상 품질 확인', checked: false, required: true },
    ];
    if (station === 'img-ct' || station === 'img-mri') {
      baseChecks.splice(1, 0,
        { label: '조영제 동의서 확인', checked: false, required: station === 'img-ct' },
        { label: '알레르기 이력 확인', checked: false, required: true },
        { label: '신기능(eGFR) 확인', checked: false, required: station === 'img-ct' },
      );
    }
    if (station === 'img-mri') {
      baseChecks.splice(1, 0,
        { label: '금속 물질 체크리스트 완료', checked: false, required: true },
        { label: '임신 여부 확인 (가임기 여성)', checked: false, required: true },
      );
    }
    if (station === 'img-mammography') {
      baseChecks.splice(1, 0,
        { label: '임신 여부 확인', checked: false, required: true },
        { label: '유방 보형물 여부 확인', checked: false, required: false },
      );
    }
    setChecklist(baseChecks);
  };

  const toggleCheck = (idx: number) => {
    const copy = [...checklist];
    copy[idx].checked = !copy[idx].checked;
    setChecklist(copy);
  };

  const allRequiredChecked = checklist.filter((c) => c.required).every((c) => c.checked);
  const waitMin = (t: string) => t ? Math.round((Date.now() - new Date(t).getTime()) / 60000) : 0;

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{stationInfo.icon} {stationInfo.label} 워크스테이션</h1>
          <p className="text-sm text-gray-500 mt-0.5">대기 {queue.length}<Unit>건</Unit></p>
        </div>
        <button onClick={() => setShowAddPatient(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 shadow-sm">
          <T k="+ 환자 추가" />
        </button>
      </div>

      <div className="flex gap-1.5">
        {IMG_STATIONS.map((s) => (
          <button key={s.id} onClick={() => setStation(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              station === s.id ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>{s.icon} {s.label}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><div className="animate-pulse text-3xl mb-2">📷</div><T k="로딩 중..." /></div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : queue.length === 0 ? (
        <EmptyState icon="📷" title="대기 중인 촬영이 없습니다" />
      ) : (
        <div className="space-y-2">
          {queue.map((item: any) => (
            <div key={item.orderId} className={`bg-white border rounded-xl p-4 ${item.priority === 'STAT' ? 'border-red-300 bg-red-50/30 ring-1 ring-red-200' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {item.priority === 'STAT' && <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded animate-pulse">STAT</span>}
                  <div>
                    <span className="font-semibold">{item.patient?.familyName}{item.patient?.givenName}</span>
                    <span className="ml-2 text-xs text-gray-400">{genderText(item.patient?.gender)}/{item.patient?.age}세 · {item.patient?.mrn}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 font-medium">{item.procedureName || item.procedureCode}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100'}`}>
                    {STATUS_BADGE[item.status]?.label ?? item.status}
                  </span>
                  {item.createdAt && <span className="text-[10px] text-gray-400"><Duration minutes={waitMin(item.createdAt)} /></span>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {item.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(item.orderId)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 shadow-sm"><T k="환자 접수" /></button>
                )}
                {(item.status === 'RECEIVED' || item.status === 'IN_PROGRESS') && (
                  <button onClick={() => openAcquireModal(item)}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-medium hover:bg-indigo-700 shadow-sm"><T k="촬영 완료" /></button>
                )}
                <button type="button" onClick={() => openPacsViewer()}
                  className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-xs hover:bg-gray-200">PACS</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 촬영 완료 모달 */}
      {acquireTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAcquireTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b">
              <h3 className="font-bold"><T k="촬영 완료 확인" /></h3>
              <p className="text-sm text-gray-500">{acquireTarget.patient?.familyName}{acquireTarget.patient?.givenName} — {acquireTarget.procedureName}</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Modality + Body Part */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Modality</label>
                  <select className="w-full border rounded-xl px-3 py-2 text-sm" value={modality}
                    onChange={(e) => setModality(e.target.value)}>
                    {(MODALITY_MAP[station] ?? ['CR']).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Body Part</label>
                  <select className="w-full border rounded-xl px-3 py-2 text-sm" value={bodyPart}
                    onChange={(e) => setBodyPart(e.target.value)}>
                    <option value="">{tAttr('선택')}</option>
                    {BODY_PARTS.map((bp) => <option key={bp} value={bp}>{bp}</option>)}
                  </select>
                </div>
              </div>

              {/* 피폭선량 입력 — 전리방사선 스테이션(장비 콘솔 판독값) */}
              {isIonizingStation && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-2 block"><T k="☢ 피폭선량 기록 (장비 콘솔 판독값·선택)" /></label>
                  <div className="grid grid-cols-2 gap-2">
                    {station === 'img-ct' && (
                      <>
                        <input type="number" min="0" step="0.01" placeholder="DLP (mGy·cm)" value={doseDlp}
                          onChange={(e) => setDoseDlp(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
                        <input type="number" min="0" step="0.01" placeholder="CTDIvol (mGy)" value={doseCtdi}
                          onChange={(e) => setDoseCtdi(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
                      </>
                    )}
                    {(station === 'img-xray' || station === 'img-mammography') && (
                      <input type="number" min="0" step="0.001" placeholder="DAP (Gy·cm²)" value={doseDap}
                        onChange={(e) => setDoseDap(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
                    )}
                    <input type="number" min="0" step="0.001" placeholder={tAttr('유효선량 (mSv)')} value={doseMsv}
                      onChange={(e) => setDoseMsv(e.target.value)} className="border rounded-xl px-3 py-2 text-sm" />
                  </div>
                  {station === 'img-ct' && doseDlp && !doseMsv && (
                    <p className="text-[10px] text-gray-400 mt-1"><T k="유효선량 미입력 시 DLP×부위별 변환계수로 자동 추정됩니다" /></p>
                  )}
                </div>
              )}

              {/* 체크리스트 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block"><T k="촬영 전/후 체크리스트" /></label>
                <div className="space-y-1.5">
                  <LocalChecklistNotice className="mb-1.5" />
                  {checklist.map((c, idx) => (
                    <label key={idx} className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition ${
                      c.checked ? 'border-emerald-300 bg-emerald-50' : c.required ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
                    }`}>
                      <input type="checkbox" checked={c.checked} onChange={() => toggleCheck(idx)} className="rounded" />
                      <span className="text-sm">{c.label}</span>
                      {c.required && !c.checked && <span className="text-[10px] text-red-500 ml-auto"><T k="필수" /></span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setAcquireTarget(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button onClick={() => acquire.mutate({ orderId: acquireTarget.orderId, body: {
                  quality: 'GOOD',
                  modality,
                  bodyPart: bodyPart || undefined,
                  dlp: doseDlp ? Number(doseDlp) : undefined,
                  ctdiVol: doseCtdi ? Number(doseCtdi) : undefined,
                  doseAreaProduct: doseDap ? Number(doseDap) : undefined,
                  effectiveDoseMsv: doseMsv ? Number(doseMsv) : undefined,
                } })}
                disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
                className="min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-sm">
                <T k="촬영 완료 → 판독 요청" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 환자 추가 모달 */}
      {showAddPatient && (
        <PatientAddModal
          stationType="imaging"
          stationId={station}
          onClose={() => setShowAddPatient(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ['ws-img-queue'] })}
        />
      )}
    </div>
  );
}
