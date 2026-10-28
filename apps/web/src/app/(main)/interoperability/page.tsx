'use client';

import Link from 'next/link';
import { Unit } from '@/components/ui/display';
import { useState } from 'react';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { apiClient } from '@/lib/api-client';

// FHIR 리소스 → 환자참조 검색 파라미터
const PATIENT_RESOURCES: { type: string; param: string; label: string }[] = [
  { type: 'Encounter', param: 'subject', label: '진료' },
  { type: 'Condition', param: 'subject', label: '진단' },
  { type: 'MedicationRequest', param: 'subject', label: '처방' },
  { type: 'Observation', param: 'patient', label: '검사결과' },
  { type: 'AllergyIntolerance', param: 'patient', label: '알레르기' },
  { type: 'Immunization', param: 'patient', label: '예방접종' },
  { type: 'Procedure', param: 'subject', label: '시술' },
  { type: 'DiagnosticReport', param: 'subject', label: '진단보고서' },
  { type: 'ServiceRequest', param: 'subject', label: '검사의뢰' },
  { type: 'CarePlan', param: 'subject', label: '치료계획' },
  { type: 'Appointment', param: 'patient', label: '예약' },
  { type: 'DocumentReference', param: 'subject', label: '문서' },
];

function FhirConsole() {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState<{ id: string; name: string; mrn: string; birthDate?: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [activeResource, setActiveResource] = useState<string>('');
  const [bundle, setBundle] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const fhirGet = async (path: string) => {
    const token = apiClient.getToken();
    const res = await fetch(`/fhir/R4/${path}`, {
      headers: { Accept: 'application/fhir+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`FHIR ${res.status}`);
    return res.json();
  };

  const searchPatients = async () => {
    if (!q.trim()) return;
    setLoading(true); setErr(''); setSelected(null); setBundle(null);
    try {
      const isMrn = /\d/.test(q) && q.includes('-');
      const b = await fhirGet(`Patient?${isMrn ? 'identifier' : 'name'}=${encodeURIComponent(q.trim())}&_count=20`);
      const entries = (b?.entry ?? []) as { resource: Record<string, unknown> }[];
      setPatients(entries.map((e) => {
        const r = e.resource;
        const nm = (r.name as { text?: string; family?: string; given?: string[] }[] | undefined)?.[0];
        const ident = (r.identifier as { value?: string }[] | undefined)?.[0]?.value;
        return { id: String(r.id), name: nm?.text ?? `${nm?.family ?? ''}${(nm?.given ?? []).join('')}`, mrn: ident ?? '-', birthDate: r.birthDate as string | undefined };
      }));
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };

  const loadResource = async (r: { type: string; param: string }) => {
    if (!selected) return;
    setLoading(true); setErr(''); setActiveResource(r.type); setBundle(null);
    try {
      setBundle(await fhirGet(`${r.type}?${r.param}=Patient/${selected.id}&_count=50`));
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div>
        <h3 className="text-base font-bold text-gray-900"><T k="FHIR R4 조회 콘솔" /></h3>
        <p className="text-xs text-gray-500 mt-0.5"><Tf k="표준 FHIR 엔드포인트({경로})를 직접 질의 — 외부 연동 검증용" params={{ 경로: <span className="font-mono">/fhir/R4</span> }} /></p>
      </div>

      {/* 환자 검색 */}
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPatients()}
          placeholder={tAttr('환자명 또는 등록번호(MRN)')} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
        <button onClick={searchPatients} disabled={loading} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"><T k="Patient 검색" /></button>
      </div>
      {err && <p className="text-xs text-red-500"><Tf k="오류: {사유}" params={{ 사유: err }} /></p>}

      {patients.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patients.map((p) => (
            <button key={p.id} onClick={() => { setSelected({ id: p.id, name: p.name }); setBundle(null); setActiveResource(''); }}
              className={`text-xs px-2.5 py-1 rounded-full border ${selected?.id === p.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {p.name} <span className="text-gray-400 font-mono">{p.mrn}</span>
            </button>
          ))}
        </div>
      )}

      {/* 리소스 조회 */}
      {selected && (
        <div className="space-y-2 border-t border-gray-50 pt-3">
          <p className="text-xs text-gray-500"><Tf k="{환자} 님의 FHIR 리소스" params={{ 환자: <b className="text-gray-800">{selected.name}</b> }} /></p>
          <div className="flex flex-wrap gap-1.5">
            {PATIENT_RESOURCES.map((r) => (
              <button key={r.type} onClick={() => loadResource(r)}
                className={`text-xs px-2.5 py-1 rounded-lg ${activeResource === r.type ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                <T k={r.label} /> <span className="opacity-60">{r.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bundle JSON */}
      {bundle != null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500"><Tf k="{리소스} Bundle · {수}건" params={{ 리소스: activeResource, 수: ((bundle as { entry?: unknown[] }).entry?.length ?? 0) }} /></span>
          </div>
          <pre className="text-[11px] bg-gray-900 text-gray-100 rounded-lg p-3 overflow-auto max-h-96 leading-relaxed">{JSON.stringify(bundle, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

const FHIR_RESOURCES = [
  { name: 'Patient', desc: '환자 정보', ops: 'read, search, create, update' },
  { name: 'Encounter', desc: '진료 기록', ops: 'read, search' },
  { name: 'MedicationRequest', desc: '처방', ops: 'read, search' },
  { name: 'Condition', desc: '진단', ops: 'read, search' },
  { name: 'Observation', desc: '검사 결과', ops: 'read, search' },
  { name: 'Immunization', desc: '예방접종', ops: 'read, search' },
  { name: 'Medication', desc: '약품 정보', ops: 'read, search' },
  { name: 'Practitioner', desc: '의료진', ops: 'read, search' },
  { name: 'AllergyIntolerance', desc: '알레르기', ops: 'read, search' },
  { name: 'Procedure', desc: '수술/시술', ops: 'read, search' },
  { name: 'Appointment', desc: '예약', ops: 'read, search' },
  { name: 'DiagnosticReport', desc: '진단 보고서', ops: 'read, search' },
  { name: 'ServiceRequest', desc: '검사/영상 의뢰', ops: 'read, search' },
  { name: 'Location', desc: '병동/병실', ops: 'read, search' },
  { name: 'CarePlan', desc: '치료 계획', ops: 'read, search' },
  { name: 'DocumentReference', desc: '문서 참조', ops: 'read, search' },
  { name: 'Organization', desc: '기관 정보', ops: 'read' },
];

const TRANSFER_STEPS = [
  { step: 1, title: '전원 의뢰', desc: '의사가 환자 선택 → 수신 병원 지정 → 전원 사유 입력', icon: '📋' },
  { step: 2, title: 'FHIR Bundle 생성', desc: '환자+진단+투약+검사+알레르기 → 표준 문서로 자동 패키징', icon: '📦' },
  { step: 3, title: 'SMART 인증 + 전송', desc: 'OAuth2 인증 → HTTPS로 수신 병원에 안전하게 전달', icon: '🔐' },
  { step: 4, title: '수신 병원 확인', desc: '수신 병원이 수락/거절 → 환자 자동 등록 → 입원/외래 연결', icon: '✅' },
];

const PATIENT_TYPES = [
  { type: '내국인', id: '주민등록번호', insurance: 'NHI/의료급여', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { type: '외국인 거주자', id: '외국인등록번호', insurance: 'NHI 가능', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  { type: '외국인 관광객', id: '여권번호', insurance: '자비/여행자보험', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { type: '재외동포', id: '여권+주민번호(선택)', insurance: 'NHI 가능', color: 'bg-violet-50 border-violet-200 text-violet-700' },
  { type: '원격 해외환자', id: '여권/이메일', insurance: '자비', color: 'bg-pink-50 border-pink-200 text-pink-700' },
  { type: '응급 미확인', id: '임시ID 자동부여', insurance: '미상', color: 'bg-red-50 border-red-200 text-red-700' },
];

const DOCS = [
  { title: 'FHIR R4 연동 가이드', href: '/docs/FHIR-R4-INTEGRATION-GUIDE', desc: '리소스 매핑, 인증, 코드체계, API 예시' },
  { title: 'CapabilityStatement', href: '/fhir/R4/metadata', desc: 'FHIR 서버 기능 명세 (JSON)' },
  { title: 'v3.0 기획서', href: '#', desc: '멀티 병원 + 전원 + SMART-on-FHIR + PWA' },
  { title: 'API Reference', href: '/docs/API-REFERENCE', desc: '전체 1,834 엔드포인트 레퍼런스' },
];

export default function InteroperabilityPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-10">
      {/* Hero */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold mb-4">
          FHIR R4 | HL7 Korea | SMART-on-FHIR
        </div>
        <h1 className="text-3xl font-bold text-gray-900"><T k="Hospital RUN 상호운용성" /></h1>
        <p className="text-gray-500 mt-2 max-w-2xl mx-auto">
          <T k="FHIR R4 표준 기반 17개 리소스 API · 환자 전원 · 해외 환자 등록 · 건강정보고속도로 연동" />
        </p>
      </div>

      {/* FHIR 조회 콘솔 (실동작) */}
      <FhirConsole />

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/transfer" className="bg-white rounded-2xl border shadow-sm p-4 text-center hover:border-blue-300 transition">
          <div className="text-2xl mb-2">🔄</div>
          <div className="text-sm font-semibold text-gray-900"><T k="전원 관리" /></div>
          <div className="text-[10px] text-gray-400 mt-0.5"><T k="의뢰/수신/이력" /></div>
        </Link>
        <Link href="/patients/register/foreign" className="bg-white rounded-2xl border shadow-sm p-4 text-center hover:border-blue-300 transition">
          <div className="text-2xl mb-2">🌍</div>
          <div className="text-sm font-semibold text-gray-900"><T k="해외 환자 등록" /></div>
          <div className="text-[10px] text-gray-400 mt-0.5"><T k="외국인/관광객/재외동포" /></div>
        </Link>
        <Link href="/admin/organizations" className="bg-white rounded-2xl border shadow-sm p-4 text-center hover:border-blue-300 transition">
          <div className="text-2xl mb-2">🏥</div>
          <div className="text-sm font-semibold text-gray-900"><T k="기관 관리" /></div>
          <div className="text-[10px] text-gray-400 mt-0.5"><T k="연동 병원 등록" /></div>
        </Link>
        <a href="/fhir/R4/metadata" target="_blank" className="bg-white rounded-2xl border shadow-sm p-4 text-center hover:border-blue-300 transition">
          <div className="text-2xl mb-2">🔥</div>
          <div className="text-sm font-semibold text-gray-900">FHIR Metadata</div>
          <div className="text-[10px] text-gray-400 mt-0.5">CapabilityStatement</div>
        </a>
      </div>

      {/* Transfer Flow */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="환자 전원 프로세스" /></h2>
        <div className="grid grid-cols-4 gap-4">
          {TRANSFER_STEPS.map(s => (
            <div key={s.step} className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-xl mx-auto mb-2">{s.icon}</div>
              <div className="text-xs font-bold text-gray-900">Step {s.step}</div>
              <div className="text-xs font-semibold text-blue-600 mt-0.5"><T k={s.title} /></div>
              <div className="text-[10px] text-gray-400 mt-1"><T k={s.desc} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* Patient Types */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="환자 유형별 등록" /></h2>
        <div className="grid grid-cols-3 gap-3">
          {PATIENT_TYPES.map(p => (
            <div key={p.type} className={`rounded-xl border p-3 ${p.color}`}>
              <div className="text-xs font-bold"><T k={p.type} /></div>
              <div className="text-[10px] mt-1"><Tf k="식별: {값}" params={{ 값: <T k={p.id} /> }} /></div>
              <div className="text-[10px]"><Tf k="보험: {값}" params={{ 값: <T k={p.insurance} /> }} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* FHIR Resources */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900"><Tf k="FHIR R4 리소스 ({수})" params={{ 수: <>{FHIR_RESOURCES.length}<Unit>개</Unit></> }} /></h2>
          <a href="/fhir/R4/metadata" target="_blank" className="text-xs text-blue-600 hover:underline">CapabilityStatement →</a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {FHIR_RESOURCES.map(r => (
            <div key={r.name} className="border rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900">{r.name}</span>
                <span className="text-[9px] text-gray-400">{r.ops}</span>
              </div>
              <div className="text-[10px] text-gray-500"><T k={r.desc} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* API Example */}
      <div className="bg-gray-900 rounded-2xl p-6 text-white">
        <h2 className="text-sm font-bold text-gray-300 mb-3"><T k="API 사용 예시" /></h2>
        <pre className="text-xs text-green-400 overflow-x-auto">
{`# 환자 검색
GET /fhir/R4/Patient?name=김&gender=male
Authorization: Bearer <token>

# 검사 결과 조회
GET /fhir/R4/Observation?patient=abc-123
Authorization: Bearer <token>

# 전원 의뢰 생성
POST /api/v1/transfer/request
{
  "patientId": "abc-123",
  "toOrgCode": "11100001",
  "urgency": "URGENT",
  "reason": "상급병원 정밀검사 필요"
}`}
        </pre>
      </div>

      {/* Documentation Links */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="문서 및 가이드" /></h2>
        <div className="grid grid-cols-2 gap-3">
          {DOCS.map(d => (
            <a key={d.title} href={d.href} target={d.href.startsWith('/fhir') ? '_blank' : undefined}
              className="border rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/30 transition">
              <div className="text-sm font-semibold text-gray-900"><T k={d.title} /></div>
              <div className="text-xs text-gray-400 mt-0.5"><T k={d.desc} /></div>
            </a>
          ))}
        </div>
      </div>

      {/* Roadmap */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4"><T k="v3.0 로드맵 (14주)" /></h2>
        <div className="space-y-2">
          {[
            { phase: 1, title: '전원 기록 + FHIR Bundle', weeks: 2, status: 'planned' },
            { phase: 2, title: 'SMART-on-FHIR OAuth2 인증', weeks: 2, status: 'planned' },
            { phase: 3, title: 'Bundle 전송/수신 + 환자 매칭', weeks: 2, status: 'planned' },
            { phase: 4, title: '관리 UI + 모니터링', weeks: 1, status: 'planned' },
            { phase: 5, title: '해외/외부 환자 등록 (6유형+다국어)', weeks: 2, status: 'planned' },
            { phase: 6, title: 'PWA 오프라인', weeks: 2, status: 'planned' },
            { phase: 7, title: '건강정보고속도로 CDA 연동', weeks: 3, status: 'planned' },
          ].map(p => (
            <div key={p.phase} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5">
              <span className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">{p.phase}</span>
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900"><T k={p.title} /></span>
              </div>
              <span className="text-[10px] text-gray-400">{p.weeks}<Unit>주</Unit></span>
              <span className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full font-semibold whitespace-nowrap"><T k="계획" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
