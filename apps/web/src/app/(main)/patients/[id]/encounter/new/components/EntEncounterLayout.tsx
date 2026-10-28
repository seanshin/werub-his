'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import TympanicDiagram, { type TympanicData } from '@/components/specialty/TympanicDiagram';
import AudiogramChart, { type AudiogramPoint } from '@/components/specialty/AudiogramChart';
import NasalDiagram, { type TurbinateStatus } from '@/components/specialty/NasalDiagram';
import { AiAssistantPanel } from './AiAssistantPanel';
import EncounterActionBar from './EncounterActionBar';
import { type BaseEncounterLayoutProps } from './shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface EntExamForm {
  otoscopyRight: { status: string; lightReflex: string };
  otoscopyLeft: { status: string; lightReflex: string };
  audiogramRight: AudiogramPoint[];
  audiogramLeft: AudiogramPoint[];
  ptaOd: string;
  ptaOs: string;
  speechOd: string;
  speechOs: string;
  septum: string;
  septumDeviation: string;
  turbinateLeft: string;
  turbinateRight: string;
  polyp: string;
  tonsilGrade: string;
  vocalCord: string;
  diagnosis: string;
  plan: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TM_STATUS = ['정상', '충혈', '팽륜', '삼출', '천공', '함몰', '고막관'];
const LIGHT_REFLEX = ['+', '-', '약화'];
const SEPTUM_STATUS = ['정상', '좌측 만곡', '우측 만곡', 'S자 만곡'];
const TURBINATE_STATUS = ['정상', '비후', '창백', '충혈'];
const POLYP_STATUS = ['없음', 'Grade 1', 'Grade 2', 'Grade 3'];
const TONSIL_GRADES = ['Grade 0', 'Grade I', 'Grade II', 'Grade III', 'Grade IV'];
const VOCAL_CORD_STATUS = ['정상', '충혈', '부종', '결절', '용종', '마비'];

/**
 * 🔴 쓰기 폼의 초기값은 **미선택/미측정**이다 (임상 UX §2 — 입력 보조 축 P3 심사에서 적발·2026-08-25 봉합).
 *    종전엔 청력도가 **정상 청력(20~30dB)으로 채워진 채** 시작하고 고막·비강·인후 전부 '정상'류로
 *    시작해 — **측정·검진하지 않으면 정상 소견이 저장됐다**(간호초기평가 '전부 정상' 사고와 동일 유형).
 *    청력도는 빈 차트로 시작한다(차트가 빈 배열을 지원: 마커 없음·PTA=산출 불가) — 잰 주파수만 점이 찍힌다.
 *    부분 검사는 정당하다 — 저장 시 **미검진 항목은 보내지 않는다**(강제하면 거짓 데이터).
 */
