'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTfAttr } from '@/components/ui/i18n-text';

const FHIR_ENDPOINTS = [
  { label: 'CapabilityStatement', method: 'GET', path: '/fhir/R4/metadata' },
  { label: 'Patient 검색', method: 'GET', path: '/fhir/R4/Patient?name=김' },
  { label: 'Encounter 검색', method: 'GET', path: '/fhir/R4/Encounter' },
  { label: 'Condition 검색', method: 'GET', path: '/fhir/R4/Condition' },
  { label: 'Practitioner 검색', method: 'GET', path: '/fhir/R4/Practitioner' },
  { label: 'Organization', method: 'GET', path: '/fhir/R4/Organization' },
  { label: 'Medication 검색', method: 'GET', path: '/fhir/R4/Medication' },
  { label: 'SMART Configuration', method: 'GET', path: '/.well-known/smart-configuration' },
];

interface TestResult {
  endpoint: string;
  status: number | string;
  responseTime: number;
  success: boolean;
  data: unknown;
}

export default function InteroperabilityTestPage() {
  const tfAttr = useTfAttr();
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [customPath, setCustomPath] = useState('/fhir/R4/Patient');
  const [customMethod, setCustomMethod] = useState('GET');
  const [customBody, setCustomBody] = useState('');
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);

  const runTest = async (method: string, path: string) => {
    const start = Date.now();
    try {
      const res = method === 'GET'
        ? await apiClient.get(path)
        : await apiClient.post(path, JSON.parse(customBody || '{}'));
      const elapsed = Date.now() - start;
      return { endpoint: `${method} ${path}`, status: 200, responseTime: elapsed, success: true, data: (res as any)?.data ?? res };
    } catch (err: any) {
      const elapsed = Date.now() - start;
      return { endpoint: `${method} ${path}`, status: err?.response?.status ?? 'ERR', responseTime: elapsed, success: false, data: err?.response?.data ?? err.message };
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    setResults([]);
    const newResults: TestResult[] = [];
    for (const ep of FHIR_ENDPOINTS) {
      const result = await runTest(ep.method, ep.path);
      newResults.push(result);
      setResults([...newResults]);
    }
    setRunning(false);
    const passed = newResults.filter(r => r.success).length;
    toast.success(tfAttr('테스트 완료: {성공}/{전체} 성공', { 성공: passed, 전체: newResults.length }));
  };

  const runCustom = async () => {
    setRunning(true);
    const result = await runTest(customMethod, customPath);
    setResults(prev => [result, ...prev]);
    setSelectedResult(result);
    setRunning(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="연동 테스트 콘솔" /></h1>
        <p className="text-sm text-gray-500 mt-0.5"><T k="FHIR R4 엔드포인트 테스트 및 Bundle 유효성 검증" /></p>
      </div>

      {/* Quick Test */}
      <div className="bg-white rounded-2xl border shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="표준 엔드포인트 테스트" /></h3>
          <button
            onClick={runAllTests}
            disabled={running}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {running ? <T k="테스트 중..." /> : <T k="전체 테스트 실행" />}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {FHIR_ENDPOINTS.map((ep, i) => {
            const result = results.find(r => r.endpoint === `${ep.method} ${ep.path}`);
            return (
              <button
                key={i}
                onClick={() => result && setSelectedResult(result)}
                className={`text-left p-3 rounded-xl border text-xs transition-colors ${
                  result ? (result.success ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50') : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium text-gray-900"><T k={ep.label} /></div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5">{ep.method} {ep.path.split('?')[0]}</div>
                {result && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${result.success ? 'text-emerald-600' : 'text-red-600'}`}>{result.status}</span>
                    <span className="text-[10px] text-gray-400">{result.responseTime}ms</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Request */}
      <div className="bg-white rounded-2xl border shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="커스텀 요청" /></h3>
        <div className="flex gap-2 mb-3">
          <select value={customMethod} onChange={e => setCustomMethod(e.target.value)} className="px-3 py-2 border rounded-xl text-sm bg-white w-24">
            <option>GET</option><option>POST</option><option>PUT</option>
          </select>
          <input value={customPath} onChange={e => setCustomPath(e.target.value)} placeholder="/fhir/R4/Patient/..." className="flex-1 px-3 py-2 border rounded-xl text-sm font-mono" />
          <button onClick={runCustom} disabled={running} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium disabled:opacity-40">
            <T k="전송" />
          </button>
        </div>
        {customMethod !== 'GET' && (
          <textarea
            value={customBody}
            onChange={e => setCustomBody(e.target.value)}
            rows={4}
            placeholder='{"resourceType": "Bundle", "type": "transaction", "entry": [...]}'
            className="w-full px-3 py-2 border rounded-xl text-sm font-mono resize-none"
          />
        )}
      </div>

      {/* Response Viewer */}
      {selectedResult && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-gray-900"><T k="응답" /></span>
              <span className="ml-2 text-xs text-gray-400 font-mono">{selectedResult.endpoint}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold ${selectedResult.success ? 'text-emerald-600' : 'text-red-600'}`}>{selectedResult.status}</span>
              <span className="text-xs text-gray-400">{selectedResult.responseTime}ms</span>
              <button onClick={() => setSelectedResult(null)} className="text-xs text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
            </div>
          </div>
          <pre className="p-5 bg-gray-900 text-green-400 text-xs overflow-x-auto max-h-96 overflow-y-auto">
            {JSON.stringify(selectedResult.data, null, 2)}
          </pre>
        </div>
      )}

      {/* Results Summary */}
      {results.length > 0 && (
        <div className="bg-white rounded-2xl border shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="테스트 결과 요약" /></h3>
          <div className="flex gap-4 text-sm">
            <div><Tf k="{수} 성공" params={{ 수: <span className="text-emerald-600 font-bold">{results.filter(r => r.success).length}</span> }} /></div>
            <div><Tf k="{수} 실패" params={{ 수: <span className="text-red-600 font-bold">{results.filter(r => !r.success).length}</span> }} /></div>
            <div><Tf k="{시간} 평균 응답" params={{ 시간: <span className="text-gray-600 font-bold">{Math.round(results.reduce((sum, r) => sum + r.responseTime, 0) / results.length)}ms</span> }} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
