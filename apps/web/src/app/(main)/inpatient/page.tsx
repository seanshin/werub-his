'use client';

import { BedTransferRequestDialog } from '@/components/inpatient/BedTransferRequestDialog';
import { AiRiskBadges } from '@/components/inpatient/AiRiskBadges';
import { useState, useEffect } from 'react';
import { dietTypeText, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import PatientSelector from '@/components/ui/PatientSelector';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';
import { ageOf, stayDays } from '@hospital-run/shared';

interface AdmissionItem {
  id: string;
  status: string;
  admitDate: string;
  expectedDischargeDate?: string | null;
  dietType?: string;
  /** 이 식이 값의 출처 — 'ORDER'(영양팀 처방·정본) | 'ADMISSION'(입원 시 지정) */
  dietSource?: 'ORDER' | 'ADMISSION' | null;
  patient?: { id: string; familyName: string; givenName: string; mrn: string; gender?: string; dateOfBirth?: string };
  encounters?: { diagnoses?: { diagnosisCode?: { code?: string; nameKo?: string } }[] }[];
  bed?: { id: string; wardId?: string; ward?: { name: string }; roomNumber: string; bedNumber: string };
  admittingDoctor?: { familyName: string; givenName: string };
  chargeOfCare?: Array<{ doctor: { familyName: string; givenName: string } }>;
}

interface PatientItem {
  id: string;
  familyName: string;
  givenName: string;
  mrn: string;
}

interface BedItem {
  id: string;
  ward?: { name: string };
  roomNumber: string;
  bedNumber: string;
}

interface DoctorItem {
  id: string;
  familyName: string;
  givenName: string;
  department?: string;
}

// WeRU.B 위험도 배지 컴포넌트 (재입원 + 합병증 + 부작용)

// 단일 진입(하위 호환) — 행 데이터에서 실값을 계산해 전달
function AiRiskBadge({ admission }: { admission: AdmissionItem }) {
  const dob = admission.patient?.dateOfBirth;
  // 정본 계산 — 365.25 근사는 생일 경계에서 어긋난다
  const age = ageOf(dob) ?? undefined;
  const sex = admission.patient?.gender === 'MALE' ? 'M' : admission.patient?.gender === 'FEMALE' ? 'F' : undefined;
  const diagnoses = (admission.encounters?.[0]?.diagnoses ?? [])
    .map((d) => d.diagnosisCode?.nameKo ?? d.diagnosisCode?.code)
    .filter((v): v is string => !!v);
  const lengthOfStay = stayDays(admission.admitDate) ?? undefined; // 재원일수 정본(max(1,ceil))
  return (
    <AiRiskBadges admissionId={admission.id} patientAge={age} patientSex={sex} diagnoses={diagnoses} lengthOfStay={lengthOfStay} />
  );
}

const DIET_OPTIONS = [
  { value: 'REGULAR', label: '일반식' },
  { value: 'LOW_SALT', label: '저염식' },
  { value: 'DIABETIC', label: '당뇨식' },
  { value: 'LIQUID', label: '유동식' },
  { value: 'NPO', label: '금식' },
];

export default function InpatientPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isDoctor = user?.role === 'DOCTOR' || user?.role === 'ADMIN';
  const isNurse = user?.role === 'NURSE' || user?.role === 'ADMIN';
  // 병동 간 전동 요청 대상(2026-09-30)
  const [transferReq, setTransferReq] = useState<AdmissionItem | null>(null);
  const [tab, setTab] = useState<'list' | 'admit'>('list');

  // --- Admission list ---
  const { data: inpatientData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inpatients'],
    queryFn: () => apiClient.get<{ data: AdmissionItem[] }>('/api/v1/inpatient'),
  });

  const discharge = useMutation({
    mutationFn: ({ id, summary, disposition }: { id: string; summary: string; disposition?: string }) =>
      apiClient.patch(`/api/v1/inpatient/${id}/discharge`, { summary, disposition }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      qc.invalidateQueries({ queryKey: ['wards'] });
      qc.invalidateQueries({ queryKey: ['beds-status'] });
    },
  });

  const transfer = useMutation({
    mutationFn: ({ id, newBedId }: { id: string; newBedId: string }) =>
      apiClient.patch(`/api/v1/inpatient/${id}/transfer`, { newBedId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      qc.invalidateQueries({ queryKey: ['wards'] });
      qc.invalidateQueries({ queryKey: ['beds-status'] });
      qc.invalidateQueries({ queryKey: ['available-beds'] });
    },
  });

  const setExpectedDischarge = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      apiClient.patch(`/api/v1/inpatient/${id}/expected-discharge`, { date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      toast.success('퇴원 예정일이 설정되었습니다.');
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '설정에 실패했습니다.'),
  });

  const cancelAdmission = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/inpatient/${id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      qc.invalidateQueries({ queryKey: ['wards'] });
      qc.invalidateQueries({ queryKey: ['beds-status'] });
      qc.invalidateQueries({ queryKey: ['available-beds'] });
      toast.success('입원이 취소되었습니다.');
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '입원 취소에 실패했습니다.'),
  });

  // --- Admit form state ---
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedBedId, setSelectedBedId] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [admitReason, setAdmitReason] = useState('');
  const [dietType, setDietType] = useState('REGULAR');

  const { data: patientsData } = useQuery({
    queryKey: ['patients-search', patientSearch],
    queryFn: () => apiClient.get<{ data: PatientItem[] }>('/api/v1/patients', { q: patientSearch, limit: 100 }),
    enabled: tab === 'admit',
  });

  const { data: availableBedsData } = useQuery({
    queryKey: ['available-beds'],
    queryFn: () => apiClient.get<{ data: BedItem[] }>('/api/v1/beds/available'),
    enabled: tab === 'admit',
  });

  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  useEffect(() => {
    if (tab !== 'admit') return;
    apiClient.get<{ data: DoctorItem[] }>('/api/v1/users/doctors').then((res) => {
      const data = res as unknown;
      setDoctors(Array.isArray(data) ? data : (data as Record<string, unknown> | undefined)?.data as DoctorItem[] ?? []);
    }).catch(() => {});
  }, [tab]);

  const admit = useMutation({
    mutationFn: (body: { patientId: string; bedId: string; admitReason: string; dietType: string; doctorId?: string }) =>
      apiClient.post('/api/v1/inpatient/admit', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inpatients'] });
      qc.invalidateQueries({ queryKey: ['wards'] });
      qc.invalidateQueries({ queryKey: ['beds-status'] });
      qc.invalidateQueries({ queryKey: ['available-beds'] });
      setSelectedPatientId('');
      setSelectedBedId('');
      setAdmitReason('');
      setDietType('REGULAR');
      setTab('list');
    },
  });

  const _inpatientRaw = inpatientData?.data;
  const _inpatientArr: AdmissionItem[] = Array.isArray(_inpatientRaw) ? _inpatientRaw : (_inpatientRaw as Record<string, unknown> | undefined)?.data as AdmissionItem[] ?? [];
  const admissions = _inpatientArr.filter((a: AdmissionItem) => a.status === 'ADMITTED');

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _patientsRaw = patientsData?.data;
  const patients: PatientItem[] = Array.isArray(_patientsRaw) ? _patientsRaw : (_patientsRaw as Record<string, unknown> | undefined)?.data as PatientItem[] ?? [];
  const _bedsRaw = availableBedsData?.data;
  const availableBeds: BedItem[] = Array.isArray(_bedsRaw) ? _bedsRaw : (_bedsRaw as Record<string, unknown> | undefined)?.data as BedItem[] ?? [];

  const handleDischarge = (admission: AdmissionItem) => {
    const summary = window.prompt(
      `${admission.patient?.familyName}${admission.patient?.givenName} 환자의 퇴원 요약을 입력하세요:`,
    );
    if (summary !== null && summary.trim()) {
      const isTransfer = window.confirm('전원(타 의료기관 이송)입니까?\n\n확인 = 전원 처리 / 취소 = 일반 퇴원');
      discharge.mutate({ id: admission.id, summary: summary.trim(), disposition: isTransfer ? 'TRANSFER' : 'HOME' });
    }
  };

  const handleSetExpectedDischarge = (admission: AdmissionItem) => {
    const cur = admission.expectedDischargeDate ? new Date(admission.expectedDischargeDate).toISOString().slice(0, 10) : '';
    const input = window.prompt('퇴원 예정일(YYYY-MM-DD)을 입력하세요. 비우면 해제:', cur);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { toast.error('YYYY-MM-DD 형식으로 입력하세요.'); return; }
    setExpectedDischarge.mutate({ id: admission.id, date: trimmed || null });
  };

  const handleCancelAdmission = (admission: AdmissionItem) => {
    const reason = window.prompt(`${admission.patient?.familyName}${admission.patient?.givenName} 환자의 입원을 취소합니다.\n사유를 입력하세요(병상 반납·주치의 배정 종료):`);
    if (reason !== null && reason.trim()) {
      cancelAdmission.mutate({ id: admission.id, reason: reason.trim() });
    }
  };

  const handleTransfer = (admission: AdmissionItem) => {
    if (!availableBeds.length) {
      window.alert('사용 가능한 병상이 없습니다.');
      return;
    }
    const bedList = availableBeds
      .map((b: BedItem, i: number) => `${i + 1}. ${b.ward?.name ?? ''} ${b.roomNumber}-${b.bedNumber}`)
      .join('\n');
    const choice = window.prompt(`전동할 병상 번호를 선택하세요:\n\n${bedList}`);
    if (choice !== null) {
      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < availableBeds.length) {
        transfer.mutate({ id: admission.id, newBedId: availableBeds[idx].id });
      }
    }
  };

  const handleAdmit = () => {
    if (!selectedPatientId || !selectedBedId || !selectedDoctorId) {
      window.alert('환자, 주치의, 병상을 모두 선택해주세요.');
      return;
    }
    admit.mutate({
      patientId: selectedPatientId,
      bedId: selectedBedId,
      doctorId: selectedDoctorId,
      admitReason,
      dietType,
    });
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="입원 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="입원 환자 관리 및 입원 접수" /></p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('list')}
          className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <T k="입원 환자" />
        </button>
        <button
          onClick={() => setTab('admit')}
          className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === 'admit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <T k="입원 접수" />
        </button>
      </div>

      {tab === 'list' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-4 w-40 bg-gray-100 rounded-lg animate-pulse" />
                    <div className="h-3 w-28 bg-gray-50 rounded-lg animate-pulse" />
                  </div>
                  <div className="h-8 w-24 bg-gray-100 rounded-lg animate-pulse" />
                </div>
              ))}
            </div>
          ) : !admissions.length ? (
            <div className="p-12 text-center">
              <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="현재 입원 중인 환자가 없습니다." /></p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">MRN</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="병실" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="담당의" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="입원일" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="식이" /></th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">{AI_ORIGIN_TEXT} 위험도 (재/합/부)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="액션" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {admissions.map((a: AdmissionItem) => (
                  <tr key={a.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/inpatient/${a.id}`} className="text-blue-700 hover:underline font-bold">
                        {a.patient?.familyName}{a.patient?.givenName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{a.patient?.mrn}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {a.bed?.ward?.name} {a.bed?.roomNumber}-{a.bed?.bedNumber}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {a.chargeOfCare?.[0]?.doctor
                        ? `${a.chargeOfCare[0].doctor.familyName}${a.chargeOfCare[0].doctor.givenName}`
                        : `${a.admittingDoctor?.familyName ?? ''}${a.admittingDoctor?.givenName ?? ''}`}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {kdate(new Date(a.admitDate))}
                      {a.expectedDischargeDate && (
                        <span className="block text-[10px] text-cyan-600 mt-0.5"><T k="퇴원예정" /> {kdate(a.expectedDischargeDate, 'monthDay')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-orange-50 text-orange-700">
                        {/* 🔴 라벨은 shared 정본(`dietTypeText`) — 로컬 목록에 없는 코드가 영문으로 샜다.
                             값은 서버가 **활성 식이처방 우선**으로 넣어 준다(`dietSource`). */}
                        <span title={a.dietSource === 'ORDER' ? '영양팀 식이처방' : a.dietSource === 'ADMISSION' ? '입원 시 지정' : undefined}>
                          {dietTypeText(a.dietType)}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <AiRiskBadge admission={a} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <Link href={`/inpatient/${a.id}`} className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-medium hover:bg-blue-700"><T k="차트" /></Link>
                        {isDoctor && <Link href={`/patients/${a.patient?.id}/encounter/new`} className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-medium hover:bg-emerald-700"><T k="진료@액션" /></Link>}
                        {isNurse && <Link href={`/inpatient/${a.id}/nursing/assessment`} className="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[11px] font-medium hover:bg-indigo-100"><T k="간호" /></Link>}
                        <Link href={`/inpatient/${a.id}/nursing/notes`} className="px-2.5 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-[11px] font-medium hover:bg-purple-100"><T k="일지" /></Link>
                        {isNurse && <Link href={`/inpatient/${a.id}/nursing/io`} className="px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-[11px] font-medium hover:bg-blue-100">I/O</Link>}
                        {isNurse && <Link href={`/inpatient/${a.id}/nursing/mar`} className="px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-medium hover:bg-emerald-100">MAR</Link>}
                        <Link href={`/inpatient/${a.id}/discharge-summary`} className="px-2.5 py-1.5 bg-cyan-50 text-cyan-700 rounded-lg text-[11px] font-medium hover:bg-cyan-100"><T k="퇴원요약" /></Link>
                        {/* 🔴 병상 이동은 병동 운용이라 서버가 `@Roles(NURSE, ADMIN)` 다 —
                            의사에게 띄우면 누를 때마다 403 이었다(2026-08-31 · /beds 상태 변경과 같은 판정) */}
                        {isNurse && <button
                          onClick={() => handleTransfer(a)}
                          disabled={transfer.isPending}
                          className="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-medium hover:bg-amber-100 disabled:opacity-50"
                        >
                          {/* 같은 병동 안 즉시 이동 — 병동 간 전동은 받는 병동이 수락하는 '전동 요청'으로(2026-09-30) */}
                          <T k="병상 이동" />
                        </button>}
                        {(isNurse || isDoctor) && <button
                          onClick={() => setTransferReq(a)}
                          data-bt-open
                          className="px-2.5 py-1.5 bg-amber-100 text-amber-800 rounded-lg text-[11px] font-medium hover:bg-amber-200"
                        >
                          <T k="전동 요청" />
                        </button>}
                        {isDoctor && <button
                          onClick={() => handleDischarge(a)}
                          disabled={discharge.isPending}
                          className="px-2.5 py-1.5 bg-red-50 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-100 disabled:opacity-50"
                        >
                          <T k="퇴원" />
                        </button>}
                        <button
                          onClick={() => handleSetExpectedDischarge(a)}
                          disabled={setExpectedDischarge.isPending}
                          className="px-2.5 py-1.5 bg-cyan-50 text-cyan-700 rounded-lg text-[11px] font-medium hover:bg-cyan-100 disabled:opacity-50"
                        >
                          <T k="퇴원예정" />
                        </button>
                        {isDoctor && <button
                          onClick={() => handleCancelAdmission(a)}
                          disabled={cancelAdmission.isPending}
                          className="px-2.5 py-1.5 bg-gray-100 text-gray-500 rounded-lg text-[11px] font-medium hover:bg-gray-200 disabled:opacity-50"
                        >
                          <T k="입원취소" />
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'admit' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-900 mb-6"><T k="입원 접수" /></h3>

          <div className="space-y-5">
            {/* Patient Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="환자 선택" /></label>
              <PatientSelector
                value={selectedPatientId}
                onChange={(id) => setSelectedPatientId(id)}
                context="admission"
              />
              {selectedPatientId && (
                <p className="text-xs text-green-600 mt-1">
                  <T k="선택됨" />
                  {patients.find((p: PatientItem) => p.id === selectedPatientId)?.givenName}
                </p>
              )}
            </div>

            {/* Bed Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="병상 선택" /></label>
              <select
                value={selectedBedId}
                onChange={(e) => setSelectedBedId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              >
                <option value="">{tAttr('병상을 선택하세요')}</option>
                {availableBeds.map((bed: BedItem) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.ward?.name ?? ''} {bed.roomNumber}-{bed.bedNumber}
                  </option>
                ))}
              </select>
            </div>

            {/* 주치의 선택 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="주치의 (담당의)" /> <span className="text-red-500">*</span></label>
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              >
                <option value="">{tAttr('주치의를 선택하세요')}</option>
                {doctors.map((d: DoctorItem) => (
                  <option key={d.id} value={d.id}>
                    {d.familyName}{d.givenName} ({d.department ?? '미지정'})
                  </option>
                ))}
              </select>
            </div>

            {/* Admit Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="입원 사유" /></label>
              <textarea
                value={admitReason}
                onChange={(e) => setAdmitReason(e.target.value)}
                placeholder={tAttr('입원 사유를 입력하세요...')}
                rows={3}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
              />
            </div>

            {/* Diet Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5"><T k="식이 유형" /></label>
              <select
                value={dietType}
                onChange={(e) => setDietType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              >
                {DIET_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <button
              onClick={handleAdmit}
              disabled={admit.isPending || !selectedPatientId || !selectedBedId || !selectedDoctorId}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {admit.isPending ? <T k="처리 중..." /> : <T k="입원 접수" />}
            </button>
          </div>
        </div>
      )}
      {transferReq && (
        <BedTransferRequestDialog
          admissionId={transferReq.id}
          currentWardId={transferReq.bed?.wardId ?? null}
          patientName={`${transferReq.patient?.familyName ?? ''}${transferReq.patient?.givenName ?? ''}`}
          onClose={() => setTransferReq(null)}
        />
      )}
    </div>
  );
}
