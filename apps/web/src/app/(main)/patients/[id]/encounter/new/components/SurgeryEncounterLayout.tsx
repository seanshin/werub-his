'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';

import { EmptyState } from '@/components/ui/display';
import { SurgicalChecklistPanel } from '@/app/(main)/surgery/components/SurgicalChecklistPanel';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SurgeryEncounterLayoutProps {
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다. 종전엔 진료과 레이아웃에 처방 입력이 없었다 */
  rxSlot?: ReactNode;
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  patient: { familyName?: string; givenName?: string; mrn?: string };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
}

type TabKey = 'soap' | 'booking' | 'opnote' | 'checklist';

interface SurgeryRecord {
  id: string;
  procedureName: string;
  scheduledAt: string;
  /** 해부학적 부위 — 술식명과 다른 개념(오부위수술 방지) */
  bodySite?: string | null;
  laterality?: string | null;
  anesthesiaType?: string;
  preOpDiagnosis?: string;
  status?: string;
  surgeon?: string;
  /** 보조 의사 — 서버가 계정을 조인해 준다(지정 안 했으면 null) */
  assistant?: { id: string; familyName: string; givenName: string; department?: string | null } | null;
  /** 수술실 배정(OrSchedule) — 예상 소요시간의 정본은 여기다. 미배정이면 null */
  orRoom?: { name: string; startTime?: string; endTime?: string; estimatedDuration?: number } | null;
}

interface DoctorOption { id: string; familyName: string; givenName: string; department?: string | null; isActive?: boolean }

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS: { key: TabKey; label: string }[] = [
  { key: 'soap', label: 'SOAP + 진찰' },
  { key: 'booking', label: '수술 예약' },
  { key: 'opnote', label: 'Op Note' },
  { key: 'checklist', label: '체크리스트' },
];

/**
 * 좌우 구분 — 스키마 `Laterality` 열거형 그대로. 🔴 '미지정'(값 없음)과 '해당 없음(NA)'은 다른 사실이다.
 *  · 미지정 = 아직 정하지 않았다(좌우 게이트가 걸릴 수 있다)
 *  · 해당 없음 = 이 술식엔 좌우가 없다고 **판단해서 적은 것**
 */
const LATERALITY_OPTIONS = [
  { value: '', label: '미지정 (아직 정하지 않음)' },
  { value: 'LEFT', label: '좌 (Left)' },
  { value: 'RIGHT', label: '우 (Right)' },
  { value: 'BILATERAL', label: '양측 (Bilateral)' },
  { value: 'MIDLINE', label: '정중선 (Midline)' },
  { value: 'NA', label: '해당 없음 (좌우 구분 없는 술식)' },
];

