'use client';

import { ApprovalRecordNotice } from '@/components/governance/ApprovalRecordNotice';
import { CatalogAgendaPanel } from '@/components/governance/CatalogAgendaPanel';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { money } from '@/lib/ui-settings';

import { EmptyState, Money, Unit } from '@/components/ui/display';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { activationNotices, editModeHint, editResultNotice } from '@/components/governance/catalog-lifecycle-feedback';
import { FormularyChip, FormularySummary, useFormularyStatus } from '@/components/formulary/FormularyChip';

// ── Constants ──

const CATEGORIES = [
  { value: '', label: '전체' },
  { value: 'DISEASE', label: '질환별' },
  { value: 'SURGERY_PRE', label: '수술 전' },
  { value: 'PROCEDURE', label: '시술/수술 후' },
  { value: 'ADMISSION', label: '입원 시' },
  { value: 'CUSTOM', label: '사용자 정의' },
];

const STATUSES = [
  { value: '', label: '전체 상태' },
  { value: 'DRAFT', label: '초안' },
  { value: 'PENDING_APPROVAL', label: '승인대기' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'ACTIVE', label: '활성' },
  // 🔴 `폐기` 는 앞 카탈로그에서 "Disposed"(물품 폐기)라 오더세트 **상태**와 뜻이 다르다 → 문맥 키
  { value: 'DEPRECATED', label: '폐기@상태' },
];

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  ACTIVE: 'bg-blue-100 text-blue-700',
  DEPRECATED: 'bg-red-100 text-red-700',
};

const CAT_COLOR: Record<string, string> = {
  DISEASE: 'bg-blue-50 text-blue-700',
  SURGERY_PRE: 'bg-red-50 text-red-700',
  PROCEDURE: 'bg-amber-50 text-amber-700',
  ADMISSION: 'bg-emerald-50 text-emerald-700',
  CUSTOM: 'bg-purple-50 text-purple-700',
};

const TYPE_ICON: Record<string, string> = { MEDICATION: '💊', LAB: '🔬', IMAGING: '📷', THERAPY: '🩹', DIET: '🍚', ACTIVITY: '🚶', NURSING: '🩺', ORDER: '📋', DOCUMENT: '📄' };
// 서류(증명서) 유형 — 진단서 워크스테이션(의료법 §17 담당의 발급)과 동일 코드
const CERT_TYPES: Record<string, string> = { DIAGNOSIS_CERT: '진단서', OPINION: '소견서', ADMISSION_CERT: '입퇴원확인서' };

const ITEM_TYPES = ['MEDICATION', 'LAB', 'IMAGING', 'THERAPY', 'DIET', 'ACTIVITY', 'NURSING', 'ORDER', 'DOCUMENT'];
const APPLICABLE_OPTIONS = ['ADMISSION', 'DISEASE', 'PRE_OP', 'POST_OP', 'DISCHARGE'];
const EVIDENCE_LEVELS = ['A', 'B', 'C', 'D'];

// 코드 해석 필수 유형 — 미해석 항목은 적용 시 처방 미생성(유령)이라 ACTIVE 승격이 차단됨(BE 게이트와 동일 규칙)
const CODE_REQUIRED_TYPES = new Set(['MEDICATION', 'LAB', 'IMAGING', 'THERAPY']);
const isUnresolvedItem = (it: OrderSetItem) =>
  CODE_REQUIRED_TYPES.has(it.type) && !it.medicationCodeId && !it.procedureCodeId;
const unresolvedCountOf = (items: OrderSetItem[] | undefined) => (items ?? []).filter(isUnresolvedItem).length;

// ── Types ──

interface OrderSetItem {
  type: string;
  name: string;
  code?: string;
  medicationCodeId?: string; // 적용 시 실 처방 생성용(빌더에서 약품 선택 시 저장)
  procedureCodeId?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  certType?: string; // DOCUMENT 항목: DIAGNOSIS_CERT | OPINION | ADMISSION_CERT
  required?: boolean; // 필수 항목 — 적용 모달에서 해제 불가
  isDefault?: boolean; // 기본형 — 적용 모달에서 자동 체크
  cdssCheck?: boolean; // CDSS 검증 대상
}

interface OrderSet {
  id: string;
  name: string;
  code?: string;
  department?: string;
  category: string;
  diagnosisCode?: string;
  description?: string;
  items: OrderSetItem[];
  status: string;
  /** 승인자 — 승인 단계를 거치지 않으면 비어 있다 */
  approvedBy?: string | null;
  version: number;
  useCount: number;
  applicableTo?: string;
  ageGroup?: string;
  contraindications?: Array<{ note?: string }>;
  evidenceLevel?: string;
  guidelineRef?: string;
  createdAt: string;
}

interface FormState {
  name: string;
  code: string;
  category: string;
  department: string;
  diagnosisCode: string;
  description: string;
  applicableTo: string;
  ageGroup: string;
  contraindications: string; // 줄바꿈 구분 금기 메모(저장 시 배열로 변환)
  evidenceLevel: string;
  guidelineRef: string;
  items: OrderSetItem[];
}

