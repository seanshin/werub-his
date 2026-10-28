'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Tab = 'ask' | 'auto-check' | 'consent' | 'record' | 'report' | 'ad-check';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'ask', label: '법률 질의', icon: '⚖️' },
  { key: 'auto-check', label: '통합 법적검사', icon: '🔍' },
  { key: 'consent', label: '인폼드 컨센트', icon: '📋' },
  { key: 'record', label: '의무기록 검사', icon: '📝' },
  { key: 'report', label: '감염병 신고', icon: '🦠' },
  { key: 'ad-check', label: '광고 검토', icon: '📢' },
];

export default function MedicalLawPage() {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<Tab>('ask');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  // Ask
  const [question, setQuestion] = useState('');

  // Auto-check
  const [record, setRecord] = useState('');
  const [diagnoses, setDiagnoses] = useState('');
  const [procedures, setProcedures] = useState('');

  // Consent
  const [procedure, setProcedure] = useState('');

  // Record check
  const [recordText, setRecordText] = useState('');

  // Report
  const [diagList, setDiagList] = useState('');

  // Ad check
  const [adContent, setAdContent] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    try {
      let res: { data: Record<string, unknown> };
      switch (tab) {
        case 'ask':
          res = await apiClient.fetch('/api/v1/ai/law/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
          break;
        case 'auto-check':
          res = await apiClient.fetch('/api/v1/ai/law/auto-check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              record,
              diagnoses: diagnoses ? diagnoses.split(',').map(d => { const [name, code] = d.trim().split(':'); return { diagnosis_ko: name, icd10: code || '' }; }) : undefined,
              procedures: procedures ? procedures.split(',').map(p => p.trim()) : undefined,
            }),
          });
          break;
        case 'consent':
          res = await apiClient.fetch('/api/v1/ai/law/guide/informed-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ procedure }) });
          break;
        case 'record':
          res = await apiClient.fetch('/api/v1/ai/law/check/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record: recordText }) });
          break;
        case 'report':
          res = await apiClient.fetch('/api/v1/ai/law/check/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ diagnoses: diagList.split(',').map(d => { const [name, code] = d.trim().split(':'); return { diagnosis_ko: name, icd10: code || '' }; }) }),
          });
          break;
        case 'ad-check':
          res = await apiClient.fetch('/api/v1/ai/law/guide/advertisement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: adContent }) });
          break;
        default:
          return;
      }
      setResult(res.data);
    } catch (err) {
      toast.error(`${AI_ORIGIN_TEXT} 서버 요청 실패`);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">의료법 {AI_ORIGIN_TEXT} 어시스턴트</h1>
        <p className="text-sm text-gray-500 mt-1">의료법/개인정보보호법/감염병예방법 {AI_ORIGIN_TEXT} 검사 + 가이드 (v2.53.0)</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setResult(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 입력 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">{TABS.find(t => t.key === tab)?.icon} <T k={TABS.find(t => t.key === tab)?.label ?? ''} /></h2>

          {tab === 'ask' && (
            <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={5}
              placeholder={tAttr('의료법 관련 질문을 입력하세요.&#10;예: 의무기록 보관 기간은 얼마인가요?')}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none" />
          )}

          {tab === 'auto-check' && (
            <>
              <textarea value={record} onChange={e => setRecord(e.target.value)} rows={4}
                placeholder={tAttr('의무기록 (SOAP 형식)&#10;S: 두통 3일&#10;O: BP 140/90&#10;A: 긴장성 두통&#10;P: 진통제 처방')}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none" />
              <input value={diagnoses} onChange={e => setDiagnoses(e.target.value)}
                placeholder={tAttr('진단명:ICD (쉼표 구분) — 예: 결핵:A15, 폐렴:J18')}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
              <input value={procedures} onChange={e => setProcedures(e.target.value)}
                placeholder={tAttr('시술 (쉼표 구분) — 예: 내시경 검사, 조직검사')}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
            </>
          )}

          {tab === 'consent' && (
            <input value={procedure} onChange={e => setProcedure(e.target.value)}
              placeholder={tAttr('시술/수술명 — 예: 위내시경, 전신마취, 관절경 수술')}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
          )}

          {tab === 'record' && (
            <textarea value={recordText} onChange={e => setRecordText(e.target.value)} rows={6}
              placeholder={tAttr('의무기록 전문을 입력하세요.&#10;의료법 제22조 기재사항 검사를 수행합니다.')}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none" />
          )}

          {tab === 'report' && (
            <input value={diagList} onChange={e => setDiagList(e.target.value)}
              placeholder={tAttr('진단명:ICD (쉼표 구분) — 예: 결핵:A15, 홍역:B05')}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
          )}

          {tab === 'ad-check' && (
            <textarea value={adContent} onChange={e => setAdContent(e.target.value)} rows={4}
              placeholder={tAttr('의료 광고 내용을 입력하세요.&#10;의료법 제56조 위반 여부를 검토합니다.')}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm resize-none" />
          )}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full px-4 py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {loading ? `${AI_ORIGIN_TEXT} 분석 중...` : `${AI_ORIGIN_TEXT} 검사 실행`}
          </button>
        </div>

        {/* 결과 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">{AI_ORIGIN_TEXT} 분석 결과</h2>
          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
          ) : result ? (
            <div className="space-y-3 text-sm max-h-[500px] overflow-y-auto">
              <ResultRenderer data={result} />
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400 text-sm">
              좌측에서 입력 후 {AI_ORIGIN_TEXT} 검사를 실행하세요
            </div>
          )}
        </div>
      </div>

      {/* 안내 */}
      <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
        <p className="text-xs text-amber-700">
          {AI_ORIGIN_TEXT} 법률 분석은 참고용입니다. 실제 법적 판단은 전문 법률가에게 확인하세요.
          DB: 20개 법률 조문, 20종 감염병, 의료법/약사법/감염병예방법/응급의료법/환자안전법
        </p>
      </div>
    </div>
  );
}

function ResultRenderer({ data }: { data: Record<string, unknown> }) {
  if (!data) return null;

  return (
    <>
      {Object.entries(data).map(([key, value]) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
          return (
            <div key={key} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-1 font-mono">{key}</p>
              <p className="text-gray-700 whitespace-pre-wrap">{value}</p>
            </div>
          );
        }
        if (typeof value === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2 p-2">
              <span className={`w-3 h-3 rounded-full ${value ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-gray-700">{key}: {value ? <T k="예" /> : <T k="아니오" />}</span>
            </div>
          );
        }
        if (Array.isArray(value)) {
          return (
            <div key={key} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-2 font-mono">{key} ({value.length}<Unit>건</Unit>)</p>
              {value.map((item, i) => (
                <div key={i} className="border-l-2 border-blue-300 pl-3 mb-2 text-xs text-gray-600">
                  {typeof item === 'string' ? item : <pre className="whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre>}
                </div>
              ))}
            </div>
          );
        }
        if (typeof value === 'object') {
          return (
            <div key={key} className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-1 font-mono">{key}</p>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
            </div>
          );
        }
        return (
          <div key={key} className="flex items-center justify-between p-2 text-gray-700">
            <span className="text-gray-400">{key}</span>
            <span className="font-medium">{String(value)}</span>
          </div>
        );
      })}
    </>
  );
}
