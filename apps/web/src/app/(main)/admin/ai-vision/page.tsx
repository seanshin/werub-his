'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const MODALITIES = [
  { value: 'xray', label: 'X-ray' },
  { value: 'ct', label: 'CT' },
  { value: 'mri', label: 'MRI' },
  { value: 'ultrasound', label: '초음파' },
  { value: 'pathology', label: '병리' },
  { value: 'fundus', label: '안저' },
  { value: 'dermoscopy', label: '피부경' },
];

const BODY_PARTS = ['chest', 'abdomen', 'brain', 'spine', 'extremity', 'pelvis', 'neck'];

/** UUID 완전일치 — 감사 귀속용. 형식이 아니면 서버로 보내지 않는다(추정 금지). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 🔴 W8-R6/C — 의료영상(최대 15MB)이 **동의 확인 없이** 외부 AI 서버로 나가던 화면.
 * 같은 컨트롤러의 신분증 OCR(id-ocr)에는 CONSENT_REQUIRED 게이트가 있었는데 이 경로에만 없었다.
 * 이제 서버가 `consent` 없이는 CONSENT_REQUIRED 를 돌려주며, 이 화면이 동의 확인을 받는다.
 */
export default function AiVisionPage() {
  const tAttr = useTAttr();
  const [modality, setModality] = useState('xray');
  const [bodyPart, setBodyPart] = useState('chest');
  const [clinicalInfo, setClinicalInfo] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ findings?: string; impression?: string; recommendations?: string; model?: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      setImageBase64(dataUrl.split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  const trimmedPid = patientId.trim();
  const pidValid = trimmedPid === '' || UUID_RE.test(trimmedPid);

  const handleAnalyze = async () => {
    if (!imageBase64) { toast.error('이미지를 업로드하세요'); return; }
    if (!consent) { toast.error('외부 AI 전송 동의 확인이 필요합니다'); return; }
    if (!pidValid) { toast.error('환자 UUID 형식이 올바르지 않습니다 — 모르면 비워 두세요'); return; }
    setLoading(true);
    setResult(null);
    setFailure(null);
    try {
      const res = await apiClient.fetch<{
        data?: { findings?: string; impression?: string; recommendations?: string; model?: string };
        error?: { code: string; message: string };
      }>('/api/v1/ai/vision/medical/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64, modality, bodyPart, clinicalInfo,
          consent,
          ...(trimmedPid ? { patientId: trimmedPid } : {}), // 모르면 보내지 않는다(감사에 추정값 금지)
        }),
      });
      if (res.error) { setFailure(res.error.message); toast.error(res.error.message); }
      else setResult(res.data ?? null);
    } catch (e) {
      // 🔴 실패를 "판독 결과 없음"으로 흘리지 않는다 — 사유를 화면에 남긴다.
      const msg = e instanceof Error ? e.message : `${AI_ORIGIN_TEXT} 분석 실패`;
      setFailure(msg);
      toast.error(msg);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">의료 영상 {AI_ORIGIN_TEXT} 분석</h1>
        <p className="text-sm text-gray-500 mt-1"><T k="MedGemma 4B — X-ray/CT/MRI/초음파/병리/안저/피부경" /></p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 입력 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700"><T k="영상 업로드" /></h2>

          <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            {imagePreview ? (
              <img src={imagePreview} alt="preview" className="max-h-48 mx-auto rounded-lg" />
            ) : (
              <div className="py-8">
                <p className="text-gray-400 text-sm"><T k="이미지를 드래그하거나 클릭하여 업로드" /></p>
                <p className="text-gray-300 text-xs mt-1"><T k="JPG, PNG 지원" /></p>
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer" style={{ position: 'relative' }} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="검사 유형" /></label>
              <select value={modality} onChange={e => setModality(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
                {MODALITIES.map(m => <option key={m.value} value={m.value}>{tAttr(m.label)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block"><T k="부위" /></label>
              <select value={bodyPart} onChange={e => setBodyPart(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
                {BODY_PARTS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <textarea value={clinicalInfo} onChange={e => setClinicalInfo(e.target.value)} rows={2}
            placeholder={tAttr('임상 정보 (증상, 병력 등)')}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm resize-none" />

          <div>
            <label className="text-xs text-gray-500 mb-1 block"><T k="환자 UUID (선택 — 감사 귀속용)" /></label>
            <input value={patientId} onChange={e => setPatientId(e.target.value)}
              placeholder={tAttr('모르면 비워 두세요 (추정 입력 금지)')}
              className={`w-full px-3 py-2 border rounded-xl text-sm font-mono ${pidValid ? 'border-gray-200' : 'border-red-300 bg-red-50'}`} />
            {!pidValid && <p className="text-[10px] text-red-500 mt-1"><T k="UUID 형식이 아닙니다" /></p>}
          </div>

          {/* 🔴 외부 전송 동의 게이트 — id-ocr 과 동일 계약(CONSENT_REQUIRED) */}
          <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
            <span className="text-[11px] text-amber-800">
              이 의료영상을 <strong>외부 AI 서버(WeRU.B)로 전송</strong>하는 데 대한 환자 동의를 확인했습니다.
              <span className="block text-amber-600 mt-0.5"><T k="동의 없이는 전송할 수 없습니다(개인정보보호법·의료법)." /></span>
            </span>
          </label>

          <button onClick={handleAnalyze} disabled={loading || !imageBase64 || !consent || !pidValid}
            className="w-full px-4 py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-30">
            {loading ? `${AI_ORIGIN_TEXT} 분석 중...` : `${AI_ORIGIN_TEXT} 판독 요청`}
          </button>
        </div>

        {/* 결과 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">{AI_ORIGIN_TEXT} 판독 결과</h2>
          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
          ) : failure ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700 font-medium"><T k="판독 실패" /></p>
              <p className="text-xs text-red-600 mt-1">{failure}</p>
              <p className="text-[10px] text-red-500 mt-1"><T k="결과가 비어 있는 것은 “이상 소견 없음”을 뜻하지 않습니다." /></p>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {result.findings && (
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-[10px] text-blue-500 font-bold mb-1"><T k="소견 (Findings)" /></p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.findings}</p>
                </div>
              )}
              {result.impression && (
                <div className="bg-violet-50 rounded-xl p-4">
                  <p className="text-[10px] text-violet-500 font-bold mb-1"><T k="판독 소견 (Impression)" /></p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.impression}</p>
                </div>
              )}
              {result.recommendations && (
                <div className="bg-amber-50 rounded-xl p-4">
                  <p className="text-[10px] text-amber-600 font-bold mb-1"><T k="권고 사항" /></p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.recommendations}</p>
                </div>
              )}
              {result.model && <p className="text-[10px] text-gray-400"><T k="모델" />: {result.model}</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-16">이미지 업로드 후 {AI_ORIGIN_TEXT} 판독을 요청하세요</p>
          )}

          <div className="mt-4 bg-red-50 rounded-xl p-3 border border-red-200">
            <p className="text-[11px] text-red-600">{AI_ORIGIN_TEXT} 참고용 분석입니다. 최종 판독은 반드시 영상의학과 전문의가 수행해야 합니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
