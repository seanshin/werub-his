'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Check, CircleAlert, CreditCard, FileSignature, FileText, Globe, Home, IdCard, Paperclip, Pencil, Plane, Search, Trash2, UserRound, Video, type LucideIcon } from 'lucide-react';
import { CONSENT_TYPE_CODES } from '@hospital-run/shared';
import { Unit } from '@/components/ui/display';
import { RowAction, RowActionFile, RowActions } from '@/components/ui/RowAction';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { uploadMultipart, attachmentCountFrom } from '@/lib/upload';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { extractErrorMessage } from '@/lib/error-utils';
import { T, useTAttr } from '@/components/ui/i18n-text';

const PATIENT_TYPES = [
  { value: 'FOREIGN_TOURIST', label: '외국인 관광객', desc: '여행/관광 목적 단기 방문' },
  { value: 'FOREIGN_RESIDENT', label: '외국인 거주자', desc: '외국인등록번호 보유, 국민건강보험 가능' },
  { value: 'OVERSEAS_KOREAN', label: '재외동포', desc: '해외 거주 한국인, 여권+선택적 주민번호' },
  { value: 'REMOTE_INTERNATIONAL', label: '원격 해외환자', desc: '원격진료/2차소견 목적' },
];
const TYPE_ICON: Record<string, LucideIcon> = { FOREIGN_TOURIST: Plane, FOREIGN_RESIDENT: Home, OVERSEAS_KOREAN: Globe, REMOTE_INTERNATIONAL: Video };

/** 입력 칸 한 벌 — 초점 링·높이를 한곳에서(칸마다 제각각이던 것) */
const INP = 'w-full mt-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const LBL = 'text-xs font-medium text-slate-600';
function Section({ n, title, Icon, children }: { n: number; title: string; Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="mb-4 flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</span>
        <Icon className="h-4 w-4 text-slate-400" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-800"><T k={title} /></h3>
      </header>
      {children}
    </section>
  );
}

// 🔴 여행자보험/대사관/선수금은 공단 청구 체계(InsuranceType enum)에 없어 **청구상 자비**로 저장된다
//    (보증 내용은 별도 보존). 종전엔 이 사실을 숨겨 수납·청구 화면과 말이 달랐다(P4-서버).
const INSURANCE_TYPES = [
  { value: 'SELF_PAY', label: '자비 (Self Pay)' },
  { value: 'NHI', label: '국민건강보험 (NHI)' },
  { value: 'TRAVEL_INSURANCE', label: '여행자 보험 (청구: 자비 · 보증정보 보존)' },
  { value: 'EMBASSY', label: '대사관 보증 (청구: 자비 · 보증정보 보존)' },
  { value: 'DEPOSIT', label: '선수금 (청구: 자비 · 선수금 필요)' },
];

