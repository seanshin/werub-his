'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { MutationError } from '@hospital-run/shared';
import { AddressSearch, AddressValue, toPatientAddress } from '@/components/ui/AddressSearch';
import { PatientPhotoCapture, PhotoValue, photoToBlob } from './PatientPhotoCapture';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { RegistrationConsentCollector } from '@/components/consent/RegistrationConsentCollector';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// 6/8자리 또는 YYYY-MM-DD → YYYY-MM-DD
function expandBirth(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = t.replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (d.length === 6) { const yy = +d.slice(0, 2); const yr = yy > 30 ? 1900 + yy : 2000 + yy; return `${yr}-${d.slice(2, 4)}-${d.slice(4, 6)}`; }
  return '';
}
// 주민번호 → 생년월일
function rrnToBirth(rrn: string): string {
  const d = rrn.replace(/\D/g, '');
  if (d.length < 7) return '';
  const yy = +d.slice(0, 2); const mm = d.slice(2, 4); const dd = d.slice(4, 6); const g = d[6];
  const c = ['1', '2', '5', '6'].includes(g) ? 1900 : ['3', '4', '7', '8'].includes(g) ? 2000 : (yy > 30 ? 1900 : 2000);
  return `${c + yy}-${mm}-${dd}`;
}

interface Created { id: string; mrn: string; familyName: string; givenName: string }
export interface NewPatientPrefill { familyName?: string; givenName?: string; birth?: string; phone?: string; reason?: string }

