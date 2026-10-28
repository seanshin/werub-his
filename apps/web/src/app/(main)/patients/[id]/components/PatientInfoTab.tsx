'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePatientRelations, useCreateRelation, useDeleteRelation } from '@/hooks/usePatients';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { toast } from '@/stores/toast-store';
import { safeFormat as format } from '@/lib/safe-date';
import { GENDER_LABEL, INSURANCE_LABEL, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { TAG_COLORS, DEFAULT_TAG_COLOR, MARITAL_STATUS_OPTIONS } from '@/lib/patient-constants';
import type { PatientContact } from '@/types/patient';
import type { HistoryEntry, CliHistoryItem } from './types';
import { RELATIONSHIP_LABEL } from '@/lib/patient-constants';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { useHasPermission } from '@/lib/permissions';

// ── InfoCell ──
function InfoCell({ label, value, warn }: { label: string; value?: string; warn?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-400 font-medium mb-0.5"><T k={label} /></p>
      <p className={`text-sm font-medium ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

// ── AI CLI Field Map ──
const FIELD_MAP: Record<string, { key: string; label: string }> = {
  '이메일': { key: 'email', label: '이메일' },
  'email': { key: 'email', label: '이메일' },
  '전화': { key: 'phone', label: '전화번호' },
  '전화번호': { key: 'phone', label: '전화번호' },
  '연락처': { key: 'phone', label: '전화번호' },
  '핸드폰': { key: 'phone', label: '전화번호' },
  '휴대폰': { key: 'phone', label: '전화번호' },
  '혈액형': { key: 'bloodType', label: '혈액형' },
  '주소': { key: 'address', label: '주소' },
  '직업': { key: 'occupation', label: '직업' },
  '종교': { key: 'religion', label: '종교' },
  '국적': { key: 'nationality', label: '국적' },
  '결혼상태': { key: 'maritalStatus', label: '결혼상태' },
  '보험유형': { key: 'insuranceType', label: '보험유형' },
  '보험번호': { key: 'insuranceNumber', label: '보험증번호' },
  '보험증번호': { key: 'insuranceNumber', label: '보험증번호' },
  '메모': { key: 'memo', label: '메모' },
  '알레르기': { key: 'allergies', label: '알레르기' },
  '이름': { key: 'name', label: '이름' },
  '성명': { key: 'name', label: '이름' },
  '성': { key: 'familyName', label: '성' },
  '이름(성)': { key: 'familyName', label: '성' },
};

function parseCommand(input: string): { field: string; key: string; value: string } | null {
  const normalized = input.trim();
  const m1 = normalized.match(/(.+?)(?:을|를|의)\s+(.+?)(?:로|으로)\s*(?:변경|수정|바꿔|바꾸|교체|업데이트|설정)/);
  if (m1) {
    const fieldName = m1[1].trim();
    const value = m1[2].trim();
    const mapped = FIELD_MAP[fieldName];
    if (mapped) return { field: mapped.label, key: mapped.key, value };
  }
  const m2 = normalized.match(/(.+?)(?:\s*(?:변경|수정|설정|:)\s*)(.+)/);
  if (m2) {
    const fieldName = m2[1].trim();
    const value = m2[2].trim();
    const mapped = FIELD_MAP[fieldName];
    if (mapped) return { field: mapped.label, key: mapped.key, value };
  }
  const words = normalized.split(/\s+/);
  if (words.length >= 2) {
    const fieldName = words[0];
    const value = words.slice(1).join(' ');
    const mapped = FIELD_MAP[fieldName];
    if (mapped) return { field: mapped.label, key: mapped.key, value };
  }
  return null;
}

// ── PatientAiCli ──
function PatientAiCli({ patientId }: { patientId: string }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<CliHistoryItem[]>([
    { type: 'info', text: '환자 정보를 자연어로 수정할 수 있습니다. 예: "이메일을 name@example.com으로 변경"' },
  ]);
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();

  const execute = async () => {
    if (!input.trim() || pending) return;
    const cmd = input.trim();
    setHistory(prev => [...prev, { type: 'input', text: cmd }]);
    setInput('');

    const parsed = parseCommand(cmd);
    if (!parsed) {
      setHistory(prev => [...prev, { type: 'error', text: '명령을 이해할 수 없습니다. 예: "이메일을 name@example.com으로 변경", "전화번호 010-0000-0000", "혈액형 A+"' }]);
      return;
    }

    setPending(true);
    try {
      let payload: Record<string, unknown>;
      if (parsed.key === 'name') {
        const name = parsed.value;
        payload = { familyName: name.slice(0, 1), givenName: name.slice(1) };
      } else if (parsed.key === 'allergies') {
        payload = { allergies: parsed.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) };
      } else if (parsed.key === 'address') {
        payload = { address: { line1: parsed.value, city: '', country: 'KR' } };
      } else if (parsed.key === 'insuranceType') {
        const typeMap: Record<string, string> = {
          '건강보험': 'NHI', '의료급여': 'MEDICAID', '산재': 'INDUSTRIAL',
          '자동차보험': 'AUTO', '자비': 'SELF_PAY', '비급여': 'SELF_PAY',
        };
        payload = { insuranceType: typeMap[parsed.value] ?? parsed.value };
      } else if (parsed.key === 'maritalStatus') {
        const statusMap: Record<string, string> = {
          '미혼': 'SINGLE', '기혼': 'MARRIED', '이혼': 'DIVORCED', '사별': 'WIDOWED',
        };
        payload = { maritalStatus: statusMap[parsed.value] ?? parsed.value };
      } else {
        payload = { [parsed.key]: parsed.value };
      }

      await apiClient.put(`/api/v1/patients/${patientId}`, payload);
      qc.invalidateQueries({ queryKey: ['patient', patientId] });
      setHistory(prev => [...prev, { type: 'success', text: `${parsed.field}이(가) "${parsed.value}"(으)로 변경되었습니다.` }]);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '수정에 실패했습니다.';
      setHistory(prev => [...prev, { type: 'error', text: msg }]);
    } finally {
      setPending(false);
    }
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-700 transition-all shadow-sm">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
        {AI_ORIGIN_TEXT} <T k="명령으로 수정" />
      </button>
    );
  }

  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          <span className="text-xs font-semibold text-gray-300">{AI_ORIGIN_TEXT} <T k="환자정보 수정 CLI" /></span>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-gray-300">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="px-4 py-3 max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs">
        {history.map((h, i) => (
          <div key={i} className={
            h.type === 'input' ? 'text-gray-400' :
            h.type === 'success' ? 'text-emerald-400' :
            h.type === 'error' ? 'text-red-400' :
            'text-indigo-400'
          }>
            {h.type === 'input' && <span className="text-indigo-500 mr-1">$</span>}
            {h.type === 'success' && <span className="mr-1">✓</span>}
            {h.type === 'error' && <span className="mr-1">✗</span>}
            {h.type === 'info' && <span className="mr-1">i</span>}
            {h.text}
          </div>
        ))}
        {pending && <div className="text-amber-400 animate-pulse"><T k="처리 중..." /></div>}
      </div>
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800">
        <span className="text-indigo-500 font-mono text-sm font-bold">$</span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && execute()}
          placeholder="이메일을 name@example.com으로 변경"
          disabled={pending}
          className="flex-1 bg-transparent text-gray-200 text-sm font-mono outline-none placeholder:text-gray-600"
          autoFocus
        />
        <button onClick={execute} disabled={pending || !input.trim()}
          className="px-3 py-1 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          <T k="실행" />
        </button>
      </div>
      <div className="px-4 pb-3 flex flex-wrap gap-1">
        {['이메일', '전화번호', '혈액형', '주소', '직업', '종교', '알레르기', '메모'].map(field => (
          <button key={field} onClick={() => setInput(`${field} `)}
            className="px-2 py-0.5 text-[10px] bg-gray-800 text-gray-500 rounded hover:bg-gray-700 hover:text-gray-300 transition-colors">
            {field}
          </button>
        ))}
      </div>
    </div>
  );
}

interface PatientRelation {
  id: string;
  relationship: string;
  notes?: string;
  relatedPatient?: {
    id: string;
    familyName: string;
    givenName: string;
    mrn: string;
    photoUrl?: string;
  };
}

interface PatientSearchResult {
  id: string;
  familyName: string;
  givenName: string;
  mrn: string;
}

// ── PatientFamilyRelations ──
const FAMILY_RELATION_LABEL: Record<string, string> = {
  PARENT: '부모',
  CHILD: '자녀',
  SPOUSE: '배우자',
  SIBLING: '형제/자매',
  GRANDPARENT: '조부모',
  GRANDCHILD: '손자녀',
  GUARDIAN: '법정대리인',
  DEPENDENT: '피후견인',
};

function PatientFamilyRelations({ patientId }: { patientId: string }) {
  // 서버는 가족관계 등록·해제에 patient:relation:edit 를 요구한다(의사 없음) — 버튼만 보이고 늘 403 이던 것(2026-09-30)
  const canEditRelations = useHasPermission('patient:relation:edit');
  const tAttr = useTAttr();
  const { data } = usePatientRelations(patientId);
  const createMut = useCreateRelation();
  const deleteMut = useDeleteRelation();
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [relationship, setRelationship] = useState(''); // 쓰기 폼 초기값은 미선택(종전 '부모'로 시작)
  const [notes, setNotes] = useState('');

  const _raw = data?.data;
  const relations = Array.isArray(_raw) ? _raw : (_raw as unknown as { data?: PatientRelation[] })?.data ?? [];

  const { data: searchData } = useQuery({
    queryKey: ['patient-search-relation', searchQuery],
    queryFn: () => apiClient.get<{ data: PatientSearchResult[] }>('/api/v1/patients', { q: searchQuery, limit: 5 }),
    enabled: !!searchQuery && searchQuery.length >= 1,
  });
  const searchResults = Array.isArray(searchData?.data) ? searchData.data : (searchData?.data as unknown as { data?: PatientSearchResult[] })?.data ?? [];

  const handleAdd = async () => {
    if (!selectedId) {
      toast.warning('연결할 환자를 선택해주세요.');
      return;
    }
    if (!relationship) {
      toast.warning(tAttr('관계를 선택해주세요.'));
      return;
    }
    try {
      await createMut.mutateAsync({ patientId, data: { relatedId: selectedId, relationship, notes: notes || undefined } });
      toast.success('가족 관계가 연결되었습니다.');
      setShowAdd(false);
      setSearchQuery('');
      setSelectedId('');
      setSelectedName('');
      setNotes('');
    } catch {
      toast.error('가족 관계 연결에 실패했습니다.');
    }
  };

  const handleDelete = async (relationId: string) => {
    if (!confirm('이 가족 관계를 해제하시겠습니까?')) return;
    try {
      await deleteMut.mutateAsync({ patientId, relationId });
      toast.success('가족 관계가 해제되었습니다.');
    } catch {
      toast.error('가족 관계 해제에 실패했습니다.');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900"><T k="가족 관계" /></h3>
        {canEditRelations ? (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {showAdd ? <T k="취소" /> : <T k="가족 연결" />}
          </button>
        ) : (
          <span className="text-[11px] text-gray-400"><T k="가족 관계 등록은 원무·간호가 합니다" /></span>
        )}
      </div>

      {showAdd && (
        <div className="mb-4 border border-blue-100 rounded-xl p-4 bg-blue-50/30 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="관계 환자 선택" /></label>
            <PatientSelector
              value={selectedId}
              onChange={(id, p) => { setSelectedId(id); setSelectedName(`${p.familyName}${p.givenName}`); }}
              context="general"
              placeholder={tAttr('관계 환자 검색 (이름, MRN)')}
            />
            {false && (
              <div className="hidden">
              </div>
            )}
            {selectedId && <p className="mt-1 text-xs text-emerald-600"><T k="선택" />: {selectedName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="관계" /></label>
              <select value={relationship} onChange={e => setRelationship(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">{tAttr('선택')}</option>
                <option value="PARENT">{tAttr('부모')}</option>
                <option value="CHILD">{tAttr('자녀')}</option>
                <option value="SPOUSE">{tAttr('배우자')}</option>
                <option value="SIBLING">{tAttr('형제/자매')}</option>
                <option value="GRANDPARENT">{tAttr('조부모')}</option>
                <option value="GRANDCHILD">{tAttr('손자녀')}</option>
                <option value="GUARDIAN">{tAttr('법정대리인')}</option>
                <option value="DEPENDENT">{tAttr('피후견인')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="메모" /></label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder={tAttr('선택')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={handleAdd} disabled={!selectedId || createMut.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {createMut.isPending ? <T k="연결 중..." /> : <T k="연결" />}
          </button>
        </div>
      )}

      {relations.length > 0 ? (
        <div className="space-y-2">
          {relations.map((rel: PatientRelation) => (
            <div key={rel.id} className="flex items-center justify-between border border-gray-100 rounded-xl p-3">
              <div className="flex items-center gap-3">
                {rel.relatedPatient?.photoUrl ? (
                  <img src={`${process.env.NEXT_PUBLIC_API_URL || ''}${rel.relatedPatient.photoUrl}`} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500">
                    {rel.relatedPatient?.familyName?.[0]}{rel.relatedPatient?.givenName?.[0]}
                  </div>
                )}
                <div>
                  <Link href={`/patients/${rel.relatedPatient?.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                    {rel.relatedPatient?.familyName}{rel.relatedPatient?.givenName}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {FAMILY_RELATION_LABEL[rel.relationship] ?? rel.relationship} | {rel.relatedPatient?.mrn}
                    {rel.notes && <span className="ml-1 text-gray-400">({rel.notes})</span>}
                  </p>
                </div>
              </div>
              {canEditRelations && <button onClick={() => handleDelete(rel.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors"><T k="해제" /></button>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="📋" title="등록된 가족 관계가 없습니다." />
      )}
    </div>
  );
}

// ── Main PatientInfoTab ──
interface PatientRecord {
  familyName?: string;
  givenName?: string;
  mrn?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  maritalStatus?: string;
  occupation?: string;
  religion?: string;
  insuranceType?: string;
  insuranceNumber?: string;
  createdAt?: string;
  phone?: string;
  email?: string;
  address?: string | Record<string, unknown>;
  contacts?: PatientContact[];
  tags?: string[];
  memo?: string;
}

interface PatientInfoTabProps {
  patient: PatientRecord;
  patientId: string;
  /** 🔴 나이 미상은 `null` — 0(신생아)과 다른 사실이다(정본 shared `ageOf`) */
  patientAge: number | null;
  allergies: string[];
  patientTags: string[];
  residentNumberMasked?: string;
  historyList: HistoryEntry[];
}

export function PatientInfoTab({
  patient,
  patientId,
  patientAge,
  allergies,
  patientTags,
  residentNumberMasked,
  historyList,
}: PatientInfoTabProps) {
  const tAttr = useTAttr();
  const canEditPatient = useHasPermission('patient:edit');
  return (
    <div className="space-y-6">
      {/* AI CLI */}
      {/* 인적정보 수정(patient:edit)은 원무 성격이라 의사에게 없다 — 권한 없는 역할엔 명령 수정 상자를 그리지 않는다 */}
      {canEditPatient && <PatientAiCli patientId={patientId} />}

      {/* 인적 사항 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="인적 사항" /></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <InfoCell label="성명" value={[patient.familyName, patient.givenName].filter(Boolean).join('') || '-'} />
          <InfoCell label="MRN" value={patient.mrn} />
          <InfoCell label="생년월일" value={`${patient.dateOfBirth && !isNaN(new Date(String(patient.dateOfBirth)).getTime()) ? format(new Date(String(patient.dateOfBirth)), 'yyyy-MM-dd') : '-'} (${patientAge != null ? `${patientAge}세` : '나이 미상'})`} />
          <InfoCell label="성별" value={(patient.gender ? GENDER_LABEL[patient.gender] : undefined) ?? patient.gender} />
          <InfoCell label="국적" value={patient.nationality ?? '대한민국'} />
          <InfoCell label="결혼상태" value={MARITAL_STATUS_OPTIONS.find(m => m.value === patient.maritalStatus)?.label ?? '-'} />
          <InfoCell label="직업" value={patient.occupation ?? '-'} />
          <InfoCell label="종교" value={patient.religion ?? '-'} />
        </div>
      </div>

      {/* 보험 정보 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="보험 정보" /></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <InfoCell label="보험 유형" value={(patient.insuranceType ? INSURANCE_LABEL[patient.insuranceType] : undefined) ?? patient.insuranceType} />
          <InfoCell label="보험증번호" value={patient.insuranceNumber ? '****' + patient.insuranceNumber.slice(-4) : '-'} />
          <InfoCell label="주민등록번호" value={residentNumberMasked ?? '-'} />
          <InfoCell label="등록일" value={patient.createdAt ? format(new Date(patient.createdAt), 'yyyy-MM-dd') : '-'} />
        </div>
      </div>

      {/* 연락처 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="연락처@섹션" /></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <InfoCell label="전화" value={patient.phone ?? '-'} />
          <InfoCell label="이메일" value={patient.email ?? '-'} />
          <InfoCell label="주소" value={typeof patient.address === 'string' ? patient.address : (patient.address ? JSON.stringify(patient.address) : '-')} />
        </div>
      </div>

      {/* 보호자 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="보호자 / 응급연락처" /></h3>
        {Array.isArray(patient.contacts) && patient.contacts.length > 0 ? (
          <div className="space-y-3">
            {patient.contacts.map((contact: PatientContact) => (
              <div key={contact.id} className="border border-gray-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">{contact.name}</span>
                    <span className="text-xs text-gray-500">({RELATIONSHIP_LABEL[contact.relationship] ?? contact.relationship})</span>
                    {contact.isPrimaryContact && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700"><T k="주보호자" /></span>
                    )}
                    {contact.isEmergencyContact && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700"><T k="응급연락처" /></span>
                    )}
                    {contact.isLegalGuardian && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700"><T k="법정대리인" /></span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{contact.phone}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="👤" title="등록된 보호자가 없습니다." />
        )}
      </div>

      {/* 가족 관계 */}
      <PatientFamilyRelations patientId={patientId} />

      {/* 관리 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        {/* 🔴 구획 제목이다 — 무문맥 '관리' 는 표의 동작 열(Actions) 정본이라 문맥 키를 쓴다 */}
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="관리@구획" /></h3>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="메모" /></p>
            <p className="text-sm text-gray-700">{patient.memo || '-'}</p>
          </div>
          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="태그" /></p>
            {patientTags.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {patientTags.map((tag) => {
                  const color = TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
                  return (
                    <span key={tag} className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${color.bg} ${color.text}`}>
                      {tag}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">-</p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1"><T k="알레르기" /></p>
            {/* 🔴 '없음'은 "확인했고 없었다"로 읽힌다 — 목록이 빈 것과는 다른 사실이다. */}
            {allergies.length > 0 ? (
              <p className="text-sm font-medium text-red-600">{allergies.join(', ')}</p>
            ) : (
              <AllergyStatusBadge patientId={patientId} allergyCount={0} />
            )}
          </div>
        </div>
      </div>

      {/* Change History */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4"><T k="변경 이력" /></h3>
        {historyList.length === 0 ? (
          <EmptyState icon="📝" title="변경 이력이 없습니다." />
        ) : (
          <div className="relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-gray-200" />
            <div className="space-y-3">
              {historyList.map((entry: HistoryEntry, i: number) => (
                <div key={i} className="relative pl-10 flex items-center gap-3 text-sm">
                  <div className="absolute left-[9px] top-1.5 w-3 h-3 rounded-full border-2 border-white bg-gray-400" />
                  <span className="text-gray-400 flex-shrink-0">
                    {format(new Date(entry.txTime), 'yyyy-MM-dd HH:mm')}
                  </span>
                  <span className="text-gray-600">
                    {entry.action ?? <T k="수정됨" />}
                  </span>
                  {entry.changedBy && (
                    <span className="text-xs text-gray-400">
                      by {entry.changedBy}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
