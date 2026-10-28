'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
];

const TONES = ['formal', 'casual', 'literary'];

export default function AiTranslatePage() {
  const tAttr = useTAttr();
  const [text, setText] = useState('');
  const [target, setTarget] = useState('en');
  const [tone, setTone] = useState('formal');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ translation?: string; source_lang?: string; target_lang?: string; tokens?: number; duration_ms?: number } | null>(null);

  const handleTranslate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiClient.fetch<{ data: typeof result }>('/api/v1/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target, tone }),
      });
      setResult(res.data);
    } catch { toast.error(tAttr('번역 실패')); }
    setLoading(false);
  };

  const targetLang = LANGUAGES.find(l => l.code === target);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{AI_ORIGIN_TEXT} <T k="번역@제목" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="7개 언어 번역 — 해외환자 소견서, CRM 메시지, 의료 문서용" /></p>
      </div>

      {/* 언어 선택 */}
      <div className="flex items-center gap-4">
        <div className="flex-1 text-center">
          <p className="text-xs text-gray-500 mb-2"><T k="원본" /></p>
          <div className="bg-gray-50 rounded-xl p-3 text-sm font-medium text-gray-700"><T k="자동 감지" /></div>
        </div>
        <span className="text-gray-300 text-xl">→</span>
        <div className="flex-1">
          <p className="text-xs text-gray-500 mb-2 text-center"><T k="대상 언어" /></p>
          <div className="flex gap-1.5 flex-wrap justify-center">
            {LANGUAGES.filter(l => l.code !== 'ko').map(l => (
              <button key={l.code} onClick={() => setTarget(l.code)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${target === l.code ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {l.flag} {l.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 톤 선택 */}
      <div className="flex items-center gap-3 justify-center">
        <span className="text-xs text-gray-500"><T k="톤" />:</span>
        {TONES.map(t => (
          <button key={t} onClick={() => setTone(t)}
            className={`px-3 py-1 text-xs rounded-lg ${tone === t ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={t === 'formal' ? '격식체' : t === 'casual' ? '일상체' : '문학체'} />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 원본 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-500"><T k="원본" /></p>
            <span className="text-[10px] text-gray-400">{text.length}<T k="자@글자수" /></span>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            placeholder={tAttr('번역할 텍스트를 입력하세요...')}
            className="w-full border-none outline-none text-sm resize-none" />
        </div>

        {/* 번역 결과 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-500">{targetLang?.flag} {targetLang?.name}</p>
            {result?.duration_ms && <span className="text-[10px] text-gray-400">{result.duration_ms}ms</span>}
          </div>
          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
          ) : result?.translation ? (
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result.translation}</p>
          ) : (
            <p className="text-sm text-gray-300 py-16 text-center"><T k="번역 결과가 여기에 표시됩니다" /></p>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <button onClick={handleTranslate} disabled={loading || !text.trim()}
          className="px-8 py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-30">
          <T k={loading ? '번역 중...' : '번역@실행'} />
        </button>
      </div>
    </div>
  );
}