export function NewPatientTab({ onGoCheckIn, initial }: { onGoCheckIn?: () => void; initial?: NewPatientPrefill | null }) {
  const tt = useTAttr();
  const [familyName, setFamilyName] = useState(initial?.familyName ?? '');
  const [givenName, setGivenName] = useState(initial?.givenName ?? '');
  const [birth, setBirth] = useState(initial?.birth ?? '');
  const [rrn, setRrn] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | ''>('');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [addr, setAddr] = useState<AddressValue>({});
  const [insuranceType, setInsuranceType] = useState('NHI');
  const [ocrConsent, setOcrConsent] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [photo, setPhoto] = useState<PhotoValue>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const familyRef = useRef<HTMLInputElement>(null);
  const givenRef = useRef<HTMLInputElement>(null);
  const birthRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // 마운트 시 첫 번째 빈 칸으로 포커스(이관된 값은 건너뜀)
  useEffect(() => {
    const fields: Array<[string, React.RefObject<HTMLInputElement | null>]> = [
      [familyName, familyRef], [givenName, givenRef], [birth, birthRef], [phone, phoneRef],
    ];
    const target = fields.find(([v]) => !v.trim())?.[1] ?? familyRef;
    target.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadPhoto = async (patientId: string) => {
    try {
      const blob = await photoToBlob(photo);
      if (!blob) return;
      const fd = new FormData();
      fd.append('photo', blob, 'patient.jpg');
      await fetch(`${API_BASE}/api/v1/patients/${patientId}/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiClient.getToken()}` },
        body: fd,
      });
    } catch { /* 사진 실패는 등록에 영향 없음 */ }
  };

  const applyRrn = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 13);
    setRrn(d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d);
    const b = rrnToBirth(d);
    if (b) { setBirth(b); const g = ['1', '3', '5', '7'].includes(d[6]) ? 'MALE' : ['2', '4', '6', '8'].includes(d[6]) ? 'FEMALE' : ''; if (g) setGender(g as 'MALE' | 'FEMALE'); }
  };

  const onIdImage = async (file: File) => {
    if (!ocrConsent) { toast.error(tt('신분증 OCR 처리 동의에 체크해 주세요.')); return; }
    setOcrLoading(true);
    try {
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
      const r = await apiClient.post<{ data: { familyName: string; givenName: string; rrn: string; birthDate: string; address: string } }>('/api/v1/ai/id-ocr', { image: b64, docType: 'RRN_CARD', consent: true });
      const d = r.data;
      if (d?.familyName) setFamilyName(d.familyName);
      if (d?.givenName) setGivenName(d.givenName);
      if (d?.rrn) applyRrn(d.rrn);
      else if (d?.birthDate) setBirth(d.birthDate);
      if (d?.address) setAddr({ roadAddress: d.address });
      toast.success(tt('신분증 인식 완료 — 내용을 확인하세요.'));
    } catch {
      toast.error(tt('신분증 자동 인식 실패 — 직접 입력해 주세요.'));
    } finally { setOcrLoading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const mut = useMutation({
    mutationFn: () => {
      const dob = expandBirth(birth);
      return apiClient.post<{ data: Created }>('/api/v1/patients', {
        familyName: familyName.trim(),
        givenName: givenName.trim(),
        dateOfBirth: dob,
        gender,
        phone: phone.trim() || undefined,
        insuranceType,
        nationalId: rrn.replace(/\D/g, '') || undefined,
        nationalIdType: rrn ? 'RESIDENT' : undefined,
        address: toPatientAddress(addr),
        // 🔴 동의는 여기서 보내지 않는다 — 종전 체크박스 두 개는 직원이 누른 것인데 "환자 동의"로 기록됐다(2026-10-03).
        //    등록 직후 환자가 태블릿·휴대폰·종이로 직접 고르고 서명한다(RegistrationConsentCollector).
      });
    },
    onSuccess: async (res) => {
      if (photo) await uploadPhoto(res.data.id);
      setCreated(res.data);
      toast.success(`${tt('환자 등록 완료')} · ${res.data.mrn}`);
    },
    onError: (e: MutationError) => toast.error(e?.message ?? tt('환자 등록 실패')),
  });

  const dobPreview = expandBirth(birth);
  const canSubmit = familyName.trim() && givenName.trim() && dobPreview && gender && !mut.isPending;

  const resetForm = () => {
    setFamilyName(''); setGivenName(''); setBirth(''); setRrn(''); setGender(''); setPhone(''); setAddr({});
    setInsuranceType('NHI'); setOcrConsent(false); setPhoto(null); setCreated(null);
  };

  if (created) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-8 text-center">
          <div className="text-4xl mb-2">✅</div>
          <h3 className="text-lg font-bold text-gray-900"><T k="신규 환자 등록 완료" /></h3>
          <p className="text-sm text-gray-500 mt-1">{created.familyName}{created.givenName}</p>
          <div className="mt-4 inline-block bg-emerald-50 rounded-xl px-6 py-3">
            <p className="text-xs text-emerald-600"><T k="환자 등록번호" /></p>
            <p className="text-2xl font-mono font-bold text-emerald-700">{created.mrn}</p>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => onGoCheckIn?.()} className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><T k="당일 접수로 이동" /> →</button>
            <button onClick={resetForm} className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"><T k="새 환자 추가 등록" /></button>
          </div>
        </div>
        {/* 초진 동의 — 환자가 직접(태블릿·휴대폰·종이 스캔). 종전 '동의서 태블릿 전송'은 수술·시술 동의서 화면으로 갔다 */}
        <RegistrationConsentCollector patientId={created.id} />
        <p className="text-center text-[11px] text-gray-500"><T k="지금 받지 못하면 환자 차트 동의서 탭이나 원무 워크스테이션에서 이어 받을 수 있습니다." /></p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto overflow-y-auto h-full pr-1">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {/* 헤더 + 신분증 OCR 인라인 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-gray-900"><T k="신규 환자 등록" /></h3>
          <div className="flex items-center gap-2 bg-indigo-50/50 border border-dashed border-indigo-200 rounded-xl pl-3 pr-1.5 py-1">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={ocrConsent} onChange={(e) => setOcrConsent(e.target.checked)} className="w-3.5 h-3.5" />
              <T k="신분증 OCR 동의" />
            </label>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={ocrLoading || !ocrConsent}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
              {ocrLoading ? <T k="인식 중..." /> : <>📷 <T k="신분증 인식" /></>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onIdImage(f); }} />
          </div>
        </div>

        {/* 사진 + 기본 정보 (좌우) */}
        <div className="flex gap-4 items-start">
          <div className="flex-shrink-0">
            <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="사진" /></label>
            <PatientPhotoCapture value={photo} onChange={setPhoto} />
          </div>
          <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3 gap-y-2">
            <Field label={tt('성')}><input ref={familyRef} value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="홍" className={inp} /></Field>
            <Field label={tt('이름')}><input ref={givenRef} value={givenName} onChange={(e) => setGivenName(e.target.value)} placeholder="길동" className={inp} /></Field>
            <Field label={tt('성별')}>
              <div className="flex gap-1.5">
                {[['MALE', '남'], ['FEMALE', '여']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setGender(v as 'MALE' | 'FEMALE')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium ${gender === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={l} /></button>
                ))}
              </div>
            </Field>
            <Field label={tt('생년월일')} hint={dobPreview ? `→${dobPreview}` : tt('8자리')}>
              <input ref={birthRef} value={birth} onChange={(e) => setBirth(e.target.value)} placeholder="19900101" className={inp} inputMode="numeric" maxLength={10} />
            </Field>
            <Field label={tt('연락처')}><input ref={phoneRef} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" className={inp} inputMode="numeric" /></Field>
            <Field label={tt('보험유형')}>
              <select value={insuranceType} onChange={(e) => setInsuranceType(e.target.value)} className={inp}>
                <option value="NHI">{tt('건강보험')}</option><option value="MEDICAID">{tt('의료급여')}</option><option value="AUTO">{tt('자동차보험')}</option><option value="INDUSTRIAL">{tt('산재보험')}</option><option value="SELF_PAY">{tt('비급여')}</option>
              </select>
            </Field>
            <div className="sm:col-span-2 xl:col-span-3">
              <Field label={tt('주민등록번호')} hint={tt('진료·청구 목적(의료법·건보법 근거)')}>
                <input value={rrn} onChange={(e) => applyRrn(e.target.value)} placeholder="######-#######" inputMode="numeric" className={inp} />
              </Field>
            </div>
          </div>
        </div>

        <Field label={tt('주소')}>
          <AddressSearch value={addr} onChange={setAddr} />
        </Field>

        {/* 동의 — 직원 체크박스가 아니라 등록 직후 환자가 직접(서명 증빙과 함께) */}
        <div className="bg-gray-50 rounded-xl px-3 py-2" data-np-consent-note>
          <p className="text-xs text-gray-700"><T k="초진 동의서(10종)는 등록 직후 환자가 직접 고르고 서명합니다 — 태블릿 · 환자 휴대폰 · 종이 출력 후 스캔 등록." /></p>
          <p className="text-[10px] text-gray-400 mt-1">ⓘ <T k="주민등록번호는 의료법·건보법에 따라 진료·청구 목적으로 암호화 보관(개보법 §24-2)." /></p>
        </div>

        <button onClick={() => mut.mutate()} disabled={!canSubmit}
          className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {mut.isPending ? <T k="등록 중..." /> : <T k="환자 등록" />}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none';
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-0.5">{label}{hint && <span className="ml-1 text-gray-400 font-normal">{hint}</span>}</label>
      {children}
    </div>
  );
}