const AGE_GROUP_OPTIONS = [
  { v: '', l: '전연령' },
  { v: 'ADULT', l: '성인' },
  { v: 'PEDIATRIC', l: '소아' },
  { v: 'GERIATRIC', l: '노인' },
];

const emptyForm: FormState = {
  name: '', code: '', category: 'DISEASE', department: '', diagnosisCode: '',
  description: '', applicableTo: '', ageGroup: '', contraindications: '', evidenceLevel: '', guidelineRef: '',
  items: [{ type: 'MEDICATION', name: '', dosage: '', frequency: '', instructions: '' }],
};

// ── Stats Section ──

function StatsSection({ orderSets }: { orderSets: OrderSet[] }) {
  const total = orderSets.length;
  const byStatus = STATUSES.filter(s => s.value).map(s => ({
    label: s.label,
    count: orderSets.filter(os => os.status === s.value).length,
    color: STATUS_COLOR[s.value] ?? 'bg-gray-100 text-gray-600',
  }));
  const topUsed = [...orderSets].sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0)).slice(0, 5);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded-xl border p-4">
        <p className="text-xs text-gray-400 mb-2"><T k="전체 CP 수" /></p>
        <p className="text-3xl font-bold text-gray-900">{total}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {byStatus.map(s => (
            <span key={s.label} className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${s.color}`}>
              <T k={s.label} /> {s.count}
            </span>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl border p-4 col-span-2">
        <p className="text-xs text-gray-400 mb-2"><T k="가장 많이 사용된 CP (Top 5)" /></p>
        {topUsed.length === 0 ? (
          <p className="text-sm text-gray-400"><T k="사용 기록 없음" /></p>
        ) : (
          <div className="space-y-1.5">
            {topUsed.map((os, i) => (
              <div key={os.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                <span className="text-gray-900 flex-1 truncate">{os.name}</span>
                <span className="text-indigo-600 font-medium whitespace-nowrap">{os.useCount ?? 0}<Unit><T k="회" /></Unit></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drug Autocomplete Hook ──

function useMedicationSearch(query: string) {
  return useQuery({
    queryKey: ['medication-search', query],
    queryFn: () => apiClient.get<{ data: { name: string; dosage?: string }[] }>(
      '/api/v1/codes/medication', { q: query },
    ),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}

// ── Medication Name Input with Autocomplete ──

function MedicationNameInput({
  value,
  onChange,
  onSelectMed,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelectMed: (name: string, dosage?: string, medicationCodeId?: string, code?: string) => void;
}) {
  const tAttr = useTAttr();
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data } = useMedicationSearch(query);
  const medsRaw = data?.data;
  const meds: { id?: string; name: string; dosage?: string; code?: string }[] = Array.isArray(medsRaw)
    ? medsRaw
    : ((medsRaw as unknown as Record<string, unknown>)?.data as { id?: string; name: string; dosage?: string; code?: string }[] | undefined) ?? [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInput = (v: string) => {
    onChange(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setQuery(v);
      setShowDropdown(v.length >= 2);
    }, 300);
  };

  return (
    <div ref={wrapperRef} className="relative col-span-2">
      <input value={value} onChange={e => handleInput(e.target.value)}
        onFocus={() => { if (value.length >= 2) setShowDropdown(true); }}
        placeholder={tAttr('약품명 검색')} className="text-xs border rounded px-2 py-1.5 w-full" />
      {showDropdown && meds.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {meds.map((med, i) => (
            <button key={i} type="button"
              onClick={() => { onSelectMed(med.name, med.dosage, med.id, med.code); setShowDropdown(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 truncate">
              <span className="font-medium">{med.name}</span>
              {med.dosage && <span className="text-gray-400 ml-1">{med.dosage}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CDSS Check Result type ──

interface CdssResult {
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  message: string;
}

const CDSS_BADGE: Record<string, string> = {
  PASS: 'bg-green-100 text-green-700',
  INFO: 'bg-slate-100 text-slate-700',
  WARNING: 'bg-amber-100 text-amber-700',
  ERROR: 'bg-red-100 text-red-700',
};

// ── Item Editor ──

function ItemsEditor({ items, onChange }: { items: OrderSetItem[]; onChange: (items: OrderSetItem[]) => void }) {
  const tAttr = useTAttr();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cdssResults, setCdssResults] = useState<CdssResult[] | null>(null);
  const [cdssLoading, setCdssLoading] = useState(false);

  const addItem = () => onChange([...items, { type: 'MEDICATION', name: '', dosage: '', frequency: '', instructions: '' }]);
  const removeItem = (idx: number) => { onChange(items.filter((_, i) => i !== idx)); setCdssResults(null); };
  const updateItem = (idx: number, field: string, value: string) => {
    const updated = items.map((item, i) => i === idx ? { ...item, [field]: value } : item);
    onChange(updated);
    setCdssResults(null);
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...items];
    [updated[dragIdx], updated[idx]] = [updated[idx], updated[dragIdx]];
    onChange(updated);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const hasMedications = items.some(it => it.type === 'MEDICATION');
  // 원내 처방집 상태(처방 게이트와 같은 판정 · 2026-10-21 P4) — 약은 약품 코드, 검사·영상은 행위 코드
  const fDomain = (it: OrderSetItem) => (it.type === 'MEDICATION' ? 'MEDICATION' : it.type === 'LAB' ? 'LAB' : it.type === 'IMAGING' ? 'IMAGING' : null);
  const fCode = (it: OrderSetItem) => (it.type === 'MEDICATION' ? it.medicationCodeId : it.procedureCodeId);
  const formulary = useFormularyStatus(items.map((it) => ({ domain: fDomain(it), codeId: fCode(it) })));

  const runCdssCheck = async () => {
    setCdssLoading(true);
    try {
      /**
       * 🔴 종전엔 `/api/v1/cdss/check` 에 `{medications:[…]}` 를 보냈다. 그 EP 는 **환자 1명 +
       *    약물 1건** 구조에 `patientId` 가 필수라, 전역 whitelist 가 `medications` 를 지우고
       *    필수 필드 부재로 **항상 400** 이었다 — 이 버튼은 개통 이래 "CDSS 검증 실패"만 냈다.
       *    처방세트는 환자가 없는 템플릿이므로 환자 비의존 검사 전용 EP 를 부른다.
       *    보내는 키는 서버 DTO 이름 그대로 명시한다(스프레드 금지 — 폼 키가 섞이면 지워진다).
       */
      const medications = items
        .filter(it => it.type === 'MEDICATION')
        .map(it => ({ medicationCodeId: it.medicationCodeId, name: it.name }));
      const res = await apiClient.post<{ data: { checks?: CdssResult[] } }>('/api/v1/cdss/check-order-set', { medications });
      const payload = res?.data as { checks?: CdssResult[] } | undefined;
      // 서버 응답은 `{level, passedChecks, totalChecks, checks[]}` — 배지는 checks 를 그린다.
      setCdssResults(payload?.checks ?? []);
    } catch (e: unknown) {
      // 🔴 실패를 빈 결과로 바꾸지 않는다 — 빈 배지 줄은 "경고 없음"으로 읽힌다.
      setCdssResults(null);
      toast.error((e as { message?: string })?.message ?? tAttr('CDSS 검증 실패'));
    } finally {
      setCdssLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700"><T k="처방 항목" /></h3>
        <div className="flex items-center gap-2">
          {items.length > 0 && hasMedications && (
            <button type="button" onClick={runCdssCheck} disabled={cdssLoading}
              className="text-xs px-3 py-1 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap">
              {cdssLoading ? <T k="검증 중..." /> : <T k="CDSS 검증" />}
            </button>
          )}
          <button type="button" onClick={addItem} className="text-xs px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
            <T k="+ 항목 추가" />
          </button>
        </div>
      </div>
      <FormularySummary counts={formulary.counts} />

      {/* CDSS Results */}
      {cdssResults && cdssResults.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 rounded-lg border">
          {cdssResults.map((r, i) => (
            <span key={i} className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${CDSS_BADGE[r.level] ?? 'bg-gray-100 text-gray-600'}`}>
              {r.level === 'PASS' ? '✓' : r.level === 'INFO' ? 'ⓘ' : r.level === 'WARNING' ? '⚠' : '✕'} {r.message}
            </span>
          ))}
        </div>
      )}

      {items.map((item, idx) => (
        <div key={idx}
          draggable
          onDragStart={() => handleDragStart(idx)}
          onDragOver={e => handleDragOver(e, idx)}
          onDragEnd={handleDragEnd}
          className={`border rounded-lg p-3 bg-gray-50/50 space-y-2 ${dragIdx === idx ? 'opacity-50 border-indigo-300' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="cursor-grab active:cursor-grabbing text-gray-400 select-none text-sm" title={tAttr('드래그하여 순서 변경')}>☰</span>
            <span className="text-xs text-gray-400 w-5">{idx + 1}.</span>
            <select value={item.type} onChange={e => updateItem(idx, 'type', e.target.value)}
              className="text-xs border rounded px-2 py-1 bg-white">
              {ITEM_TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>)}
            </select>
            <div className="flex-1" />
            <button type="button" onClick={() => removeItem(idx)}
              className="text-red-400 hover:text-red-600 text-xs">✕</button>
          </div>
          {item.type === 'DOCUMENT' ? (
            <div className="grid grid-cols-2 gap-2">
              <select value={item.certType ?? 'DIAGNOSIS_CERT'} onChange={e => updateItem(idx, 'certType', e.target.value)}
                className="text-xs border rounded px-2 py-1.5 bg-white">
                {Object.entries(CERT_TYPES).map(([k, label]) => <option key={k} value={k}>📄 {tAttr(label)}</option>)}
              </select>
              <input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
                placeholder={tAttr('서류명(예: 진단서 — 발급 목적)')} className="text-xs border rounded px-2 py-1.5" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {item.type === 'MEDICATION' ? (
                  <MedicationNameInput
                    value={item.name}
                    onChange={v => updateItem(idx, 'name', v)}
                    onSelectMed={(name, dosage, medicationCodeId, code) => {
                      const updated = items.map((it, i) => i === idx
                        ? { ...it, name, dosage: dosage ?? it.dosage, medicationCodeId: medicationCodeId ?? it.medicationCodeId, code: code ?? it.code }
                        : it);
                      onChange(updated);
                      setCdssResults(null);
                    }}
                  />
                ) : (
                  <input value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)}
                    placeholder={tAttr('항목명')} className="text-xs border rounded px-2 py-1.5 col-span-2" />
                )}
                <input value={item.dosage ?? ''} onChange={e => updateItem(idx, 'dosage', e.target.value)}
                  placeholder={tAttr('용법/용량')} className="text-xs border rounded px-2 py-1.5" />
                <input value={item.frequency ?? ''} onChange={e => updateItem(idx, 'frequency', e.target.value)}
                  placeholder={tAttr('횟수@용법')} className="text-xs border rounded px-2 py-1.5" />
              </div>
              <input value={item.instructions ?? ''} onChange={e => updateItem(idx, 'instructions', e.target.value)}
                placeholder={tAttr('비고/지시사항')} className="text-xs border rounded px-2 py-1.5 w-full" />
              <div className="flex items-center gap-3 text-[11px] text-gray-600">
                <label className="flex items-center gap-1 cursor-pointer" title={tAttr('적용 검토 모달에서 자동 체크되는 기본형 항목')}>
                  <input type="checkbox" checked={!!item.isDefault} onChange={e => onChange(items.map((it, i) => i === idx ? { ...it, isDefault: e.target.checked } : it))} /> <T k="기본형" />
                </label>
                <label className="flex items-center gap-1 cursor-pointer" title={tAttr('적용 검토 모달에서 해제 불가(임상 필수)')}>
                  <input type="checkbox" checked={!!item.required} onChange={e => onChange(items.map((it, i) => i === idx ? { ...it, required: e.target.checked } : it))} /> <T k="필수" />
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={!!item.cdssCheck} onChange={e => onChange(items.map((it, i) => i === idx ? { ...it, cdssCheck: e.target.checked } : it))} /> <T k="CDSS 검증" />
                </label>
                <FormularyChip r={formulary.lookup(fDomain(item), fCode(item))} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Builder Form (Create / Edit) ──

function BuilderForm({
  initialData,
  editId,
  editStatus,
  onClose,
  onSaved,
}: {
  initialData?: FormState;
  editId?: string;
  /** 편집 중인 세트의 상태 — 저장이 무엇을 일으키는지 미리 말한다(사용 중 = 새 판) */
  editStatus?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const hint = editModeHint(editStatus);
  const [form, setForm] = useState<FormState>(initialData ?? { ...emptyForm });
  const isEdit = !!editId;

  // 저장 payload — contraindications 문자열(줄바꿈)→배열, 빈 ageGroup 생략
  const toPayload = (data: FormState) => ({
    ...data,
    ageGroup: data.ageGroup || undefined,
    contraindications: data.contraindications.trim()
      ? data.contraindications.split('\n').map(s => s.trim()).filter(Boolean).map(note => ({ note }))
      : undefined,
  });

  const createMut = useMutation({
    mutationFn: (data: FormState) => apiClient.post('/api/v1/order-sets', toPayload(data)),
    onSuccess: () => { toast.success(tAttr('약속처방이 생성되었습니다')); onSaved(); },
    onError: () => toast.error(tAttr('생성 실패')),
  });

  const updateMut = useMutation({
    mutationFn: (data: FormState) => apiClient.put(`/api/v1/order-sets/${editId}`, toPayload(data)),
    onSuccess: (r) => {
      const n = editResultNotice(r);
      if (n) toast.success(tfAttr(n.k, n.params ?? {})); else toast.success(tAttr('약속처방이 수정되었습니다'));
      onSaved();
    },
    // 서버 사유(열린 새 판 초안이 있음·이름 중복 등)를 그대로 — 종전엔 "수정 실패" 한 마디였다
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('수정 실패')),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error(tAttr('이름을 입력해주세요')); return; }
    if (form.items.length === 0) { toast.error(tAttr('항목을 최소 1개 추가해주세요')); return; }
    if (isEdit) updateMut.mutate(form);
    else createMut.mutate(form);
  };

  const setField = (field: keyof FormState, value: string) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/30">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? <T k="약속처방 수정" /> : <T k="약속처방 생성" />}</h2>
          {hint && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-900" data-edit-mode-hint><T k={hint} /></p>}
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="CP 코드" /></span>
            <input value={form.code} onChange={e => setField('code', e.target.value)}
              placeholder={tAttr('자동생성')} className="w-full text-sm border rounded-lg px-3 py-2" />
          </label>
          <label className="space-y-1 col-span-2">
            <span className="text-xs text-gray-500"><T k="이름 *@항목" /></span>
            <input value={form.name} onChange={e => setField('name', e.target.value)}
              placeholder={tAttr('약속처방 이름')} className="w-full text-sm border rounded-lg px-3 py-2" required />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="카테고리 *" /></span>
            <select value={form.category} onChange={e => setField('category', e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white">
              {CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{tAttr(c.label)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="진료과" /></span>
            <input value={form.department} onChange={e => setField('department', e.target.value)}
              placeholder={tAttr('예: 내과')} className="w-full text-sm border rounded-lg px-3 py-2" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="진단코드" /></span>
            <input value={form.diagnosisCode} onChange={e => setField('diagnosisCode', e.target.value)}
              placeholder={tAttr('예: I10')} className="w-full text-sm border rounded-lg px-3 py-2" />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-gray-500"><T k="설명" /></span>
          <textarea value={form.description} onChange={e => setField('description', e.target.value)}
            rows={2} placeholder={tAttr('약속처방 상세 설명')} className="w-full text-sm border rounded-lg px-3 py-2" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-gray-500"><T k="금기 조건" /> <span className="text-gray-400"><T k="(한 줄에 하나 — 적용 시 경고 표시)" /></span></span>
          <textarea value={form.contraindications} onChange={e => setField('contraindications', e.target.value)}
            rows={2} placeholder="예: 임신부 금기&#10;신부전 환자 주의" className="w-full text-sm border rounded-lg px-3 py-2" />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="적용 시점" /></span>
            <select value={form.applicableTo} onChange={e => setField('applicableTo', e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white">
              <option value="">{tAttr('선택')}</option>
              {APPLICABLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="대상 연령군" /></span>
            <select value={form.ageGroup} onChange={e => setField('ageGroup', e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white">
              {AGE_GROUP_OPTIONS.map(o => <option key={o.v} value={o.v}>{tAttr(o.l)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="근거 수준" /></span>
            <select value={form.evidenceLevel} onChange={e => setField('evidenceLevel', e.target.value)}
              className="w-full text-sm border rounded-lg px-3 py-2 bg-white">
              <option value="">{tAttr('선택')}</option>
              {EVIDENCE_LEVELS.map(l => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500"><T k="가이드라인 참조" /></span>
            <input value={form.guidelineRef} onChange={e => setField('guidelineRef', e.target.value)}
              placeholder={tAttr('URL 또는 문헌')} className="w-full text-sm border rounded-lg px-3 py-2" />
          </label>
        </div>

        <ItemsEditor items={form.items} onChange={items => setForm(f => ({ ...f, items }))} />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
            <T k="취소" />
          </button>
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {createMut.isPending || updateMut.isPending ? <T k="저장 중..." /> : isEdit ? <T k="수정@동작" /> : <T k="생성 (초안)" />}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Page ──

// ── 진단 매핑 편집 (추천 엔진 v2 — EXACT/PREFIX·PRIMARY_ONLY·weight) ──

interface DxMapping { diagnosisCode: string; matchType: string; role: string; weight: number }

function DiagnosisMappingModal({ orderSet, onClose, onSaved }: { orderSet: OrderSet; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const [rows, setRows] = useState<DxMapping[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get<{ data: DxMapping[] }>(`/api/v1/order-sets/${orderSet.id}/diagnoses`)
      .then(res => {
        const raw = res.data as unknown;
        const list = (Array.isArray(raw) ? raw : (raw as { data?: DxMapping[] })?.data ?? []) as DxMapping[];
        // 매핑이 비어있고 레거시 단일 코드가 있으면 초기값으로 제안
        setRows(list.length ? list : orderSet.diagnosisCode ? [{ diagnosisCode: orderSet.diagnosisCode, matchType: 'EXACT', role: 'ANY', weight: 100 }] : []);
      })
      .catch(() => { toast.error(tAttr('매핑 조회 실패')); setRows([]); });
  }, [orderSet.id, orderSet.diagnosisCode]);

  const update = (i: number, patch: Partial<DxMapping>) =>
    setRows(prev => (prev ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/api/v1/order-sets/${orderSet.id}/diagnoses`, { diagnoses: rows ?? [] });
      toast.success(tAttr('진단 매핑을 저장했습니다'));
      onSaved();
    } catch { toast.error(tAttr('저장 실패')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="진단 매핑" /> — {orderSet.name}</h3>
          <p className="text-[11px] text-gray-400 mt-1"><T k="추천 엔진: EXACT=완전일치 / PREFIX=상위분류(E11 → E11.*) · 주상병한정=주상병일 때만 추천 · 가중치=정렬 우선순위" /></p>
        </div>
        {rows === null ? (
          <div className="py-6 text-center text-sm text-gray-400"><T k="조회 중..." /></div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={r.diagnosisCode} onChange={e => update(i, { diagnosisCode: e.target.value.toUpperCase() })}
                  placeholder={tAttr('KCD 코드/prefix')} className="w-28 text-xs border rounded px-2 py-1.5 font-mono" />
                <select value={r.matchType} onChange={e => update(i, { matchType: e.target.value })} className="text-xs border rounded px-1.5 py-1.5 bg-white">
                  <option value="EXACT">{tAttr('완전일치')}</option>
                  <option value="PREFIX">{tAttr('상위분류')}</option>
                </select>
                <select value={r.role} onChange={e => update(i, { role: e.target.value })} className="text-xs border rounded px-1.5 py-1.5 bg-white">
                  <option value="ANY">{tAttr('주/부상병')}</option>
                  <option value="PRIMARY_ONLY">{tAttr('주상병한정')}</option>
                </select>
                <input type="number" value={r.weight} onChange={e => update(i, { weight: Number(e.target.value) || 100 })}
                  className="w-16 text-xs border rounded px-2 py-1.5" title={tAttr('가중치(1~1000)')} />
                <button onClick={() => setRows(prev => (prev ?? []).filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
              </div>
            ))}
            <button onClick={() => setRows(prev => [...(prev ?? []), { diagnosisCode: '', matchType: 'EXACT', role: 'ANY', weight: 100 }])}
              className="text-xs px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100"><T k="+ 매핑 추가" /></button>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={save} disabled={saving || rows === null}
            className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <T k="저장 중..." /> : <T k="저장" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 미해석 항목 해석 콘솔 — 자동 후보 조회(BE) 후 사람이 확정 ──

interface ResolveCandidate { id: string; code: string; nameKo: string; dosageForm?: string; unitPrice?: number | string; codeField: 'medicationCodeId' | 'procedureCodeId' }
interface ResolveRow { index: number; type: string; name: string; candidates: ResolveCandidate[] }

function ResolveModal({ orderSet, onClose, onSaved }: { orderSet: OrderSet; onClose: () => void; onSaved: () => void }) {
  const tAttr = useTAttr();
  const [rows, setRows] = useState<ResolveRow[] | null>(null);
  const [selected, setSelected] = useState<Record<number, ResolveCandidate>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.post<{ data: { items: ResolveRow[] } }>(`/api/v1/order-sets/${orderSet.id}/resolve-items`)
      .then(res => {
        const d = (res.data as { items?: ResolveRow[]; data?: { items: ResolveRow[] } });
        setRows(d.items ?? d.data?.items ?? []);
      })
      .catch(() => { toast.error(tAttr('후보 조회 실패')); setRows([]); });
  }, [orderSet.id]);

  const apply = async () => {
    const picks = Object.entries(selected);
    if (!picks.length) { toast.error(tAttr('확정할 후보를 선택하세요')); return; }
    setSaving(true);
    try {
      const newItems = (orderSet.items ?? []).map((it, i) => {
        const cand = selected[i];
        if (!cand) return it;
        return { ...it, [cand.codeField]: cand.id, code: cand.code };
      });
      await apiClient.put(`/api/v1/order-sets/${orderSet.id}`, { items: newItems });
      toast.success(`${picks.length}건 해석 확정`);
      onSaved();
    } catch { toast.error(tAttr('저장 실패')); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-bold text-gray-900"><T k="미해석 항목 코드 해석" /> — {orderSet.name}</h3>
          <p className="text-xs text-gray-500 mt-1"><T k="이름 기반 자동 후보입니다. 확정은 반드시 사람이 검토 후 선택하세요. (미해석 항목은 적용 시 처방이 생성되지 않으며 활성화가 차단됩니다)" /></p>
        </div>
        {rows === null ? (
          <div className="py-8 text-center text-sm text-gray-400"><T k="후보 조회 중..." /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="미해석 항목이 없습니다" />
        ) : rows.map(row => (
          <div key={row.index} className="border border-gray-100 rounded-xl p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-900">
              {TYPE_ICON[row.type] ?? '📋'} {row.name}
              <span className="ml-2 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded"><T k="미해석" /></span>
            </p>
            {row.candidates.length === 0 ? (
              <p className="text-xs text-amber-600"><T k="자동 후보 없음 — 수정 화면에서 직접 코드를 검색해 지정하세요" /></p>
            ) : row.candidates.map(c => (
              <label key={c.id} className={`flex items-center gap-2 text-xs p-2 rounded-lg cursor-pointer border ${selected[row.index]?.id === c.id ? 'border-indigo-400 bg-indigo-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <input type="radio" name={`resolve-${row.index}`} checked={selected[row.index]?.id === c.id}
                  onChange={() => setSelected(prev => ({ ...prev, [row.index]: c }))} />
                <span className="font-mono text-gray-500">{c.code}</span>
                <span className="font-medium text-gray-900">{c.nameKo}</span>
                {c.dosageForm && <span className="text-gray-400">{c.dosageForm}</span>}
                {c.unitPrice != null && <span className="ml-auto text-gray-400"><Money value={Number(c.unitPrice)} /></span>}
              </label>
            ))}
          </div>
        ))}
        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="닫기" /></button>
          <button onClick={apply} disabled={saving || !Object.keys(selected).length}
            className="px-4 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <T k="저장 중..." /> : `선택 ${Object.keys(selected).length}건 확정`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderSetsPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const canWrite = useAdminWrite();
  const qc = useQueryClient();
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showBuilder, setShowBuilder] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; status?: string; data: FormState } | null>(null);
  const [resolveTarget, setResolveTarget] = useState<OrderSet | null>(null);
  const [dxTarget, setDxTarget] = useState<OrderSet | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order-sets', catFilter, statusFilter],
    queryFn: () => apiClient.get<{ data: OrderSet[] }>('/api/v1/order-sets', {
      category: catFilter || undefined,
      status: statusFilter || undefined,
    }),
  });

  const cloneMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/order-sets/${id}/clone`),
    onSuccess: () => { toast.success(tAttr('복제되었습니다')); qc.invalidateQueries({ queryKey: ['order-sets'] }); },
    onError: () => toast.error(tAttr('복제 실패')),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/api/v1/order-sets/${id}/status`, { status }),
    onSuccess: (r) => {
      toast.success(tAttr('상태가 변경되었습니다'));
      // 사용 중으로 — 이전 판 폐기·이전 판을 가리키는 임상경로 수(2026-10-21 P2)
      for (const n of activationNotices(r)) toast.warning(tfAttr(n.k, n.params ?? {}));
      qc.invalidateQueries({ queryKey: ['order-sets'] });
    },
    // 승격 게이트 메시지(미해석 N건 등)를 그대로 노출
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('상태 변경 실패')),
  });

  const deprecateMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/order-sets/${id}/deprecate`),
    onSuccess: () => { toast.success(tAttr('폐기되었습니다')); qc.invalidateQueries({ queryKey: ['order-sets'] }); },
    onError: () => toast.error(tAttr('폐기 실패')),
  });

  const _orderSetsRaw = data?.data;
  const orderSets: OrderSet[] = Array.isArray(_orderSetsRaw)
    ? _orderSetsRaw
    : ((_orderSetsRaw as unknown as Record<string, unknown>)?.data as OrderSet[] | undefined) ?? [];

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const openEdit = (os: OrderSet) => {
    setEditTarget({
      id: os.id,
      status: os.status,
      data: {
        name: os.name,
        code: os.code ?? '',
        category: os.category,
        department: os.department ?? '',
        diagnosisCode: os.diagnosisCode ?? '',
        description: os.description ?? '',
        applicableTo: os.applicableTo ?? '',
        ageGroup: os.ageGroup ?? '',
        contraindications: Array.isArray(os.contraindications) ? os.contraindications.map(c => c?.note ?? '').filter(Boolean).join('\n') : '',
        evidenceLevel: os.evidenceLevel ?? '',
        guidelineRef: os.guidelineRef ?? '',
        items: os.items ?? [],
      },
    });
  };

  const handleSaved = () => {
    setShowBuilder(false);
    setEditTarget(null);
    qc.invalidateQueries({ queryKey: ['order-sets'] });
  };

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="약속처방 관리 (CP / Order Set)" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="질환별/수술전/입원시 표준 처방 묶음 관리" /></p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const diagnosis = window.prompt(tAttr('AI 초안 생성 — 질환명을 입력하세요 (예: 제2형 당뇨병)'));
              if (!diagnosis?.trim()) return;
              const diagnosisCode = window.prompt(tAttr('KCD 진단코드 (선택 — 예: E11.9)')) ?? undefined;
              try {
                const res = await apiClient.post<{ data: { name: string; itemCount: number } }>('/api/v1/ai/order-set-draft',
                  { diagnosis: diagnosis.trim(), ...(diagnosisCode?.trim() ? { diagnosisCode: diagnosisCode.trim() } : {}) });
                toast.success(`AI 초안 생성: ${res.data.name} (${res.data.itemCount}항목·미해석) — 해석 콘솔에서 코드 확정 후 승인하세요`);
                qc.invalidateQueries({ queryKey: ['order-sets'] });
              } catch (e) { toast.error((e as { message?: string })?.message || tAttr('AI 초안 생성 실패')); }
            }}
            className="px-4 py-2 text-sm font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100"
            title={tAttr('AI가 DRAFT 초안 생성 — 코드 해석·승인은 사람')}>
            ✨ <T k="AI 초안" />
          </button>
          <button onClick={() => setShowBuilder(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm">
            <T k="+ 생성" />
          </button>
        </div>
      </div>

      {/* 사용 중인데 승인 기록이 없는 세트(임상 규칙 교차검증 R4) */}
      <ApprovalRecordNotice items={data ? orderSets : undefined} what={<T k="약속처방" />} recordPath={(id) => `/api/v1/order-sets/${id}/approval-record`} onRecorded={() => qc.invalidateQueries({ queryKey: ['order-sets'] })} />
      <CatalogAgendaPanel items={data ? orderSets : undefined} />

      {/* Stats */}
      <StatsSection orderSets={orderSets} />

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCatFilter(c.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${catFilter === c.value ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
              <T k={c.label} />
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => (
            <button key={s.value} onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${statusFilter === s.value ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
              <T k={s.label} />
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : orderSets.length === 0 ? (
        <EmptyState icon="💊" title="등록된 약속처방이 없습니다" className="bg-white rounded-xl border" />
      ) : (
        <div className="space-y-3">
          {orderSets.map((os) => {
            const items = (os.items ?? []) as OrderSetItem[];
            const isOpen = expanded.has(os.id);
            const statusLabel = STATUSES.find(s => s.value === os.status)?.label ?? os.status;
            return (
              <div key={os.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/50" onClick={() => toggleExpand(os.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${CAT_COLOR[os.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        <T k={CATEGORIES.find(c => c.value === os.category)?.label ?? os.category} />
                      </span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[os.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        <T k={statusLabel} />
                      </span>
                      {os.code && <span className="text-[11px] font-mono text-gray-500 whitespace-nowrap">{os.code}</span>}
                      {os.department && <span className="text-[11px] text-gray-400 whitespace-nowrap">{os.department}</span>}
                      {os.diagnosisCode && <span className="text-[11px] font-mono text-indigo-500 whitespace-nowrap">{os.diagnosisCode}</span>}
                      {os.version > 1 && <span className="text-[11px] text-gray-400 whitespace-nowrap">v{os.version}</span>}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 truncate">{os.name}</p>
                    {os.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{os.description}</p>}
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    {unresolvedCountOf(items) > 0 && (
                      <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full whitespace-nowrap"><T k="미해석" /> {unresolvedCountOf(items)}</span>
                    )}
                    {(os.useCount ?? 0) > 0 && (
                      <span className="text-xs text-indigo-600 font-medium whitespace-nowrap">{os.useCount}<Unit><T k="회" /></Unit></span>
                    )}
                    <span className="text-xs text-gray-400 whitespace-nowrap">{items.length}<T k="항목@개수" /></span>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    <div className="px-4 py-3 bg-gray-50/50">
                      <table className="w-full text-sm">
                        <thead><tr>
                          <th className="text-left text-xs text-gray-400 pb-2"><T k="구분" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2"><T k="항목" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2"><T k="용법" /></th>
                          <th className="text-left text-xs text-gray-400 pb-2"><T k="비고" /></th>
                        </tr></thead>
                        <tbody>
                          {items.map((item, i) => (
                            <tr key={i} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 text-gray-500 whitespace-nowrap">{TYPE_ICON[item.type] ?? '📋'} {item.type}</td>
                              <td className="py-1.5 font-medium text-gray-900">
                                {item.name}
                                {isUnresolvedItem(item) && <span className="ml-1.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded"><T k="미해석" /></span>}
                              </td>
                              <td className="py-1.5 text-gray-600 text-xs">
                                {item.dosage && `${item.dosage} `}{item.frequency && item.frequency}{item.duration ? ` ${item.duration}일` : ''}
                              </td>
                              <td className="py-1.5 text-gray-400 text-xs">{item.instructions ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Actions */}
                    <div className="px-4 py-2 border-t border-gray-100 flex gap-2 flex-wrap">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(os); }}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"><T k="수정@동작" /></button>
                      <button onClick={(e) => { e.stopPropagation(); cloneMut.mutate(os.id); }}
                        disabled={cloneMut.isPending}
                        className="text-xs px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"><T k="복제" /></button>
                      {unresolvedCountOf(items) > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); setResolveTarget(os); }}
                          className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium"><T k="코드 해석" /> ({unresolvedCountOf(items)})</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setDxTarget(os); }}
                        className="text-xs px-3 py-1 rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100"><T k="진단 매핑" /></button>
                      {/* 🔴 상태 전이·폐기는 서버가 `@Roles(ADMIN)` 이다 — 의사에게 띄우면 누를 때마다 403 */}
                      {canWrite && os.status !== 'APPROVED' && os.status !== 'ACTIVE' && (
                        <button onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: os.id, status: os.status === 'DRAFT' ? 'PENDING_APPROVAL' : 'APPROVED' }); }}
                          disabled={statusMut.isPending}
                          className="text-xs px-3 py-1 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50">
                          {os.status === 'DRAFT' ? <T k="승인요청" /> : <T k="승인@버튼" />}
                        </button>
                      )}
                      {canWrite && os.status === 'APPROVED' && (
                        <button onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: os.id, status: 'ACTIVE' }); }}
                          disabled={statusMut.isPending}
                          className="text-xs px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"><T k="활성화@버튼" /></button>
                      )}
                      {canWrite && os.status !== 'DEPRECATED' && (
                        <button onClick={(e) => { e.stopPropagation(); deprecateMut.mutate(os.id); }}
                          disabled={deprecateMut.isPending}
                          className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"><T k="폐기@오더세트" /></button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-gray-400 text-center"><T k="총" /> {orderSets.length}<Unit><T k="개" /></Unit> <T k="약속처방" /></div>

      {/* Builder Modal */}
      {showBuilder && (
        <BuilderForm onClose={() => setShowBuilder(false)} onSaved={handleSaved} />
      )}
      {editTarget && (
        <BuilderForm editId={editTarget.id} editStatus={editTarget.status} initialData={editTarget.data} onClose={() => setEditTarget(null)} onSaved={handleSaved} />
      )}
      {resolveTarget && (
        <ResolveModal orderSet={resolveTarget} onClose={() => setResolveTarget(null)}
          onSaved={() => { setResolveTarget(null); qc.invalidateQueries({ queryKey: ['order-sets'] }); }} />
      )}
      {dxTarget && (
        <DiagnosisMappingModal orderSet={dxTarget} onClose={() => setDxTarget(null)}
          onSaved={() => { setDxTarget(null); qc.invalidateQueries({ queryKey: ['order-sets'] }); }} />
      )}
    </div>
  );
}
