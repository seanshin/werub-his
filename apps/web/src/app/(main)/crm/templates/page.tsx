'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Template {
  id: string; name: string; type: string; channel: string; locale: string;
  subject: string | null; content: string; isActive: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  REMINDER: '리마인더', RECALL: '리콜', PROMOTION: '프로모션', FOLLOW_UP: '후속', SURVEY: '설문',
};

export default function TemplatesPage() {
  const tAttr = useTAttr();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.fetch<{ data: Template[] }>('/api/v1/crm/templates');
      setTemplates(res.data);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (form: { name: string; type: string; channel: string; locale: string; content: string }) => {
    try {
      await apiClient.fetch('/api/v1/crm/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      load();
    } catch { /* */ }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="템플릿 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="SMS/Push/포털/이메일 메시지 템플릿" /></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
          <T k="+ 새 템플릿" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-900 text-sm">{t.name}</h3>
                <div className="flex gap-1.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-blue-100 text-blue-700">{t.channel}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700"><T k={TYPE_LABEL[t.type] ?? t.type} /></span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500">{t.locale}</span>
                </div>
              </div>
              {t.subject && <p className="text-xs text-gray-600 mb-1">{t.subject}</p>}
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono whitespace-pre-wrap">{t.content}</p>
            </div>
          ))}
          {templates.length === 0 && (
            <EmptyState icon="📄" title="템플릿이 없습니다" className="col-span-2" />
          )}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <CreateForm onClose={() => setShowCreate(false)} onCreate={handleCreate} />
        </div>
      )}
    </div>
  );
}

function CreateForm({ onClose, onCreate }: { onClose: () => void; onCreate: (f: { name: string; type: string; channel: string; locale: string; content: string }) => void }) {
  const tAttr = useTAttr();
  const [form, setForm] = useState({ name: '', type: 'REMINDER', channel: 'SMS', locale: 'ko', content: '' });
  return (
    <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-4">
      <h2 className="text-lg font-bold"><T k="새 템플릿" /></h2>
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder={tAttr('템플릿 이름')} className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
      <div className="grid grid-cols-3 gap-3">
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="REMINDER">{tAttr('리마인더')}</option><option value="RECALL">{tAttr('리콜')}</option>
          <option value="PROMOTION">{tAttr('프로모션')}</option><option value="FOLLOW_UP">{tAttr('후속')}</option><option value="SURVEY">{tAttr('설문')}</option>
        </select>
        <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="SMS">SMS</option><option value="PUSH">Push</option><option value="PORTAL">{tAttr('포털')}</option><option value="EMAIL">{tAttr('이메일')}</option>
        </select>
        <select value={form.locale} onChange={e => setForm(f => ({ ...f, locale: e.target.value }))} className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="ko">{tAttr('한국어')}</option><option value="en">{tAttr('영어')}</option><option value="zh">{tAttr('중국어')}</option>
          <option value="ja">{tAttr('일본어')}</option><option value="vi">{tAttr('베트남어')}</option><option value="ru">{tAttr('러시아어')}</option>
        </select>
      </div>
      <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
        rows={4} placeholder="{{patientName}}님, {{appointmentDate}} 예약이 있습니다."
        className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl"><T k="취소" /></button>
        <button onClick={() => form.name && form.content && onCreate(form)} disabled={!form.name || !form.content}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl disabled:opacity-30"><T k="생성" /></button>
      </div>
    </div>
  );
}