const ANESTHESIA_TYPES = [
  { value: 'GENERAL', label: '전신마취 (General)' },
  { value: 'REGIONAL', label: '부위마취 (Regional)' },
  { value: 'LOCAL', label: '국소마취 (Local)' },
  { value: 'SEDATION', label: '진정마취 (Sedation)' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SurgeryEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: SurgeryEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TabKey>('soap');

  /* SOAP state */
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  /* Booking state */
  const [procedureName, setProcedureName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const user = useAuthStore((st) => st.user);
  const canBook = user?.role === 'DOCTOR';
  const [anesthesiaType, setAnesthesiaType] = useState('GENERAL');
  const [preOpDiagnosis, setPreOpDiagnosis] = useState('');
  /**
   * 🔴 오부위수술 방지가 **입구에서 끊겨 있었다** — 이 화면이 `bodySite`·`laterality` 를 아예
   *    보내지 않아(서버 DTO 에는 있었다) 예약된 수술의 부위·좌우가 시드 외에는 항상 비었다.
   *    좌/우는 **모든 수술에 필수가 아니다**(충수절제·제왕절개엔 좌우가 없다) — 아무 값이나 고르게
   *    강제하면 원장이 거짓이 된다. 그래서 기본값은 **'미지정'**이고, 좌우가 없는 술식을 위한
   *    '해당 없음(NA)'을 따로 둔다. 필요 여부 판정은 서버 정본(config surgery.lateralityKeywords)이
   *    하고, 화면은 그 판정 결과를 받아 말한다(키워드를 여기 복사하면 정본이 둘이 된다).
   */
  const [bodySite, setBodySite] = useState('');
  const [laterality, setLaterality] = useState('');
  const [siteWarning, setSiteWarning] = useState<string | null>(null);
  // 🔴 보조 의사는 **고르는 것**이지 적는 것이 아니다 — 컬럼이 uuid(`Surgery.assistantId`)라
  //    이름 문자열은 저장될 수 없다(종전 화면은 자유 텍스트를 받아 아무 데도 보내지 않았다).
  const [assistantId, setAssistantId] = useState('');

  /* Op Note state */
  const [selectedSurgeryId, setSelectedSurgeryId] = useState('');
  const [opPreOpDiagnosis, setOpPreOpDiagnosis] = useState('');
  const [postOpDiagnosis, setPostOpDiagnosis] = useState('');
  const [opNote, setOpNote] = useState('');
  const [findings, setFindings] = useState('');
  const [complications, setComplications] = useState('');
  const [specimens, setSpecimens] = useState('');
  // 🔴 기본값 0 은 '측정하지 않았다'가 아니라 '출혈이 없었다'는 다른 사실이다 —
  //    미입력은 빈 값(미기재)으로 두고 서버에도 보내지 않는다.
  const [ebl, setEbl] = useState<string>('');
  const [fluidsGiven, setFluidsGiven] = useState('');
  const [implants, setImplants] = useState('');
  const [drains, setDrains] = useState('');

  /* Checklist state — 🔴 체크 항목은 화면에 적어두지 않는다. 서버 정의(`CHECKLIST_ITEMS`)를
     받아 쓰는 정본 패널(`SurgicalChecklistPanel`)에 위임한다. 여기서는 대상 수술만 고른다.
     종전에는 이 화면이 자체 체크박스 17개를 들고 `POST /surgery/:id/checklist` 로 보냈는데,
     서버 핸들러에 `@Body` 가 없어 **본문이 통째로 버려지고도 "저장되었습니다"** 라고 말했다. */
  const [checklistSurgeryId, setChecklistSurgeryId] = useState('');

  /* Queries */
  const { data: surgeries, refetch: refetchSurgeries } = useQuery({
    queryKey: ['surgery-schedule', patientId],
    queryFn: () => apiClient.get(`/api/v1/surgery/schedule?patientId=${patientId}`),
    enabled: !!patientId,
  });

  const surgeryList: SurgeryRecord[] = (surgeries as { data?: SurgeryRecord[] })?.data ?? (Array.isArray(surgeries) ? surgeries as SurgeryRecord[] : []);

  // 보조 의사 후보 — 병원 정본 의사 목록(원격진료 예약과 같은 EP). 집도의(본인)는 뺀다.
  const { data: doctorData, isLoading: doctorsLoading, isError: doctorsError } = useQuery({
    queryKey: ['surgery-assistant-options'],
    queryFn: () => apiClient.get<{ data: DoctorOption[] }>('/api/v1/users/doctors'),
  });
  const assistantOptions: DoctorOption[] = (Array.isArray(doctorData?.data) ? doctorData.data : [])
    .filter((d) => d.isActive !== false && d.id !== user?.id);

  /* Mutations */
  const bookMutation = useMutation({
    mutationFn: () =>
      // 🔴 `surgeonId` 를 보내지 않아(`surgeon: 'self'` 는 서버에 없는 키다) 수술 예약이
      //    개통 이래 **100% 400 으로 실패**했다. 집도의는 이 화면에서 진료 중인 **본인**이다 —
      //    누구인지 화면에 표시하고, 의사 계정이 아니면 예약 자체를 막는다(오귀속 방지).
      //    보조 의사는 컬럼(`Surgery.assistantId`)이 uuid 라 **고른 계정 id** 를 보낸다(이름 문자열 금지).
      //    예상 소요시간은 이 단계에 저장할 곳이 없다 — 정본은 수술실 배정(OrSchedule.estimatedDuration)이고,
      //    배정 전에는 그 행 자체가 없다(roomId 필수). 그래서 여기서는 **입력 자체를 두지 않는다**.
      apiClient.post('/api/v1/surgery', {
        patientId,
        surgeonId: user!.id,
        procedureName,
        scheduledAt,
        anesthesiaType,
        preOpDiagnosis: preOpDiagnosis || undefined,
        assistantId: assistantId || undefined,
        // 부위·좌우 — 미입력은 보내지 않는다(빈 문자열은 '지정했는데 비었다'로 읽힌다)
        bodySite: bodySite.trim() || undefined,
        laterality: laterality || undefined,
      }),
    onSuccess: (res) => {
      toast.success('수술이 예약되었습니다.');
      /**
       * 🔴 서버가 좌우 판정 결과를 함께 준다(`siteVerification`). 게이트가 OFF 라 **막지는 않아도**
       *    "좌우가 필요한 술식인데 비었다"는 사실은 이 자리에서 말해야 한다 — 부위표시·동의서·
       *    수술방 배정이 다 끝난 뒤 Sign-In 에서 걸리면 이미 늦다. 막지 않는 것과 숨기는 것은 다르다.
       */
      const sv = (res as { data?: { siteVerification?: { warning?: string | null } } })?.data?.siteVerification;
      if (sv?.warning) {
        setSiteWarning(sv.warning);
        toast.error(sv.warning);
      } else {
        setSiteWarning(null);
      }
      setProcedureName('');
      setScheduledAt('');
      setAnesthesiaType('GENERAL');
      setPreOpDiagnosis('');
      setAssistantId('');
      setBodySite('');
      setLaterality('');
      refetchSurgeries();
    },
    // 🔴 실패 사유를 '실패했습니다'로 뭉개면 보조의 검증(집도의와 동일·의사 아님)을 고칠 수 없다.
    onError: (e) => toast.error((e as { message?: string })?.message || '수술 예약에 실패했습니다.'),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/api/v1/surgery/${selectedSurgeryId}/complete`, {
        preOpDiagnosis: opPreOpDiagnosis,
        postOpDiagnosis,
        opNote,
        findings,
        complications,
        specimens,
        // 컬럼 `Surgery.ebl` 은 Int 다 — 문자열로 보내면 400 이다(미입력은 아예 보내지 않는다).
        ebl: ebl.trim() === '' ? undefined : Number(ebl),
        fluidsGiven,
        implants,
        drains,
      }),
    onSuccess: () => {
      toast.success('수술 완료 + Op Note가 저장되었습니다.');
      refetchSurgeries();
    },
    // 🔴 사유를 뭉개면 '숫자여야 한다' 같은 계약 오류가 화면에서 영영 안 보인다.
    onError: (e) => toast.error((e as { message?: string })?.message || 'Op Note 저장에 실패했습니다.'),
  });

  /* ------------------------------------------------------------------ */
  /*  Render helpers                                                     */
  /* ------------------------------------------------------------------ */

  const buildSoap = () => ({ subjective: subjective || undefined, objective: objective || undefined, assessment: assessment || undefined, plan: plan || undefined });

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-2">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'soap' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <T k="SOAP + 진찰" />
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="S (Subjective) — 주관적 소견" /></label>
              <textarea
                rows={4}
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                placeholder={tAttr("환자 주소, 현병력, 수술 관련 증상...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="O (Objective) — 객관적 소견" /></label>
              <textarea
                rows={4}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder={tAttr("이학적 검사, 활력징후, 검사결과...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="A (Assessment) — 평가" /></label>
              <textarea
                rows={4}
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                placeholder={tAttr("진단명, 감별진단...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="P (Plan) — 계획" /></label>
              <textarea
                rows={4}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder={tAttr("수술 계획, 추가 검사, 처방...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'booking' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Booking Form */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <T k="수술 예약" />
            </h3>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술명" /></label>
              <input
                type="text"
                value={procedureName}
                onChange={(e) => setProcedureName(e.target.value)}
                placeholder={tAttr("예: 충수돌기절제술, 담낭절제술...")}
                disabled={!encounterId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>

            {/* 🔴 오부위수술 방지 — 부위와 좌우는 **술식명과 다른 개념**이다(술식명을 부위로 쓰지 않는다) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 부위 (해부학적 부위)" /></label>
                <input
                  type="text"
                  value={bodySite}
                  onChange={(e) => setBodySite(e.target.value)}
                  placeholder={tAttr("예: 슬관절, 안구, 서혜부...")}
                  disabled={!encounterId}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="좌우 구분" /></label>
                <select
                  value={laterality}
                  onChange={(e) => setLaterality(e.target.value)}
                  disabled={!encounterId}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                >
                  {LATERALITY_OPTIONS.map((o) => (
                    <option key={o.value || 'NONE'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 -mt-1">
              좌우가 있는 부위(슬관절·안구·신장 등)는 좌/우를 지정해야 합니다 — 좌우가 없는 술식은
              &lsquo;해당 없음&rsquo;으로 적습니다. 필요 여부는 서버 기준(부위 키워드)이 판정합니다.
            </p>
            {siteWarning && (
              <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                ⚠ {siteWarning}
              </p>
            )}

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 예정일" /></label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={!encounterId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="마취 유형" /></label>
              <select
                value={anesthesiaType}
                onChange={(e) => setAnesthesiaType(e.target.value)}
                disabled={!encounterId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              >
                {ANESTHESIA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 전 진단" /></label>
              <textarea
                rows={2}
                value={preOpDiagnosis}
                onChange={(e) => setPreOpDiagnosis(e.target.value)}
                placeholder={tAttr("수술 전 진단명...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="보조 의사 (선택)" /></label>
              {doctorsError ? (
                <p className="text-[11px] text-red-600 py-2">
                  <T k="의사 목록을 불러오지 못했습니다 — 보조 의사를 확인할 수 없어 지정하지 않고 예약합니다." />
                </p>
              ) : (
                <select
                  value={assistantId}
                  onChange={(e) => setAssistantId(e.target.value)}
                  disabled={!encounterId || doctorsLoading}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                >
                  <option value="">
                    {doctorsLoading ? '불러오는 중...' : assistantOptions.length === 0 ? '지정 가능한 의사가 없습니다' : '지정 안 함'}
                  </option>
                  {assistantOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.familyName}{d.givenName}{d.department ? ` · ${d.department}` : ''}</option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-gray-400 mt-1">
                <T k="수술 프로토콜 단계 알림이 이 계정으로 갑니다 — 집도의 본인은 목록에 없습니다." />
              </p>
            </div>

            {/* 집도의는 화면에 드러낸다 — 누구 이름으로 예약되는지 모르는 채 저장하지 않는다 */}
            <p className="text-[11px] text-gray-500">
              <T k="집도의:" /> <span className="font-medium text-gray-800">{user ? `${user.familyName}${user.givenName}` : '확인 중'}</span>
              {!canBook && <span className="text-red-600"> — 의사 계정이 아니어서 예약할 수 없습니다</span>}
            </p>
            <p className="text-[11px] text-gray-400">
              예상 소요시간은 <span className="font-medium text-gray-500">수술방 관리 → 배정</span>에서 입력합니다
              (정본은 수술실 배정이고, 방을 정하기 전에는 저장할 곳이 없습니다).
            </p>

            <button
              onClick={() => bookMutation.mutate()}
              disabled={!encounterId || !procedureName || !scheduledAt || !canBook || bookMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              {bookMutation.isPending ? '예약중...' : '수술 예약'}
            </button>
          </div>

          {/* Existing Surgery List */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <T k="수술 목록" />
            </h3>

            {surgeryList.length === 0 ? (
              <EmptyState icon="📅" title="예약된 수술이 없습니다." />
            ) : (
              <div className="space-y-3">
                {surgeryList.map((s) => (
                  <div
                    key={s.id}
                    className="border border-gray-200 rounded-xl p-4 space-y-1 hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900">{s.procedureName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                        s.status === 'COMPLETED' ? 'bg-green-100 text-green-700'
                          : s.status === 'IN_PROGRESS' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {s.status === 'COMPLETED' ? '완료' : s.status === 'IN_PROGRESS' ? '진행중' : '예정'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.scheduledAt ? kdate(s.scheduledAt, 'datetimeSec') : '—'}
                      {/* 🔴 예상 소요시간은 배정(OrSchedule)에만 있다 — 종전엔 서버가 보낸 적 없는
                          `s.estimatedDuration` 을 찍어 항상 빈칸이었다. 미배정은 미배정이라고 말한다. */}
                      {s.orRoom ? ` | ${s.orRoom.name}${s.orRoom.estimatedDuration ? ` ${s.orRoom.estimatedDuration}분` : ''}` : ' | 수술방 미배정'}
                      {s.anesthesiaType ? ` | ${s.anesthesiaType}` : ''}
                    </div>
                    {/* 🔴 부위·좌우는 오부위수술 직전 방어선이다 — 비어 있으면 '미지정'이라고 말한다(빈칸=문제없음으로 읽히지 않게) */}
                    <div className="text-xs text-gray-500">
                      부위: {s.bodySite || <span className="text-gray-300"><T k="미지정" /></span>}
                      {' · '}좌우: {LATERALITY_OPTIONS.find((o) => o.value === (s.laterality ?? ''))?.label.split(' ')[0] ?? s.laterality ?? '미지정'}
                    </div>
                    <div className="text-xs text-gray-400">
                      보조의: {s.assistant ? `${s.assistant.familyName}${s.assistant.givenName}` : '지정 안 함'}
                    </div>
                    {s.preOpDiagnosis && (
                      <div className="text-xs text-gray-400">Dx: {s.preOpDiagnosis}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'opnote' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            <T k="Op Note (수술 기록)" />
          </h3>

          {/* Select surgery */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 선택" /></label>
            <select
              value={selectedSurgeryId}
              onChange={(e) => setSelectedSurgeryId(e.target.value)}
              disabled={!encounterId}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            >
              <option value=""><T k="수술을 선택하세요" /></option>
              {surgeryList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.procedureName} — {s.scheduledAt ?kdate(s.scheduledAt, 'date') : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 전 진단 (Pre-op Dx)" /></label>
              <textarea
                rows={2}
                value={opPreOpDiagnosis}
                onChange={(e) => setOpPreOpDiagnosis(e.target.value)}
                placeholder={tAttr("수술 전 진단명...")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 후 진단 (Post-op Dx)" /></label>
              <textarea
                rows={2}
                value={postOpDiagnosis}
                onChange={(e) => setPostOpDiagnosis(e.target.value)}
                placeholder={tAttr("수술 후 진단명...")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 소견 (Op Note)" /></label>
            <textarea
              rows={5}
              value={opNote}
              onChange={(e) => setOpNote(e.target.value)}
              placeholder={tAttr("수술 과정, 절개 방법, 소견 등을 기록...")}
              disabled={!encounterId || !selectedSurgeryId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="소견 (Findings)" /></label>
              <textarea
                rows={3}
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                placeholder={tAttr("수술 중 발견 사항...")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="합병증 (Complications)" /></label>
              <textarea
                rows={3}
                value={complications}
                onChange={(e) => setComplications(e.target.value)}
                placeholder={tAttr("합병증 없음 또는 기록...")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="검체 (Specimens)" /></label>
              <input
                type="text"
                value={specimens}
                onChange={(e) => setSpecimens(e.target.value)}
                placeholder={tAttr("검체 종류")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="추정 출혈량 (EBL, ml)" /></label>
              <input
                type="number"
                value={ebl}
                onChange={(e) => setEbl(e.target.value)}
                min={0}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수액 (Fluids Given)" /></label>
              <input
                type="text"
                value={fluidsGiven}
                onChange={(e) => setFluidsGiven(e.target.value)}
                placeholder={tAttr("NS 1L 등")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="삽입물 (Implants)" /></label>
              <input
                type="text"
                value={implants}
                onChange={(e) => setImplants(e.target.value)}
                placeholder={tAttr("없음 또는 기재")}
                disabled={!encounterId || !selectedSurgeryId}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="배액관 (Drains)" /></label>
            <input
              type="text"
              value={drains}
              onChange={(e) => setDrains(e.target.value)}
              placeholder={tAttr("JP drain #1, Hemovac 등")}
              disabled={!encounterId || !selectedSurgeryId}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => completeMutation.mutate()}
            disabled={!encounterId || !selectedSurgeryId || completeMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {completeMutation.isPending ? '저장중...' : '수술 완료 + Op Note 저장'}
          </button>
        </div>
      )}

      {activeTab === 'checklist' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <T k="WHO 수술 안전 체크리스트" />
          </h3>

          {/* Select surgery */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="수술 선택" /></label>
            <select
              value={checklistSurgeryId}
              onChange={(e) => setChecklistSurgeryId(e.target.value)}
              disabled={!encounterId}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            >
              <option value=""><T k="수술을 선택하세요" /></option>
              {surgeryList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.procedureName} — {s.scheduledAt ?kdate(s.scheduledAt, 'date') : ''}
                </option>
              ))}
            </select>
          </div>

          {checklistSurgeryId ? (
            <SurgicalChecklistPanel
              surgeryId={checklistSurgeryId}
              status={surgeryList.find((s) => s.id === checklistSurgeryId)?.status ?? ''}
            />
          ) : (
            <p className="text-sm text-gray-500"><T k="수술을 선택하면 WHO 수술 안전 체크리스트가 열립니다." /></p>
          )}
        </div>
      )}

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            외과 진료 | 수술 {surgeryList.length}건
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSaveDraft(buildSoap())}
              disabled={!encounterId || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
            </button>
            <button
              onClick={() => onSignAndBill(buildSoap())}
              disabled={!encounterId || isSigning}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