// 폴백 목록 — 정본은 config patient.supportedLanguages(관리자 등록·동의서 템플릿 관리 화면에서 추가)
const LANGUAGES_FALLBACK = [
  { value: 'ko', label: '한국어' }, { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' }, { value: 'ja', label: '日本語' },
  { value: 'vi', label: 'Tiếng Việt' }, { value: 'ru', label: 'Русский' },
];

const VISA_TYPES = [
  { value: '', label: '선택 안 함' },
  { value: 'B-1', label: 'B-1 사증면제' }, { value: 'B-2', label: 'B-2 관광통과' },
  { value: 'C-3', label: 'C-3 단기방문' }, { value: 'C-4', label: 'C-4 단기취업' },
  { value: 'D-2', label: 'D-2 유학' }, { value: 'D-4', label: 'D-4 일반연수' },
  { value: 'E-7', label: 'E-7 특정활동' }, { value: 'E-9', label: 'E-9 비전문취업' },
  { value: 'F-1', label: 'F-1 방문동거' }, { value: 'F-2', label: 'F-2 거주' },
  { value: 'F-4', label: 'F-4 재외동포' }, { value: 'F-5', label: 'F-5 영주' },
  { value: 'F-6', label: 'F-6 결혼이민' }, { value: 'H-2', label: 'H-2 방문취업' },
  { value: 'G-1', label: 'G-1 기타(의료 등)' }, { value: 'OTHER', label: '기타' },
];

interface ConsentTemplateRow { id: string; type: string; name: string; language: string; version: string; content: unknown }
// 🔴 로컬 사본이었다(정본 둘) — Prisma enum 거울은 shared `CONSENT_TYPE_CODES` 하나(2026-09-22)
const CONSENT_TYPE_ENUM: readonly string[] = CONSENT_TYPE_CODES;

const COUNTRIES = [
  { value: 'USA', label: '미국' }, { value: 'CHN', label: '중국' }, { value: 'JPN', label: '일본' },
  { value: 'VNM', label: '베트남' }, { value: 'PHL', label: '필리핀' }, { value: 'THA', label: '태국' },
  { value: 'RUS', label: '러시아' }, { value: 'GBR', label: '영국' }, { value: 'DEU', label: '독일' },
  { value: 'FRA', label: '프랑스' }, { value: 'IND', label: '인도' }, { value: 'IDN', label: '인도네시아' },
  { value: 'MNG', label: '몽골' }, { value: 'UZB', label: '우즈베키스탄' }, { value: 'KHM', label: '캄보디아' },
];

export default function ForeignPatientRegisterPage() {
  const tA = useTAttr();
  /** 🔴 외국인 등록 **삭제**는 서버가 `@Roles(ADMIN)` — 보관(archive)은 간호·원무도 한다 */
  const canDelete = useAdminWrite();
  const router = useRouter();
  const [form, setForm] = useState({
    patientType: 'FOREIGN_TOURIST',
    familyName: '', givenName: '', nameEn: '', koreanName: '',
    nationality: 'USA', passportNumber: '', alienRegistrationNo: '',
    dateOfBirth: '', gender: 'MALE' as 'MALE' | 'FEMALE',
    phone: '', email: '', preferredLanguage: 'en',
    insuranceType: 'SELF_PAY',
    travelInsuranceCompany: '', travelInsurancePolicyNo: '', travelInsuranceContactNo: '',
    embassyContact: '', interpreterNeeded: false,
    passportExpiry: '', visaType: '', localAddress: '',
    emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  });
  // 등록 전 선택한 서류 파일(여권 사본·보험증권 등) — 등록 성공 직후 자동 업로드
  const [pendingDocs, setPendingDocs] = useState<File[]>([]);
  const [docBusy, setDocBusy] = useState<string | null>(null); // patientId 업로드 중 표시

  const uploadPatientDoc = async (patientId: string, file: File): Promise<boolean> => {
    try {
      await uploadMultipart(`/api/v1/patients/foreign/${patientId}/attachments`, file);
      return true;
    } catch (e) {
      toast.error(`${file.name}: ${(e as Error)?.message ?? '첨부 실패'}`);
      return false;
    }
  };

  // 직접 입력(목록에 없는 국적/언어)
  const [customNationality, setCustomNationality] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const effNationality = form.nationality === 'OTHER' ? customNationality.trim().toUpperCase() : form.nationality;
  const effLanguage = form.preferredLanguage === '__custom' ? customLanguage.trim().toLowerCase() : form.preferredLanguage;
  // 화면 모드: 신규 등록 | 등록 목록 관리
  const [view, setView] = useState<'register' | 'list'>('register');
  const [listSearch, setListSearch] = useState('');
  const [listType, setListType] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm2, setEditForm2] = useState<Record<string, any>>({});

  // 등록 완료 후 동의서 발급 패널 대상
  const [registered, setRegistered] = useState<{ id: string; mrn?: string; name: string; language: string } | null>(null);
  const [issued, setIssued] = useState<Record<string, string>>({}); // templateId → consentId

  // 지원 언어 마스터(config) — 실패 시 폴백
  const { data: langCfg, isError: langIsError, error: langError, refetch: refetchLang } = useQuery({
    queryKey: ['supported-languages'],
    queryFn: () => apiClient.get<{ data: { code: string; label: string }[] }>('/api/v1/config/patient.supportedLanguages'),
    staleTime: 300_000,
  });
  const languages = (Array.isArray(langCfg?.data) ? langCfg!.data : LANGUAGES_FALLBACK.map(l => ({ code: l.value, label: l.label })))
    .filter(l => l?.code && l?.label);

  // 동의서 템플릿 — 선호 언어판(없으면 한국어판 폴백 표시). 등록 전에도 미리보기로 조회
  const activeLang = registered?.language ?? (effLanguage || 'en');
  const { data: tplRes, isError: tplIsError, error: tplError, refetch: refetchTpl } = useQuery({
    queryKey: ['consent-templates-lang', activeLang],
    queryFn: () => apiClient.get<{ data: ConsentTemplateRow[] }>(`/api/v1/consent-templates?language=${encodeURIComponent(activeLang)}`),
  });
  const { data: tplKoRes, isError: tplKoIsError, error: tplKoError, refetch: refetchTplKo } = useQuery({
    queryKey: ['consent-templates-lang', 'ko'],
    queryFn: () => apiClient.get<{ data: ConsentTemplateRow[] }>('/api/v1/consent-templates?language=ko'),
    enabled: activeLang !== 'ko',
  });
  // 🔴 두 언어판 중 하나라도 실패하면 "템플릿 없음"으로 말할 수 없다
  const templatesIsError = tplIsError || tplKoIsError;
  const templatesError = tplIsError ? tplError : tplKoError;
  const refetchTemplates = () => { void refetchTpl(); if (activeLang !== 'ko') void refetchTplKo(); };
  const prefTemplates = (tplRes?.data ?? []) as ConsentTemplateRow[];
  const koTemplates = (tplKoRes?.data ?? []) as ConsentTemplateRow[];
  // 선호 언어판 우선·같은 이름의 한국어판은 언어판 없을 때만 폴백 노출
  const templates: (ConsentTemplateRow & { fallback?: boolean })[] = activeLang === 'ko'
    ? prefTemplates
    : [...prefTemplates, ...koTemplates.filter(k => !prefTemplates.some(p2 => p2.name === k.name)).map(k => ({ ...k, fallback: true }))];

  const issueConsent = useMutation({
    mutationFn: async (t: ConsentTemplateRow) => {
      const res = await apiClient.post<{ data: { id: string } }>(`/api/v1/patients/${registered!.id}/consents`, {
        type: t.type,
        templateName: t.name,
        templateId: t.id,
        content: t.content,
        ...(CONSENT_TYPE_ENUM.includes(t.type) ? { consentType: t.type } : {}),
      });
      return { templateId: t.id, consentId: (res as any)?.data?.id ?? (res as any)?.data?.data?.id };
    },
    onSuccess: ({ templateId, consentId }) => {
      if (!consentId) { toast.error('동의서 생성 응답 오류'); return; }
      setIssued(prev => ({ ...prev, [templateId]: consentId }));
      window.open(`/print/consent/${consentId}`, '_blank');
      toast.success('동의서 발급 — 인쇄 화면을 열었습니다');
    },
    onError: (e: any) => toast.error(e?.message ?? '동의서 발급 실패'),
  });

  // 서명 타블렛(등록·승인된 기기) — online 우선 노출
  const { data: deviceRes, isError: deviceIsError, error: deviceError, refetch: refetchDevices } = useQuery({
    queryKey: ['consent-devices'],
    queryFn: () => apiClient.get<{ data: { id: string; name: string; location?: string; approvalStatus: string; status: string; online: boolean }[] }>('/api/v1/consent-devices'),
    refetchInterval: pollMs('normal'),
  });
  const devices = ((deviceRes?.data ?? []) as { id: string; name: string; location?: string; approvalStatus: string; status: string; online: boolean }[])
    .filter(d => d.approvalStatus === 'APPROVED');
  const [selectedDevice, setSelectedDevice] = useState('');
  const deviceId = selectedDevice || devices.find(d => d.online && d.status === 'IDLE')?.id || devices[0]?.id || '';

  const dispatchTablet = useMutation({
    mutationFn: (consentId: string) => apiClient.post(`/api/v1/consent-devices/${deviceId}/dispatch`, { consentId }),
    onSuccess: () => toast.success('타블렛으로 서명 요청을 전송했습니다 — 환자에게 타블렛을 전달하세요'),
    onError: (e: any) => toast.error(e?.message ?? '타블렛 전송 실패 (기기 상태 확인)'),
  });

  // ── 등록 목록 관리 ──
  const listQuery = useQuery({
    queryKey: ['foreign-patients', listSearch, listType, showArchived],
    queryFn: () => apiClient.get<{ data: any[] }>(
      `/api/v1/patients/foreign/list?includeArchived=${showArchived}`
      + (listSearch ? `&search=${encodeURIComponent(listSearch)}` : '')
      + (listType ? `&patientType=${listType}` : '')),
    enabled: view === 'list',
    refetchInterval: view === 'list' ? 30000 : false,
  });
  const rows = (listQuery.data?.data ?? []) as any[];

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/patients/foreign/${id}`, body),
    onSuccess: () => { toast.success('수정 완료'); listQuery.refetch(); setEditRow(null); },
    onError: (e: any) => toast.error(e?.message ?? '수정 실패'),
  });
  const archiveMut = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore?: boolean }) =>
      apiClient.patch(`/api/v1/patients/foreign/${id}/${restore ? 'restore' : 'archive'}`, {}),
    onSuccess: (_r, v) => { toast.success(v.restore ? '복원했습니다' : '보관했습니다 (목록에서 숨김·복원 가능)'); listQuery.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? '처리 실패'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/patients/foreign/${id}`),
    onSuccess: () => { toast.success('삭제했습니다 (등록 오류 건)'); listQuery.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? '삭제 불가 — 임상 기록이 있으면 보관을 사용하세요'),
  });

  const openRowEdit = (r: any) => {
    setEditRow(r);
    setEditForm2({
      familyName: r.familyName ?? '', givenName: r.givenName ?? '', nameEn: r.nameEn ?? '', koreanName: r.koreanName ?? '',
      nationality: r.nationality ?? '', preferredLanguage: r.preferredLanguage ?? 'en',
      passportNumber: r.passportNumber ?? '', passportExpiry: r.passportExpiry?.slice(0, 10) ?? '',
      visaType: r.visaType ?? '', phone: r.phone ?? '', email: r.email ?? '',
      localAddress: r.address?.detail ?? '', embassyContact: r.embassyContact ?? '',
      interpreterNeeded: !!r.interpreterNeeded, patientType: r.patientSource ?? 'FOREIGN_TOURIST',
    });
  };
  const saveRowEdit = () => {
    if (!editRow) return;
    updateMut.mutate({ id: editRow.id, body: { ...editForm2, localAddress: editForm2.localAddress || undefined } });
  };

  // 동의서 첨부(설명자료·스캔본) — multipart는 fetch+FormData(apiClient는 JSON 전용)
  const [attachCounts, setAttachCounts] = useState<Record<string, number>>({});
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const uploadAttachment = async (consentId: string, file: File) => {
    setAttachBusy(consentId);
    try {
      const body: any = await uploadMultipart(`/api/v1/consent/${consentId}/attachments`, file);
      // 서버가 말한 첨부 수만 쓴다 — 응답에서 못 읽으면 추정(이전+1)하지 않고 개수 표시를 지운다
      const count = attachmentCountFrom(body);
      setAttachCounts(prev => {
        const next = { ...prev };
        if (count == null) delete next[consentId]; else next[consentId] = count;
        return next;
      });
      toast.success(count == null
        ? '첨부 완료 — 현재 첨부 수는 확인하지 못했습니다 · 인쇄 시 별첨으로 포함됩니다'
        : `첨부 완료 (${count}개) — 인쇄 시 별첨으로 포함됩니다`);
    } catch (e) {
      toast.error((e as Error)?.message ?? '첨부 실패 (jpeg/png/webp/pdf·10MB)');
    } finally {
      setAttachBusy(null);
    }
  };

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  const submit = useMutation({
    mutationFn: () => {
      const body: any = {
        patientType: form.patientType,
        familyName: form.familyName, givenName: form.givenName, nameEn: form.nameEn,
        koreanName: form.koreanName || undefined,
        nationality: effNationality, dateOfBirth: form.dateOfBirth, gender: form.gender,
        phone: form.phone || undefined, email: form.email || undefined,
        preferredLanguage: effLanguage || 'en', insuranceType: form.insuranceType,
        interpreterNeeded: form.interpreterNeeded,
      };
      if (form.passportNumber) body.passportNumber = form.passportNumber;
      if (form.passportExpiry) body.passportExpiry = form.passportExpiry;
      if (form.visaType) body.visaType = form.visaType;
      if (form.localAddress) body.localAddress = form.localAddress;
      if (form.emergencyName && form.emergencyPhone) {
        body.emergencyContact = { name: form.emergencyName, relationship: form.emergencyRelation || undefined, phone: form.emergencyPhone };
      }
      if (form.alienRegistrationNo) body.alienRegistrationNo = form.alienRegistrationNo;
      if (form.embassyContact) body.embassyContact = form.embassyContact;
      if (form.insuranceType === 'TRAVEL_INSURANCE') {
        body.travelInsurance = { company: form.travelInsuranceCompany, policyNo: form.travelInsurancePolicyNo, contactNo: form.travelInsuranceContactNo };
      }
      return apiClient.post('/api/v1/patients/foreign', body);
    },
    onSuccess: (res: any) => {
      const p = res?.data?.data ?? res?.data;
      toast.success(`외국인 환자 등록 완료${p?.mrn ? ` (MRN: ${p.mrn})` : ''}`);
      if (p?.id) {
        // 선택해 둔 서류 자동 업로드(여권 사본·보험증권 등)
        if (pendingDocs.length > 0) {
          (async () => {
            let ok = 0;
            for (const file of pendingDocs) { if (await uploadPatientDoc(p.id, file)) ok += 1; }
            if (ok > 0) toast.success(`서류 ${ok}건 첨부 완료`);
            setPendingDocs([]);
          })();
        }
        // 등록 직후 동의서 발급 패널로 전환(선호 언어판 동의서 개별 출력)
        setRegistered({ id: p.id, mrn: p.mrn, name: `${form.familyName} ${form.givenName}`, language: effLanguage || 'en' });
      } else {
        router.push('/patients');
      }
    },
    // 🔴 종전엔 axios 식 `err.response` 경로를 읽었다 — apiClient 의 ApiError 에는 response 가 없어 **서버 사유(중복 여권 등)가 늘 '등록 실패'로 덮였다**
    onError: (err: unknown) => toast.error(extractErrorMessage(err) || '등록 실패'),
  });

  const isValid = form.familyName && form.givenName && form.dateOfBirth && !!effNationality && (form.preferredLanguage !== '__custom' || !!effLanguage);
  // 무엇이 빠졌는지 말한다 — 종전엔 버튼만 비활성이라 이유를 몰랐다
  const missing = [
    !form.familyName && '성',
    !form.givenName && '이름@명',
    !form.dateOfBirth && '생년월일',
    !effNationality && '국적',
    form.preferredLanguage === '__custom' && !effLanguage && '선호 언어',
  ].filter(Boolean) as string[];
  const typeMeta = PATIENT_TYPES.find((t) => t.value === form.patientType);
  const insMeta = INSURANCE_TYPES.find((i) => i.value === form.insuranceType);

  return (
    // 폭 상한 없이 여백 흡수(2026-08-04 좌우여백 정리) — 폼은 내부 grid(2/3+1/3)가 비례 분할
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="외국인 환자 등록" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="외국인/재외동포/원격 해외환자 등록" /></p>
        </div>
        <div className="flex gap-1.5 bg-gray-100 rounded-xl p-1">
          <button onClick={() => setView('register')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'register' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>+ <T k="신규 등록" /></button>
          <button onClick={() => setView('list')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'list' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>📋 <T k="등록 목록" /></button>
        </div>
      </div>

      {view === 'register' && (<>
      {/* 환자 유형 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup" aria-label={tA('환자 유형')}>
        {PATIENT_TYPES.map(t => {
          const on = form.patientType === t.value;
          const Icon = TYPE_ICON[t.value] ?? UserRound;
          return (
            <button key={t.value} role="radio" aria-checked={on} data-patient-type={t.value}
              onClick={() => f('patientType', t.value)}
              className={`relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${on ? 'border-blue-500 bg-blue-50/70 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900"><T k={t.label} /></span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500"><T k={t.desc} /></span>
              </span>
              {on && <Check className="absolute right-2.5 top-2.5 h-4 w-4 text-blue-600" aria-hidden />}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
       {/* 좌측 2/3: 기본 + 식별 */}
       <div className="lg:col-span-2 space-y-4">
      {/* 기본 정보 */}
      <Section n={1} title="기본 정보" Icon={UserRound}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LBL}><T k="성(Family Name) *" /></label>
            <input value={form.familyName} onChange={e => f('familyName', e.target.value)} placeholder="Kim" className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="이름(Given Name) *" /></label>
            <input value={form.givenName} onChange={e => f('givenName', e.target.value)} placeholder="Minjun" className={INP} />
          </div>
          <div className="sm:col-span-2">
            <label className={LBL}><T k="영문 성명 (Full)" /></label>
            <input value={form.nameEn} onChange={e => f('nameEn', e.target.value)} placeholder="Minjun Kim" className={INP} />
          </div>
          <div className="sm:col-span-2">
            <label className={LBL}><T k="한글 이름 (호칭용)" /> <span className="text-gray-400"><T k="— 원어 표기가 어려울 때 접수/호출에 사용" /></span></label>
            <input value={form.koreanName} onChange={e => f('koreanName', e.target.value)} placeholder="스미스 존" className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="생년월일 *" /></label>
            <input type="date" value={form.dateOfBirth} onChange={e => f('dateOfBirth', e.target.value)} className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="성별 *" /></label>
            <select value={form.gender} onChange={e => f('gender', e.target.value)} className={INP}>
              {/* Gender enum 4종 전량(P3) — 2종만 주면 그 밖의 사실을 입력할 수 없다 */}
              <option value="MALE">{tA('남성')}</option><option value="FEMALE">{tA('여성')}</option>
              <option value="OTHER">{tA('기타')}</option><option value="UNKNOWN">{tA('미상')}</option>
            </select>
          </div>
          <div>
            <label className={LBL}><T k="국적 *" /></label>
            <select value={form.nationality} onChange={e => f('nationality', e.target.value)} className={INP}>
              {COUNTRIES.map(c => <option key={c.value} value={c.value}>{tA(c.label)} ({c.value})</option>)}
              <option value="OTHER">{tA('기타 (직접 입력)')}</option>
            </select>
            {form.nationality === 'OTHER' && (
              <input value={customNationality} onChange={e => setCustomNationality(e.target.value)}
                placeholder="ISO 3자리 코드 또는 국가명 (예: NPL)" className={`${INP} border-blue-200`} />
            )}
          </div>
          <div>
            <label className={LBL}><T k="선호 언어" /></label>
            <select value={form.preferredLanguage} onChange={e => f('preferredLanguage', e.target.value)} className={INP}>
              {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              <option value="__custom">{tA('기타 (직접 입력)')}</option>
            </select>
            {/* 🔴 조회 실패를 숨기고 폴백만 그리면 관리자가 등록한 언어판이 조용히 사라진다 */}
            {langIsError && <QueryErrorFallback error={langError} onRetry={() => refetchLang()} size="compact" className="mt-1" />}
            {form.preferredLanguage === '__custom' && (
              <input value={customLanguage} onChange={e => setCustomLanguage(e.target.value)}
                placeholder="언어 코드 또는 언어명 (예: ne, Nepali)" className={`${INP} border-blue-200`} />
            )}
            <p className="text-[10px] text-gray-400 mt-0.5">목록 관리: 관리자 &gt; 동의서 템플릿 관리 &gt; 지원 언어 관리</p>
          </div>
        </div>
      </Section>

      {/* 식별 정보 */}
      <Section n={2} title="식별 정보" Icon={IdCard}>
       <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LBL}><T k="여권번호" /></label>
            <input value={form.passportNumber} onChange={e => f('passportNumber', e.target.value)} placeholder="M12345678" className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="여권 만료일" /></label>
            <input type="date" value={form.passportExpiry} onChange={e => f('passportExpiry', e.target.value)} className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="체류자격(비자)" /></label>
            <select value={form.visaType} onChange={e => f('visaType', e.target.value)} className={INP}>
              {VISA_TYPES.map(v => <option key={v.value} value={v.value}>{tA(v.label)}</option>)}
            </select>
          </div>
          {(form.patientType === 'FOREIGN_RESIDENT' || form.patientType === 'OVERSEAS_KOREAN') && (
            <div>
              <label className={LBL}><T k="외국인등록번호" /></label>
              <input value={form.alienRegistrationNo} onChange={e => f('alienRegistrationNo', e.target.value)} placeholder="000000-0000000" className={INP} />
            </div>
          )}
          <div>
            <label className={LBL}><T k="전화번호" /></label>
            <input value={form.phone} onChange={e => f('phone', e.target.value)} placeholder="+82-10-0000-0000" className={INP} />
          </div>
          <div>
            <label className={LBL}><T k="이메일" /></label>
            <input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="name@example.com" className={INP} />
          </div>
        </div>
        <div>
          <label className={LBL}><T k="국내 체류지 (호텔/숙소 포함)" /></label>
          <input value={form.localAddress} onChange={e => f('localAddress', e.target.value)} placeholder="서울시 강남구 ○○호텔 1203호" className={INP} />
        </div>
        <div>
          <label className={LBL}><T k="비상연락처 (보호자/본국 가족)" /></label>
          <div className="grid grid-cols-1 gap-2 mt-1 sm:grid-cols-3">
            <input value={form.emergencyName} onChange={e => f('emergencyName', e.target.value)} placeholder={tA('이름@성명')} className={INP.replace('mt-1 ', '')} />
            <input value={form.emergencyRelation} onChange={e => f('emergencyRelation', e.target.value)} placeholder={tA('관계 (배우자 등)')} className={INP.replace('mt-1 ', '')} />
            <input value={form.emergencyPhone} onChange={e => f('emergencyPhone', e.target.value)} placeholder="+1-000-000-0000" className={INP.replace('mt-1 ', '')} />
          </div>
        </div>
        <div>
          <label className={LBL}><T k="서류 첨부 (여권 사본·보험증권·의뢰서 등)" /></label>
          <div className="mt-1 space-y-1.5">
            {pendingDocs.map((file, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 text-xs">
                <span className="flex-1 truncate">📄 {file.name} <span className="text-gray-400">({Math.round(file.size / 1024)}KB)</span></span>
                <button onClick={() => setPendingDocs(d => d.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">✕</button>
              </div>
            ))}
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium cursor-pointer hover:bg-gray-200">
              📎 <T k="파일 선택" /> <span className="text-gray-400">(jpeg/png/webp/pdf·10MB·등록 시 자동 업로드)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden"
                onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) setPendingDocs(d => [...d, ...files].slice(0, 20)); e.target.value = ''; }} />
            </label>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.interpreterNeeded} onChange={e => f('interpreterNeeded', e.target.checked)} className="rounded" />
          <T k="통역 서비스 필요" />
        </label>
       </div>
      </Section>
       </div>

       {/* 우측 1/3: 보험·결제 + 요약·제출 — 스크롤해도 제출이 보이게 붙인다 */}
       <div className="space-y-4 lg:sticky lg:top-4">
      {/* 보험/결제 */}
      <Section n={3} title="보험 / 결제" Icon={CreditCard}>
       <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          {INSURANCE_TYPES.map(ins => (
            <button
              key={ins.value}
              onClick={() => f('insuranceType', ins.value)}
              role="radio" aria-checked={form.insuranceType === ins.value}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                form.insuranceType === ins.value ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${form.insuranceType === ins.value ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`} aria-hidden>
                {form.insuranceType === ins.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <T k={ins.label} />
            </button>
          ))}
        </div>

        {form.insuranceType === 'TRAVEL_INSURANCE' && (
          <div className="grid grid-cols-1 gap-2 pt-2">
            <input value={form.travelInsuranceCompany} onChange={e => f('travelInsuranceCompany', e.target.value)} placeholder={tA('보험사명')} className={INP.replace('mt-1 ', '')} />
            <input value={form.travelInsurancePolicyNo} onChange={e => f('travelInsurancePolicyNo', e.target.value)} placeholder={tA('증권번호')} className={INP.replace('mt-1 ', '')} />
            <input value={form.travelInsuranceContactNo} onChange={e => f('travelInsuranceContactNo', e.target.value)} placeholder={tA('보험사 연락처')} className={INP.replace('mt-1 ', '')} />
          </div>
        )}

        {form.insuranceType === 'EMBASSY' && (
          <input value={form.embassyContact} onChange={e => f('embassyContact', e.target.value)} placeholder={tA('대사관 연락처 / 보증 정보')} className={INP.replace('mt-1 ', '')} />
        )}

        {(form.insuranceType === 'SELF_PAY' || form.insuranceType === 'DEPOSIT') && (
          <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
            ⚠️ <T k="미보험 외국인 환자는 선수금(예치금) 납부가 필요할 수 있습니다." />
          </div>
        )}
       </div>
      </Section>

      {/* 동의서·타블렛 준비 현황 — 등록 완료 시 문서별 발급/인쇄/타블렛 서명/파일첨부 */}
      <div className="space-y-2.5 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h3 className="text-sm font-semibold text-slate-800">📋 <T k="동의서" /> · 🖥 <T k="타블렛 서명" /></h3>
        <div className="text-xs text-gray-600 space-y-1">
          {templatesIsError ? (
            <QueryErrorFallback error={templatesError} onRetry={refetchTemplates} size="compact" />
          ) : (
            <p>
              <b>{languages.find(l => l.code === activeLang)?.label ?? activeLang}</b> 동의서 템플릿{' '}
              <b className="text-blue-600">{prefTemplates.length}<Unit>종</Unit></b>
              {activeLang !== 'ko' && templates.some(t => t.fallback) && (
                <span className="text-amber-600"> + 한국어 폴백 {templates.filter(t => t.fallback).length}<Unit>종</Unit></span>
              )}
            </p>
          )}
          {deviceIsError ? (
            <QueryErrorFallback error={deviceError} onRetry={() => refetchDevices()} size="compact" />
          ) : devices.length > 0 ? (
            <p>서명 타블렛 <b className="text-emerald-600">{devices.filter(d => d.online).length}대 온라인</b> / 등록 {devices.length}대</p>
          ) : (
            <p className="text-amber-600">등록된 서명 타블렛 없음 — 타블렛에서 /consent-device 접속 후 페어링 코드로 등록</p>
          )}
        </div>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          등록 완료 시 문서별로 <b>발급·인쇄</b>(개별 출력) / <b>타블렛 서명 요청</b>(전자서명) / <b>파일 첨부</b>(설명자료·스캔본 → 인쇄 별첨)가 가능합니다.
        </p>
      </div>

      {/* 등록 요약 + 제출 */}
      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-register-summary>
        <h3 className="text-sm font-semibold text-slate-800"><T k="등록 요약" /></h3>
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-2"><dt className="text-slate-400"><T k="환자 유형" /></dt><dd className="font-medium text-slate-700">{typeMeta ? <T k={typeMeta.label} /> : '-'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400"><T k="이름@성명" /></dt><dd className="truncate font-medium text-slate-700">{`${form.familyName} ${form.givenName}`.trim() || '-'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400"><T k="국적/언어" /></dt><dd className="font-medium text-slate-700">{effNationality || '-'} · {languages.find(l => l.code === effLanguage)?.label ?? (effLanguage || '-')}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-slate-400"><T k="보험 / 결제" /></dt><dd className="truncate text-right font-medium text-slate-700">{insMeta ? <T k={insMeta.label} /> : '-'}</dd></div>
          {(pendingDocs.length > 0 || form.interpreterNeeded) && (
            <div className="flex flex-wrap justify-end gap-1 pt-0.5">
              {pendingDocs.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">📎 {pendingDocs.length}</span>}
              {form.interpreterNeeded && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700"><T k="통역 서비스 필요" /></span>}
            </div>
          )}
        </dl>
        {missing.length > 0 && (
          <div className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800" data-missing-fields>
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span><T k="필수 입력" />: {missing.map((m, i) => <span key={m}>{i > 0 && ', '}<T k={m} /></span>)}</span>
          </div>
        )}
        <button
          onClick={() => submit.mutate()}
          disabled={!isValid || submit.isPending}
          className="w-full min-h-[44px] rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none"
        >
          {submit.isPending ? <T k="등록 중..." /> : <T k="외국인 환자 등록@버튼" />}
        </button>
        <button onClick={() => router.back()} className="w-full min-h-[40px] rounded-xl bg-slate-100 text-sm font-medium text-slate-600 hover:bg-slate-200"><T k="취소" /></button>
      </div>
       </div>
      </div>
      </>)}

      {/* ── 등록 목록 관리 (수정/보관/삭제) ── */}
      {view === 'list' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder={tA('이름/영문/MRN/여권번호 검색...')}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setListType('')} className={`px-3 py-1.5 text-xs rounded-lg font-medium ${listType === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k="전체" /></button>
              {PATIENT_TYPES.map(t => (
                <button key={t.value} onClick={() => setListType(t.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium ${listType === t.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={t.label} /></button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer ml-auto">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
              <T k="보관 포함" />
            </label>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-500">
                  <th className="text-left py-2.5 px-3">MRN</th>
                  <th className="text-left py-2.5 px-3"><T k="이름@성명" /></th>
                  <th className="text-left py-2.5 px-3"><T k="유형" /></th>
                  <th className="text-left py-2.5 px-3"><T k="국적/언어" /></th>
                  <th className="text-left py-2.5 px-3"><T k="여권" /></th>
                  <th className="text-center py-2.5 px-3"><T k="진료@횟수" /></th>
                  <th className="text-left py-2.5 px-3"><T k="등록일" /></th>
                  <th className="text-right py-2.5 px-3 w-56"><T k="관리" /></th>
                </tr>
              </thead>
              <tbody>
                {/* 🔴 종전엔 조회 실패가 "등록된 외국인 환자가 없습니다"로 그려졌다 */}
                {listQuery.isError ? (
                  <tr><td colSpan={8} className="p-4"><QueryErrorFallback error={listQuery.error} onRetry={() => listQuery.refetch()} /></td></tr>
                ) : listQuery.isLoading ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400"><T k="로딩 중..." /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400"><T k="등록된 외국인 환자가 없습니다" /></td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className={`border-b border-gray-50 ${!r.isActive ? 'opacity-50 bg-gray-50/50' : 'hover:bg-blue-50/30'}`}>
                    <td className="py-2.5 px-3 font-mono text-xs">{r.mrn}</td>
                    <td className="py-2.5 px-3">
                      <span className="font-medium">{r.koreanName || `${r.familyName} ${r.givenName}`}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{r.koreanName ? `${r.familyName} ${r.givenName}` : r.nameEn}</span>
                      {!r.isActive && <span className="ml-1.5 px-1.5 py-0.5 bg-gray-200 text-gray-500 text-[9px] rounded"><T k="보관됨" /></span>}
                      {r.interpreterNeeded && <span className="ml-1.5 text-[10px]" title="통역 필요">🗣</span>}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500"><T k={PATIENT_TYPES.find(t => t.value === r.patientSource)?.label ?? r.patientSource} /></td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{r.nationality} · {languages.find(l => l.code === r.preferredLanguage)?.label ?? r.preferredLanguage}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-500">
                      {r.passportNumber ?? '-'}
                      {r.passportExpiry && new Date(r.passportExpiry) < new Date() && <span className="ml-1 text-red-500 font-sans" title="여권 만료"><T k="만료" /></span>}
                    </td>
                    <td className="py-2.5 px-3 text-center text-xs text-gray-500">{r._count?.encounters ?? 0}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-400">{r.createdAt?.slice(0, 10)}</td>
                    <td className="py-2.5 px-3">
                      {/* 관리 열 — 아이콘 + 힌트. 한글 텍스트 버튼은 열 폭이 모자라 글자가 세로로 꺾였다. */}
                      <RowActions>
                        <RowAction icon={FileText} label="차트" hint="환자 차트로 이동"
                          onClick={() => router.push(`/patients/${r.id}`)} />
                        <RowAction icon={FileSignature} label="동의서" hint="발급·인쇄·타블렛 서명" tone="primary"
                          onClick={() => setRegistered({ id: r.id, mrn: r.mrn, name: `${r.familyName} ${r.givenName}`, language: r.preferredLanguage ?? 'en' })} />
                        <RowActionFile icon={Paperclip} label="서류 첨부" hint="여권 사본·보험증권 등 (jpeg/png/webp/pdf·10MB)"
                          badge={Array.isArray(r.attachments) ? r.attachments.length : 0}
                          busy={docBusy === r.id}
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onFile={async (file) => { setDocBusy(r.id); const ok = await uploadPatientDoc(r.id, file); setDocBusy(null); if (ok) { toast.success('서류 첨부 완료'); listQuery.refetch(); } }} />
                        <RowAction icon={Pencil} label="수정" hint="등록 정보 수정" tone="indigo"
                          onClick={() => openRowEdit(r)} />
                        {r.isActive ? (
                          <RowAction icon={Archive} label="보관" hint="목록에서 숨김 — 복원 가능·전체 환자 검색에는 유지" tone="amber"
                            onClick={() => archiveMut.mutate({ id: r.id })} />
                        ) : (
                          <RowAction icon={ArchiveRestore} label="복원" hint="보관을 해제하고 목록에 다시 표시" tone="emerald"
                            onClick={() => archiveMut.mutate({ id: r.id, restore: true })} />
                        )}
                        {/* 🔴 삭제 불가 건도 **숨기지 않는다** — 우측 정렬이라 버튼이 사라지면 열이 통째로
                            밀려 "무엇이 빠졌는지" 알 수 없다(실사용 질문으로 확인). 비활성 + 이유를 힌트로 준다. */}
                        {/* 🔴 권한이 없어도 같은 이유로 **숨기지 않는다** — 비활성 + 이유(서버는 `@Roles(ADMIN)`) */}
                        <RowAction icon={Trash2} label="삭제" tone="danger"
                          disabled={!canDelete || (r._count?.encounters ?? 0) > 0}
                          hint={!canDelete
                            ? '등록 삭제는 관리자 권한입니다 — 목록에서 감추려면 보관을 쓰세요'
                            : (r._count?.encounters ?? 0) > 0
                            ? `진료 기록 ${r._count?.encounters}건이 있어 삭제할 수 없습니다 — 의무기록 보존. 목록에서 감추려면 보관을 쓰세요`
                            : '임상 기록이 전혀 없는 등록 오류 건만 삭제됩니다'}
                          onClick={() => { if (confirm(`${r.familyName} ${r.givenName} (${r.mrn}) 등록을 삭제할까요?\n임상 기록이 전혀 없는 등록 오류 건만 삭제됩니다.`)) deleteMut.mutate(r.id); }} />
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400">보관=목록에서 숨김(복원 가능·전체 환자 검색에는 유지) · 삭제=임상 기록이 전혀 없는 등록 오류 건만 가능(의무기록 보존)</p>
        </div>
      )}

      {/* 수정 모달 */}
      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditRow(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4 p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900"><T k="외국인 환자 정보 수정" /></h3>
              <p className="text-xs text-gray-500 mt-0.5 font-mono">{editRow.mrn}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div><label className="text-[11px] text-gray-500"><T k="성" /></label>
                <input value={editForm2.familyName} onChange={e => setEditForm2(f2 => ({ ...f2, familyName: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div><label className="text-[11px] text-gray-500"><T k="이름@명" /></label>
                <input value={editForm2.givenName} onChange={e => setEditForm2(f2 => ({ ...f2, givenName: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div className="col-span-2"><label className="text-[11px] text-gray-500"><T k="영문 성명" /></label>
                <input value={editForm2.nameEn} onChange={e => setEditForm2(f2 => ({ ...f2, nameEn: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div className="col-span-2"><label className="text-[11px] text-gray-500"><T k="한글 이름 (호칭용)" /></label>
                <input value={editForm2.koreanName} onChange={e => setEditForm2(f2 => ({ ...f2, koreanName: e.target.value }))} placeholder="스미스 존" className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div><label className="text-[11px] text-gray-500"><T k="환자 유형" /></label>
                <select value={editForm2.patientType} onChange={e => setEditForm2(f2 => ({ ...f2, patientType: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm bg-white">
                  {PATIENT_TYPES.map(t => <option key={t.value} value={t.value}>{tA(t.label)}</option>)}
                </select></div>
              <div><label className="text-[11px] text-gray-500"><T k="국적" /></label>
                <input value={editForm2.nationality} onChange={e => setEditForm2(f2 => ({ ...f2, nationality: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div><label className="text-[11px] text-gray-500"><T k="선호 언어" /></label>
                <select value={languages.some(l => l.code === editForm2.preferredLanguage) ? editForm2.preferredLanguage : '__keep'} onChange={e => { if (e.target.value !== '__keep') setEditForm2(f2 => ({ ...f2, preferredLanguage: e.target.value })); }} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm bg-white">
                  {!languages.some(l => l.code === editForm2.preferredLanguage) && <option value="__keep">{editForm2.preferredLanguage} (직접 입력값)</option>}
                  {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select></div>
              <div><label className="text-[11px] text-gray-500"><T k="여권번호" /></label>
                <input value={editForm2.passportNumber} onChange={e => setEditForm2(f2 => ({ ...f2, passportNumber: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm font-mono" /></div>
              <div><label className="text-[11px] text-gray-500"><T k="여권 만료일" /></label>
                <input type="date" value={editForm2.passportExpiry} onChange={e => setEditForm2(f2 => ({ ...f2, passportExpiry: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div><label className="text-[11px] text-gray-500"><T k="체류자격" /></label>
                <select value={editForm2.visaType} onChange={e => setEditForm2(f2 => ({ ...f2, visaType: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm bg-white">
                  {VISA_TYPES.map(v => <option key={v.value} value={v.value}>{tA(v.label)}</option>)}
                </select></div>
              <div><label className="text-[11px] text-gray-500"><T k="전화번호" /></label>
                <input value={editForm2.phone} onChange={e => setEditForm2(f2 => ({ ...f2, phone: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div className="col-span-2"><label className="text-[11px] text-gray-500"><T k="이메일" /></label>
                <input value={editForm2.email} onChange={e => setEditForm2(f2 => ({ ...f2, email: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <div className="col-span-2"><label className="text-[11px] text-gray-500"><T k="국내 체류지" /></label>
                <input value={editForm2.localAddress} onChange={e => setEditForm2(f2 => ({ ...f2, localAddress: e.target.value }))} className="w-full mt-0.5 px-3 py-2 border rounded-xl text-sm" /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={editForm2.interpreterNeeded} onChange={e => setEditForm2(f2 => ({ ...f2, interpreterNeeded: e.target.checked }))} className="rounded" />
                <T k="통역 서비스 필요" />
              </label>
              {Array.isArray(editRow.attachments) && editRow.attachments.length > 0 && (
                <div className="col-span-2">
                  <label className="text-[11px] text-gray-500">첨부 서류 ({editRow.attachments.length})</label>
                  <div className="mt-1 space-y-1">
                    {editRow.attachments.map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 text-xs">
                        <span className="flex-1 truncate">📄 {a.fileName}</span>
                        <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 underline"><T k="열기" /></a>
                        <button onClick={async () => {
                          try { await apiClient.del(`/api/v1/patients/foreign/${editRow.id}/attachments/${i}`); toast.success('첨부 삭제'); setEditRow((r2: any) => ({ ...r2, attachments: r2.attachments.filter((_: any, j: number) => j !== i) })); listQuery.refetch(); }
                          catch { toast.error('삭제 실패'); }
                        }} className="text-red-400 hover:text-red-600"><T k="삭제" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={saveRowEdit} disabled={updateMut.isPending}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl disabled:opacity-50">{updateMut.isPending ? <T k="저장 중..." /> : <T k="저장" />}</button>
              <button onClick={() => setEditRow(null)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 등록 완료 → 언어별 동의서 개별 발급/출력 (회색 배경 클릭=닫기) */}
      {registered && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => { if (view === 'list') { setRegistered(null); setIssued({}); } else { router.push('/patients'); } }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4 p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900">동의서 발급 — {registered.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {registered.mrn && <span className="font-mono mr-2">MRN {registered.mrn}</span>}
                선호 언어 <b>{languages.find(l => l.code === registered.language)?.label ?? registered.language}</b> 템플릿 우선 · 문서별 개별 출력
              </p>
            </div>

            {deviceIsError && (
              <QueryErrorFallback error={deviceError} onRetry={() => refetchDevices()} size="compact" />
            )}
            {!deviceIsError && devices.length === 0 && (
              <div className="bg-amber-50 rounded-xl px-3 py-2 text-[11px] text-amber-700">
                🖥 등록된 서명 타블렛이 없어 전자서명 전송을 사용할 수 없습니다 — 타블렛에서 <b>/consent-device</b> 접속 후 페어링 코드로 등록·승인하세요. (인쇄·첨부는 사용 가능)
              </div>
            )}
            {devices.length > 0 && (
              <div className="flex items-center gap-2 bg-indigo-50/60 rounded-xl px-3 py-2">
                <span className="text-xs font-medium text-indigo-700 shrink-0">🖥 서명 타블렛</span>
                <select value={deviceId} onChange={e => setSelectedDevice(e.target.value)} className="flex-1 border rounded-lg px-2 py-1.5 text-xs bg-white">
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.location ? ` (${d.location})` : ''} — {d.online ? (d.status === 'IDLE' ? '대기' : '사용중') : '오프라인'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {templatesIsError ? (
              <QueryErrorFallback error={templatesError} onRetry={refetchTemplates} />
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                활성 동의서 템플릿이 없습니다.<br />
                <span className="text-xs">관리자 &gt; 동의서 템플릿 관리에서 언어판을 등록하세요.</span>
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className={`flex items-center justify-between border rounded-xl px-3 py-2.5 ${t.fallback ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {t.type} · v{t.version} ·{' '}
                        {t.fallback
                          ? <span className="text-amber-600 font-medium">한국어판 폴백 — {registered.language} 언어판 미등록</span>
                          : <span className="text-emerald-600 font-medium">{languages.find(l => l.code === t.language)?.label ?? t.language}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {issued[t.id] ? (
                        <>
                          <button onClick={() => window.open(`/print/consent/${issued[t.id]}`, '_blank')}
                            className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium"><T k="재인쇄" /></button>
                          {deviceId && (
                            <button onClick={() => dispatchTablet.mutate(issued[t.id])} disabled={dispatchTablet.isPending}
                              title="선택한 타블렛으로 서명 요청 전송"
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">🖥 <T k="타블렛 서명" /></button>
                          )}
                          <label title="설명자료·스캔본 첨부 — 인쇄 시 별첨 포함"
                            className="px-2.5 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium cursor-pointer hover:bg-gray-200">
                            {attachBusy === issued[t.id] ? '…' : `📎${attachCounts[issued[t.id]] ? ` ${attachCounts[issued[t.id]]}` : ''}`}
                            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                              disabled={attachBusy === issued[t.id]}
                              onChange={e => { const file = e.target.files?.[0]; if (file) uploadAttachment(issued[t.id], file); e.target.value = ''; }} />
                          </label>
                        </>
                      ) : (
                        <button onClick={() => issueConsent.mutate(t)} disabled={issueConsent.isPending}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"><T k="발급·인쇄" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => router.push(`/patients/${registered.id}`)}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl"><T k="환자 차트로 이동" /></button>
              <button onClick={() => { if (view === 'list') { setRegistered(null); setIssued({}); } else { router.push('/patients'); } }}
                className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl">{view === 'list' ? <T k="닫기" /> : <T k="완료@버튼" />}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