const defaultForm: EntExamForm = {
  otoscopyRight: { status: '', lightReflex: '' },
  otoscopyLeft: { status: '', lightReflex: '' },
  audiogramRight: [],
  audiogramLeft: [],
  ptaOd: '', ptaOs: '', speechOd: '', speechOs: '',
  septum: '', septumDeviation: '',
  turbinateLeft: '', turbinateRight: '',
  polyp: '',
  tonsilGrade: '', vocalCord: '',
  diagnosis: '', plan: '',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EntEncounterLayout({
  patientId,
  encounterId,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: BaseEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [form, setForm] = useState<EntExamForm>(defaultForm);
  const [soapOpen, setSoapOpen] = useState(false);
  const [soapCombined, setSoapCombined] = useState({ so: '', ap: '' });

  // Save exam
  const saveMutation = useMutation({
    mutationFn: (data: EntExamForm) =>
      apiClient.post<{ data: unknown }>('/api/v1/ent/exam', {
        ...data,
        patientId,
        encounterId,
      }),
    onSuccess: () => toast.success('이비인후과 검사가 저장되었습니다.'),
    onError: () => toast.error('검사 저장에 실패했습니다.'),
  });

  /**
   * 🔴 서버 계약(CreateEntExamDto)대로 매핑해서 보낸다 — §입력보조 P3 후속(2026-08-25).
   *    종전엔 폼 키를 그대로 보냈는데 DTO 에 없는 키가 태반이라 전역 whitelist 가 **조용히 지웠다**:
   *    ptaOd/ptaOs/speechOd/speechOs(DTO 는 ptaRight/ptaLeft/speechRight/speechLeft) ·
   *    비강 5필드(DTO 는 nasalEndoscopy JSON) · 인후 2필드(DTO 는 pharynxExam JSON) · plan(DTO 는 notes).
   *    → **의사가 입력한 PTA·어음명료도·비강·인후 소견·치료계획이 성공 토스트와 함께 사라졌다**
   *    (이연 회수 축의 "whitelist 가 진료 입력을 조용히 삭제" — 비뇨 IPSS·산부인과 전량 소실과 동일 유형).
   *    `soap` 키도 DTO 에 없어 버려지고 있었다 — SOAP 은 EncounterActionBar(진료 차트 경로)가 정본이라 여기선 뺀다.
   *    미검진 항목은 보내지 않는다 — 빈 값을 보내면 "검진했는데 무소견"과 구분할 수 없다.
   */
  const buildExamPayload = (f: EntExamForm): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const num = (v: string) => (v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    const oto = (o: { status: string; lightReflex: string }) => {
      const inner = Object.fromEntries(Object.entries(o).filter(([, iv]) => iv !== ''));
      return Object.keys(inner).length > 0 ? inner : undefined;
    };
    const set = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };

    set('otoscopyRight', oto(f.otoscopyRight));
    set('otoscopyLeft', oto(f.otoscopyLeft));
    if (f.audiogramRight.length > 0) out.audiogramRight = f.audiogramRight;
    if (f.audiogramLeft.length > 0) out.audiogramLeft = f.audiogramLeft;
    set('ptaRight', num(f.ptaOd));
    set('ptaLeft', num(f.ptaOs));
    set('speechRight', num(f.speechOd));
    set('speechLeft', num(f.speechOs));
    // 🔴 내부 키는 읽는 쪽 정본(ent/page nasalText: septum·turbinate{left,right}·polyp)에 맞춘다 —
    //    writer 가 다른 키를 쓰면 저장은 되는데 화면이 '기록 없음'으로 읽는다(정본이 둘)
    const nasal: Record<string, unknown> = {};
    if (f.septum !== '') nasal.septum = f.septumDeviation !== '' ? `${f.septum} (${f.septumDeviation})` : f.septum;
    const turb = Object.fromEntries(
      Object.entries({ left: f.turbinateLeft, right: f.turbinateRight }).filter(([, v]) => v !== ''),
    );
    if (Object.keys(turb).length > 0) nasal.turbinate = turb;
    if (f.polyp !== '') nasal.polyp = f.polyp;
    if (Object.keys(nasal).length > 0) out.nasalEndoscopy = nasal;
    const pharynx = Object.fromEntries(
      Object.entries({ tonsilGrade: f.tonsilGrade, vocalCord: f.vocalCord }).filter(([, v]) => v !== ''),
    );
    if (Object.keys(pharynx).length > 0) out.pharynxExam = pharynx;
    if (f.diagnosis !== '') out.diagnosis = f.diagnosis;
    if (f.plan !== '') out.notes = f.plan;
    return out;
  };

  const handleSaveExam = () => {
    if (!encounterId) return;
    saveMutation.mutate(buildExamPayload(form) as unknown as EntExamForm);
  };

  const updateField = (field: keyof EntExamForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAudiogramChange = (ear: 'right' | 'left', data: AudiogramPoint[]) => {
    if (ear === 'right') {
      setForm((prev) => ({ ...prev, audiogramRight: data }));
    } else {
      setForm((prev) => ({ ...prev, audiogramLeft: data }));
    }
  };

  // Build props for TympanicDiagram
  const tympanicRight: TympanicData = {
    status: form.otoscopyRight.status,
    lightReflex: form.otoscopyRight.lightReflex === '+',
    findings: form.otoscopyRight.status && form.otoscopyRight.status !== '정상' ? form.otoscopyRight.status : undefined,
  };
  const tympanicLeft: TympanicData = {
    status: form.otoscopyLeft.status,
    lightReflex: form.otoscopyLeft.lightReflex === '+',
    findings: form.otoscopyLeft.status && form.otoscopyLeft.status !== '정상' ? form.otoscopyLeft.status : undefined,
  };

  // Build NasalDiagram props
  const nasalSeptum = {
    status: form.septum,
    deviation: form.septumDeviation === '좌측' ? 'left' as const : form.septumDeviation === '우측' ? 'right' as const : undefined,
  };
  const leftTurbinates: TurbinateStatus[] = [{ status: form.turbinateLeft }];
  const rightTurbinates: TurbinateStatus[] = [{ status: form.turbinateRight }];

  const selectCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = () => ({ subjective: soapCombined.so || undefined, assessment: soapCombined.ap || undefined });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Left: ENT exam form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            <T k="이비인후과 검사" />
          </h3>

          {/* Otoscopy */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="이경 (Otoscopy)" /></p>
            <div className="flex justify-center gap-6 mb-3">
              <TympanicDiagram right={tympanicRight} left={tympanicLeft} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(['Right', 'Left'] as const).map((side) => {
                const key = `otoscopy${side}` as 'otoscopyRight' | 'otoscopyLeft';
                return (
                  <div key={side} className="space-y-2">
                    <span className="text-[10px] font-semibold text-gray-500">{side === 'Right' ? 'R (우측)' : 'L (좌측)'}</span>
                    <div>
                      <label className={labelCls}><T k="고막 상태" /></label>
                      <select
                        value={form[key].status}
                        onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], status: e.target.value } }))}
                        disabled={!encounterId}
                        className={selectCls}
                      >
                        <option value=""><T k="미검진" /></option>{TM_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}><T k="광추" /></label>
                      <select
                        value={form[key].lightReflex}
                        onChange={(e) => setForm((prev) => ({ ...prev, [key]: { ...prev[key], lightReflex: e.target.value } }))}
                        disabled={!encounterId}
                        className={selectCls}
                      >
                        <option value=""><T k="미검진" /></option>{LIGHT_REFLEX.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audiometry */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="청력 (Audiometry)" /></p>
            <AudiogramChart
              rightAC={form.audiogramRight}
              leftAC={form.audiogramLeft}
              mode={encounterId ? 'edit' : 'view'}
              onDataChange={handleAudiogramChange}
            />
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div>
                <label className={labelCls}>PTA OD (dB)</label>
                <input type="text" value={form.ptaOd} onChange={(e) => updateField('ptaOd', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PTA OS (dB)</label>
                <input type="text" value={form.ptaOs} onChange={(e) => updateField('ptaOs', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="어음 OD (%)" /></label>
                <input type="text" value={form.speechOd} onChange={(e) => updateField('speechOd', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="어음 OS (%)" /></label>
                <input type="text" value={form.speechOs} onChange={(e) => updateField('speechOs', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Nasal */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="비강 (Nasal)" /></p>
            <NasalDiagram
              septum={nasalSeptum}
              leftTurbinates={leftTurbinates}
              rightTurbinates={rightTurbinates}
            />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className={labelCls}><T k="비중격" /></label>
                <select value={form.septum} onChange={(e) => updateField('septum', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{SEPTUM_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="비용종" /></label>
                <select value={form.polyp} onChange={(e) => updateField('polyp', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{POLYP_STATUS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="하비갑개 L" /></label>
                <select value={form.turbinateLeft} onChange={(e) => updateField('turbinateLeft', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{TURBINATE_STATUS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="하비갑개 R" /></label>
                <select value={form.turbinateRight} onChange={(e) => updateField('turbinateRight', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{TURBINATE_STATUS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Pharynx */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="인후 (Pharynx)" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}><T k="편도" /></label>
                <select value={form.tonsilGrade} onChange={(e) => updateField('tonsilGrade', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{TONSIL_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="성대" /></label>
                <select value={form.vocalCord} onChange={(e) => updateField('vocalCord', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="미검진" /></option>{VOCAL_CORD_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Diagnosis & Plan */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={labelCls}><T k="진단" /></label>
              <textarea rows={2} value={form.diagnosis} onChange={(e) => updateField('diagnosis', e.target.value)} disabled={!encounterId} placeholder={tAttr("진단명...")} className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className={labelCls}><T k="계획" /></label>
              <textarea rows={2} value={form.plan} onChange={(e) => updateField('plan', e.target.value)} disabled={!encounterId} placeholder={tAttr("치료 계획...")} className={`${inputCls} resize-none`} />
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSaveExam}
            disabled={!encounterId || saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 저장'}
          </button>
        </div>

        {/* Right: AI Panel (collapsed by default) */}
        <div className="hidden lg:block">
          <AiAssistantPanel
            patientId={patientId}
            soap={{ subjective: '', objective: '', assessment: form.diagnosis, plan: form.plan }}
            encounterId={encounterId}
            onApplySoap={() => {}}
          />
        </div>
      </div>

      {/* Collapsible SOAP */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <button
          onClick={() => setSoapOpen(!soapOpen)}
          className="w-full flex items-center justify-between px-6 py-3"
        >
          <span className="text-sm font-semibold text-gray-700"><T k="SOAP 노트 (간소)" /></span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${soapOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {soapOpen && (
          <div className="px-6 pb-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1"><T k="S + O (주관/객관)" /></label>
              <textarea rows={3} value={soapCombined.so} onChange={(e) => setSoapCombined({ ...soapCombined, so: e.target.value })} disabled={!encounterId} placeholder={tAttr("주관적 증상 및 객관적 소견...")} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1"><T k="A + P (평가/계획)" /></label>
              <textarea rows={3} value={soapCombined.ap} onChange={(e) => setSoapCombined({ ...soapCombined, ap: e.target.value })} disabled={!encounterId} placeholder={tAttr("진단 및 치료 계획...")} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300" />
            </div>
          </div>
        )}
      </div>

      {rxSlot}
      <EncounterActionBar encounterId={encounterId} onSaveDraft={() => onSaveDraft(buildSoap())} onSignAndBill={() => onSignAndBill(buildSoap())} isSaving={isSaving} isSigning={isSigning} extraSaving={saveMutation.isPending} statusText="이비인후과 검사" />
    </div>
  );
}
