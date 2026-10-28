'use client';

import { useEffect, useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { sanitizeHtml } from '@/lib/sanitize';
import { truncatedFieldsOf, truncationSummary } from '@/lib/truncated-fields';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type CustomPage = { slug: string; title: string; content: string; exists: boolean; updatedAt: string | null };

// h2 섹션에 id 부여 + 목차(TOC) 추출 — 긴 문서 탐색용
function buildToc(html: string): { html: string; toc: { id: string; text: string }[] } {
  const toc: { id: string; text: string }[] = [];
  let i = 0;
  const out = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_m, attrs: string, inner: string) => {
    const id = `sec-${i++}`;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    toc.push({ id, text });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

/** 커스텀 콘텐츠 페이지 — menu-config 로 추가한 내부 메뉴(/custom/<slug>)의 목적지. 관리자가 내용 작성. */
export default function CustomContentPage() {
  const params = useParams();
  // 제목·본문은 관리자가 쓴 **콘텐츠**라 번역하지 않는다 — 크롬(버튼·안내·토스트)만 번역한다
  const tAttr = useTAttr();
  const slug = String(params?.slug ?? '');
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';

  const [page, setPage] = useState<CustomPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    apiClient.get<{ data: CustomPage }>(`/api/v1/access-control/custom-pages/${encodeURIComponent(slug)}`)
      .then((r) => { setPage(r.data); setForm({ title: r.data.title, content: r.data.content }); })
      .catch(() => toast.error(tAttr('페이지를 불러오지 못했습니다.')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (slug) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.put(`/api/v1/access-control/custom-pages/${encodeURIComponent(slug)}`, form);
      toast.success(tAttr('저장되었습니다.'));
      // 🔴 (U4) 서버가 저장 한도(제목 200·본문 50,000자)를 넘은 칸을 잘랐으면 그 사실을 말한다
      const cut = truncatedFieldsOf(res);
      if (cut.length) toast.warning(`${tAttr('저장 한도를 넘은 칸을 잘라 저장했습니다')}: ${truncationSummary(cut)}`);
      setEditing(false); load();
    } catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('저장 실패')); }
    finally { setSaving(false); }
  };

  const { html: renderedHtml, toc } = useMemo(
    () => buildToc(sanitizeHtml(page?.content ?? '')),
    [page?.content],
  );

  if (loading) return <div className="p-4 text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  const title = page?.title || tAttr('문서');
  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{editing ? <T k="페이지 편집" /> : title}</h1>
        {isAdmin && !editing && (
          <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600 hover:bg-gray-50"><T k="편집" /></button>
        )}
      </div>

      {editing ? (
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <input value={form.title} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={tAttr('제목')} className="w-full border rounded-lg px-3 py-2 text-sm" />
          <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} placeholder={tAttr('내용(HTML 또는 텍스트 — 위험 태그는 자동 제거됨)')} rows={18} className="w-full border rounded-lg px-3 py-2 text-sm font-mono resize-y" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{saving ? <T k="저장 중…" /> : <T k="저장" />}</button>
            <button onClick={() => { setEditing(false); setForm({ title: page?.title ?? '', content: page?.content ?? '' }); }} className="px-4 py-2 border rounded-lg text-sm text-gray-500"><T k="취소" /></button>
          </div>
        </div>
      ) : page?.content ? (
        <div className="lg:flex lg:gap-6 lg:items-start">
          {toc.length > 1 && (
            <aside className="hidden lg:block lg:w-56 lg:flex-none">
              <nav className="lg:sticky lg:top-20 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5"><T k="목차" /></p>
                <ul className="space-y-1.5">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="block text-sm text-gray-500 hover:text-blue-600 transition-colors truncate border-l-2 border-transparent hover:border-blue-500 pl-2 -ml-px">
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}
          <article className="cms-prose flex-1 min-w-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 lg:p-10" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          <p className="mb-1"><T k="아직 작성된 내용이 없습니다." /></p>
          {isAdmin ? <p className="text-sm"><Tf k="우측 상단 {편집}으로 내용을 작성하세요." params={{ 편집: <b><T k="편집" /></b> }} /></p> : <p className="text-sm text-gray-400"><T k="관리자가 곧 내용을 등록할 예정입니다." /></p>}
        </div>
      )}
      {page?.updatedAt && !editing && <p className="text-[11px] text-gray-400 mt-2"><Tf k="최종 수정: {시각}" params={{ 시각: kdate(page.updatedAt, 'datetimeSec') }} /></p>}
    </div>
  );
}
