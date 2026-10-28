'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlasticEncounterLayoutProps {
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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BODY_PARTS = [
  '안면 - 이마', '안면 - 눈꺼풀', '안면 - 코', '안면 - 입술', '안면 - 턱',
  '안면 - 귀', '안면 - 볼',
  '두피', '목', '가슴', '복부', '등',
  '상지 - 상완', '상지 - 전완', '상지 - 수부',
  '하지 - 대퇴', '하지 - 하퇴', '하지 - 족부',
];

const PROCEDURE_TYPES = [
  '봉합술', '피판술', '피부이식', '지방이식', '지방흡입',
  '안검성형', '비성형', '안면거상', '유방재건', '유방축소',
  '유방확대', '복부성형', '반흔교정', '레이저치료', '보톡스',
  '필러', '켈로이드 치료', '화상 치료', '미세수술', '기타',
];

const ANESTHESIA_TYPES = ['국소마취', '부분마취', '전신마취', '수면마취', '무마취'];

const MATERIALS = [
  'Nylon', 'Prolene', 'Vicryl', 'PDS', 'Silk', 'Chromic',
  '실리콘 보형물', '자가지방', '히알루론산 필러', 'ePTFE', 'AlloDerm',
  '티타늄 플레이트', '흡수성 플레이트', '기타',
];

const FITZPATRICK_TYPES = [
  { value: 'I', label: 'I - 항상 화상, 태닝 안 됨', color: '#FFF5EB' },
  { value: 'II', label: 'II - 쉽게 화상, 약간 태닝', color: '#FCEBD0' },
  { value: 'III', label: 'III - 가끔 화상, 서서히 태닝', color: '#E8C99B' },
  { value: 'IV', label: 'IV - 거의 화상 없음, 쉽게 태닝', color: '#C9A06E' },
  { value: 'V', label: 'V - 화상 드묾, 짙은 태닝', color: '#8B6F47' },
  { value: 'VI', label: 'VI - 화상 없음, 매우 짙은 피부', color: '#5C4033' },
];

const PHOTO_ANGLES = ['정면', '좌측 45도', '좌측 90도', '우측 45도', '우측 90도', '하방'];

const SKIN_ELASTICITY = ['매우 좋음', '좋음', '보통', '약간 저하', '저하'];
const SCAR_TENDENCY = ['정상', '비후성 반흔 경향', '켈로이드 경향', '위축성 반흔 경향'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PlasticEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: PlasticEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [bodyPart, setBodyPart] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState('');
  const [material, setMaterial] = useState('');
  const [duration, setDuration] = useState('');
  const [fitzpatrick, setFitzpatrick] = useState('III');
  const [skinElasticity, setSkinElasticity] = useState('보통');
  const [scarTendency, setScarTendency] = useState('정상');
  const [findings, setFindings] = useState('');

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/plastic/exams', {
        patientId,
        encounterId,
        bodyPart,
        procedure: procedureName,
        anesthesiaType,
        material,
        duration: duration ? parseInt(duration) : undefined,
        // 모델 fitzpatrickType은 Int(I~VI) — 로마숫자 라벨을 1~6으로 변환
        fitzpatrickType: FITZPATRICK_TYPES.findIndex((f) => f.value === fitzpatrick) + 1 || undefined,
        skinElasticity,
        scarTendency,
        diagnosis: findings,
      }),
    onSuccess: () => toast.success('성형외과 기록이 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => ({
    objective: findings || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Procedure Info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
            </svg>
            <T k="시술 정보" />
          </h3>

          {/* Body Part */}
          <div>
            <label className={labelCls}><T k="부위" /></label>
            <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} disabled={!encounterId} className={inputCls}>
              <option value=""><T k="부위 선택..." /></option>
              {BODY_PARTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Procedure Name */}
          <div>
            <label className={labelCls}><T k="시술명" /></label>
            <select value={procedureName} onChange={(e) => setProcedureName(e.target.value)} disabled={!encounterId} className={inputCls}>
              <option value=""><T k="시술 선택..." /></option>
              {PROCEDURE_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Anesthesia + Material + Duration */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}><T k="마취" /></label>
              <select value={anesthesiaType} onChange={(e) => setAnesthesiaType(e.target.value)} disabled={!encounterId} className={inputCls}>
                <option value=""><T k="선택..." /></option>
                {ANESTHESIA_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}><T k="재료" /></label>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} disabled={!encounterId} className={inputCls}>
                <option value=""><T k="선택..." /></option>
                {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}><T k="소요시간 (분)" /></label>
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="분" />
            </div>
          </div>

          {/* Fitzpatrick Type */}
          <div>
            <label className={labelCls}><T k="Fitzpatrick 피부 유형" /></label>
            <div className="grid grid-cols-3 gap-2">
              {FITZPATRICK_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  onClick={() => setFitzpatrick(ft.value)}
                  disabled={!encounterId}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                    fitzpatrick === ft.value ? 'border-blue-400 bg-blue-50 font-medium' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: ft.color }} />
                  <span className="text-gray-700 truncate">{ft.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Skin Elasticity & Scar Tendency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}><T k="피부 탄력도" /></label>
              <select value={skinElasticity} onChange={(e) => setSkinElasticity(e.target.value)} disabled={!encounterId} className={inputCls}>
                {SKIN_ELASTICITY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}><T k="반흔 경향" /></label>
              <select value={scarTendency} onChange={(e) => setScarTendency(e.target.value)} disabled={!encounterId} className={inputCls}>
                {SCAR_TENDENCY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Findings */}
          <div>
            <label className={labelCls}><T k="소견" /></label>
            <textarea
              rows={3}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder={tAttr("시술 소견을 입력하세요...")}
              disabled={!encounterId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={!encounterId || !bodyPart || !procedureName || saveMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '시술 기록 저장'}
          </button>
        </div>

        {/* Right: Photo Placeholders */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            <T k="사진 기록 (6 앵글)" />
          </h3>

          <div className="grid grid-cols-3 gap-3">
            {PHOTO_ANGLES.map((angle) => (
              <div
                key={angle}
                className="aspect-square border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="text-[10px] text-gray-400 font-medium">{angle}</span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-400 text-center">
            <T k="사진 업로드는 별도의 미디어 관리 시스템과 연동됩니다." />
          </p>

          {/* Quick reference: Fitzpatrick selected */}
          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="환자 피부 특성 요약" /></p>
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-600"><T k="Fitzpatrick 유형" /></span>
                <div className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border border-gray-300"
                    style={{ backgroundColor: FITZPATRICK_TYPES.find((f) => f.value === fitzpatrick)?.color }}
                  />
                  <span className="text-xs font-medium text-gray-700 whitespace-nowrap">Type {fitzpatrick}</span>
                </div>
              </div>
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-600"><T k="피부 탄력도" /></span>
                <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{skinElasticity}</span>
              </div>
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-600"><T k="반흔 경향" /></span>
                <span className={`text-xs font-medium whitespace-nowrap ${scarTendency !== '정상' ? 'text-amber-700' : 'text-gray-700'}`}>
                  {scarTendency}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            {bodyPart || '부위 미선택'} | {procedureName || '시술 미선택'} | Fitzpatrick {fitzpatrick}
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
