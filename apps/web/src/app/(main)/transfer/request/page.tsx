'use client';

import { useEffect, useState } from 'react';
import { genderText } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface Patient { id: string; familyName: string; givenName: string; mrn: string; dateOfBirth: string; gender: string }
/** 🔴 서버 정본 키는 `orgType`(`Organization.orgType` · S18 과 같은 자리) — `type` 으로 읽으면 등급 없는 기관의 유형이 조용히 빈칸이 된다 */
interface Org { id: string; name: string; code: string; orgType: string; grade?: string }

const STEPS = ['환자 선택', '수신 병원', '임상 정보', '전송 확인'];

export default function TransferRequestPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  const [form, setForm] = useState({
    patientId: '',
    toOrgId: '',
    transferType: 'OUTGOING_REFERRAL',
    urgency: 'ROUTINE',
    reason: '',
    clinicalSummary: '',
    includeDiagnoses: true,
    includeMedications: true,
    includeLabResults: true,
    includeAllergies: true,
  });
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);

  // 진료 화면 '의뢰·회송'이 환자를 넘긴다 — 종전엔 전원 화면에서 환자를 다시 찾아야 했다(2026-09-30)
  const [prefillId] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('patientId') : null));
  const { data: prefillData, isError: prefillIsError, error: prefillErr, refetch: refetchPrefill } = useQuery({
    queryKey: ['transfer-prefill-patient', prefillId],
    queryFn: () => apiClient.get<{ data: Patient }>(`/api/v1/patients/${prefillId}`),
    enabled: !!prefillId,
  });
  useEffect(() => {
    const p = (prefillData?.data as Patient & { data?: Patient } | undefined);
    const pt = p && 'id' in p && p.id ? p : p?.data;
    if (pt?.id && !selectedPatient) { setSelectedPatient(pt); setForm((f) => ({ ...f, patientId: pt.id })); }
  }, [prefillData, selectedPatient]);

  // Step 1: 환자 검색
  const { data: patientsData, isError: patientsIsError, error: patientsError, refetch: refetchPatients } = useQuery({
    queryKey: ['patients-search', search],
    queryFn: () => apiClient.get<{ data: Patient[] }>(`/api/v1/patients?q=${search}&limit=10`),
    enabled: search.length >= 1,
  });
  const patients: Patient[] = (() => { const d = patientsData?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  // Step 2: 기관 검색
  const { data: orgsData, isError: orgsIsError, error: orgsError, refetch: refetchOrgs } = useQuery({
    queryKey: ['organizations', orgSearch],
    queryFn: () => apiClient.get<{ data: Org[] }>(`/api/v1/organizations?q=${orgSearch}`),
    enabled: step === 1,
  });
  const orgs: Org[] = (() => { const d = orgsData?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  // Step 3: 환자 임상 데이터 (진단, 투약, 알레르기)
  const { data: diagData, isError: diagIsError, error: diagError, refetch: refetchDiag } = useQuery({
    queryKey: ['patient-diagnoses', form.patientId],
    queryFn: () => apiClient.get(`/fhir/R4/Condition?subject=Patient/${form.patientId}`),
    enabled: !!form.patientId && step >= 2,
  });
  const { data: medData, isError: medIsError, error: medError, refetch: refetchMed } = useQuery({
    queryKey: ['patient-medications', form.patientId],
    queryFn: () => apiClient.get(`/fhir/R4/MedicationRequest?subject=Patient/${form.patientId}`),
    enabled: !!form.patientId && step >= 2,
  });
  const { data: allergyData, isError: allergyIsError, error: allergyError, refetch: refetchAllergy } = useQuery({
    queryKey: ['patient-allergies', form.patientId],
    queryFn: () => apiClient.get(`/fhir/R4/AllergyIntolerance?patient=Patient/${form.patientId}`),
    enabled: !!form.patientId && step >= 2,
  });

  const diagnoses = (diagData as any)?.data?.entry ?? (diagData as any)?.entry ?? [];
  const medications = (medData as any)?.data?.entry ?? (medData as any)?.entry ?? [];
  const allergies = (allergyData as any)?.data?.entry ?? (allergyData as any)?.entry ?? [];

  const submit = useMutation({
    mutationFn: () => apiClient.post('/api/v1/transfer/request', {
      patientId: form.patientId,
      toOrgId: form.toOrgId,
      transferType: form.transferType,
      urgency: form.urgency,
      reason: form.reason,
    }),
    onSuccess: () => {
      toast.success('전원 의뢰가 생성되었습니다');
      router.push('/transfer');
    },
    onError: () => toast.error('전원 의뢰 생성 실패'),
  });

  const canNext = () => {
    if (step === 0) return !!form.patientId;
    if (step === 1) return !!form.toOrgId && !!form.reason;
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="전원 의뢰 작성" /></h1>
        <p className="text-sm text-gray-500 mt-0.5"><T k="환자 전원 의뢰서를 작성하고 FHIR Bundle로 전송합니다" /></p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'
            }`}>{i < step ? '✓' : i + 1}</div>
            <span className={`text-xs ${i === step ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}><T k={s} /></span>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        {/* Step 1: 환자 선택 */}
        {step === 0 && (
          <div className="space-y-4">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tAttr('환자 이름 또는 등록번호 검색...')}
              className="w-full px-4 py-2.5 border rounded-xl text-sm"
              autoFocus
            />
            {selectedPatient && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="text-sm font-bold text-blue-900">{selectedPatient.familyName}{selectedPatient.givenName}</div>
                <div className="text-xs text-blue-600 mt-1">MRN: {selectedPatient.mrn} | <T k="생년월일" />: {selectedPatient.dateOfBirth?.slice(0, 10)} | {genderText(selectedPatient.gender)}</div>
              </div>
            )}
            {/* 넘겨받은 환자를 못 불러오면 그렇게 말한다(빈 선택으로 두지 않는다) */}
            {prefillIsError && !selectedPatient && <QueryErrorFallback error={prefillErr} onRetry={() => refetchPrefill()} size="compact" />}
            {/* 🔴 검색 실패를 "검색 결과 없음"으로 말하지 않는다 */}
            {patientsIsError && <QueryErrorFallback error={patientsError} onRetry={refetchPatients} size="compact" />}
            {!patientsIsError && patients.length > 0 && !selectedPatient && (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {patients.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedPatient(p); setForm(f => ({ ...f, patientId: p.id })); }}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-50 border transition-colors"
                  >
                    <div className="text-sm font-medium">{p.familyName}{p.givenName}</div>
                    <div className="text-[10px] text-gray-400">MRN: {p.mrn} | {p.dateOfBirth?.slice(0, 10)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: 수신 병원 선택 */}
        {step === 1 && (
          <div className="space-y-4">
            <input
              value={orgSearch}
              onChange={e => setOrgSearch(e.target.value)}
              placeholder={tAttr('기관명 또는 기관코드 검색...')}
              className="w-full px-4 py-2.5 border rounded-xl text-sm"
            />
            {selectedOrg && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                <div className="text-sm font-bold text-violet-900">{selectedOrg.name}</div>
                <div className="text-xs text-violet-600 mt-1"><T k="코드" />: {selectedOrg.code} | {selectedOrg.grade ?? selectedOrg.orgType}</div>
              </div>
            )}
            {orgsIsError && <QueryErrorFallback error={orgsError} onRetry={refetchOrgs} size="compact" />}
            {!orgsIsError && orgs.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {orgs.filter(o => o.id !== form.toOrgId).map(o => (
                  <button
                    key={o.id}
                    onClick={() => { setSelectedOrg(o); setForm(f => ({ ...f, toOrgId: o.id })); }}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-50 border transition-colors"
                  >
                    <span className="text-sm font-medium">{o.name}</span>
                    <span className="ml-2 text-[10px] text-gray-400">{o.grade ?? o.orgType}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-medium text-gray-600"><T k="전원 유형" /></label>
                <select
                  value={form.transferType}
                  onChange={e => setForm(f => ({ ...f, transferType: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
                >
                  <option value="OUTGOING_REFERRAL">{tAttr('전원 의뢰@유형')}</option>
                  <option value="RETURN">{tAttr('회송')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600"><T k="긴급도" /></label>
                <select
                  value={form.urgency}
                  onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 border rounded-xl text-sm"
                >
                  <option value="ROUTINE">{tAttr('일반 (ROUTINE)')}</option>
                  <option value="URGENT">{tAttr('긴급 (URGENT)')}</option>
                  <option value="EMERGENT">{tAttr('응급 (EMERGENT)')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600"><T k="전원 사유" /> *</label>
              <textarea
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                rows={3}
                placeholder={tAttr('전원 사유를 입력하세요...')}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 3: 임상 정보 확인 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.includeDiagnoses} onChange={e => setForm(f => ({ ...f, includeDiagnoses: e.target.checked }))} className="rounded" />
                <T k="현재 진단" /> ({diagIsError ? tAttr('조회 실패') : diagnoses.length})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.includeMedications} onChange={e => setForm(f => ({ ...f, includeMedications: e.target.checked }))} className="rounded" />
                <T k="투약 이력" /> ({medIsError ? tAttr('조회 실패') : medications.length})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.includeAllergies} onChange={e => setForm(f => ({ ...f, includeAllergies: e.target.checked }))} className="rounded" />
                <T k="알레르기" /> ({allergyIsError ? tAttr('조회 실패') : allergies.length})
              </label>
            </div>

            {/* 🔴 임상 정보 조회 실패를 "0건"으로 보내지 않는다 — 전원서에 빠진 채 전송된다 */}
            {diagIsError && <QueryErrorFallback error={diagError} onRetry={refetchDiag} size="compact" />}
            {medIsError && <QueryErrorFallback error={medError} onRetry={refetchMed} size="compact" />}
            {allergyIsError && <QueryErrorFallback error={allergyError} onRetry={refetchAllergy} size="compact" />}

            {form.includeDiagnoses && diagnoses.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-700 mb-2"><T k="진단" /></div>
                {diagnoses.map((e: any, i: number) => (
                  <div key={i} className="text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0">
                    {e.resource?.code?.text ?? e.resource?.code?.coding?.[0]?.display ?? '진단정보'}
                  </div>
                ))}
              </div>
            )}

            {form.includeMedications && medications.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-700 mb-2"><T k="투약@목록" /></div>
                {medications.map((e: any, i: number) => (
                  <div key={i} className="text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0">
                    {e.resource?.medicationCodeableConcept?.text ?? '약물'}
                    {e.resource?.dosageInstruction?.[0]?.text && <span className="text-gray-400 ml-2">{e.resource.dosageInstruction[0].text}</span>}
                  </div>
                ))}
              </div>
            )}

            {form.includeAllergies && allergies.length > 0 && (
              <div className="bg-red-50 rounded-xl p-4">
                <div className="text-xs font-semibold text-red-700 mb-2"><T k="알레르기" /></div>
                {allergies.map((e: any, i: number) => (
                  <div key={i} className="text-xs text-red-600 py-1 border-b border-red-100 last:border-0">
                    {e.resource?.code?.text ?? '알레르기'} — {e.resource?.criticality === 'high' ? '중증' : '경증'}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-600"><T k="추가 임상 소견" /></label>
              <textarea
                value={form.clinicalSummary}
                onChange={e => setForm(f => ({ ...f, clinicalSummary: e.target.value }))}
                rows={3}
                placeholder={tAttr('수신 병원에 전달할 추가 소견...')}
                className="w-full mt-1 px-3 py-2 border rounded-xl text-sm resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 4: 전송 확인 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="text-4xl mb-3">📦</div>
              <div className="text-lg font-bold text-gray-900"><T k="FHIR Bundle 전송 확인" /></div>
              <p className="text-sm text-gray-500 mt-1"><T k="아래 정보로 전원 의뢰서가 생성됩니다" /></p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="환자" /></span>
                <span className="font-medium">{selectedPatient ? `${selectedPatient.familyName}${selectedPatient.givenName}` : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="수신 병원" /></span>
                <span className="font-medium">{selectedOrg?.name ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="긴급도" /></span>
                <span className="font-medium">{form.urgency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="전원 사유" /></span>
                <span className="font-medium text-right max-w-[60%]">{form.reason}</span>
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-blue-700 mb-2"><T k="Bundle 구성 (FHIR R4)" /></div>
              <div className="text-xs text-blue-600 space-y-1 font-mono">
                <div><T k="├─ Composition (전원 의뢰서)" /></div>
                <div>├─ Patient</div>
                {form.includeDiagnoses && <div>├─ Condition ({diagnoses.length})</div>}
                {form.includeMedications && <div>├─ MedicationRequest ({medications.length})</div>}
                {form.includeAllergies && <div>├─ AllergyIntolerance ({allergies.length})</div>}
                <div>└─ ServiceRequest</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => step > 0 ? setStep(step - 1) : router.push('/transfer')}
          className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200"
        >
          {step === 0 ? <T k="취소" /> : <T k="이전" />}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canNext()}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            <T k="다음" />
          </button>
        ) : (
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-40"
          >
            {submit.isPending ? <T k="전송 중..." /> : <T k="전원 의뢰 전송" />}
          </button>
        )}
      </div>
    </div>
  );
}
