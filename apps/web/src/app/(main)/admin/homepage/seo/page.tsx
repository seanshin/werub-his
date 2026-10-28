'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SeoEntry {
  path: string;
  title: string;
  description: string;
  keywords: string;
  ogImage: string;
  ogType: string;
  canonical: string;
  noIndex: boolean;
  jsonLd: string;
  h1: string;
  /** 🔴 null = 아직 입력·평가된 적 없음(기본 목록 주입분) — "평가해 보니 0점(Poor)"과 다른 사실이다 */
  score: number | null;
}

/**
 * 🔴 W9: `/contact` 는 공개 홈페이지에 **존재하지 않는 경로**였다(문의는 /support/voc).
 *    없는 페이지의 SEO 점수를 매기면 화면이 있지도 않은 일을 관리하는 척한다.
 *    아래 목록은 apps/homepage 의 실제 라우트와 대조한 것이다.
 */
const DEFAULT_PAGES = [
  '/home', '/about', '/care/departments', '/care/centers',
  '/checkup', '/booking', '/news', '/health-info',
  '/care/doctors', '/guide', '/support',
];

/** 공개 홈페이지 도메인 — 미리보기 URL 은 HIS(his.example.org)가 아니라 공개 사이트를 보여야 한다 */
const PUBLIC_ORIGIN = 'https://hospital.example.org';

const SCORE_COLOR = (s: number) =>
  s >= 80 ? 'text-emerald-700 bg-emerald-50' :
  s >= 60 ? 'text-amber-700 bg-amber-50' :
  s >= 40 ? 'text-orange-700 bg-orange-50' :
  'text-red-700 bg-red-50';

const SCORE_LABEL = (s: number) =>
  s >= 80 ? 'Excellent' : s >= 60 ? 'Good' : s >= 40 ? 'Needs Work' : 'Poor';

export default function SeoPage() {
  const tAttr = useTAttr();
  const [entries, setEntries] = useState<SeoEntry[]>([]);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SeoEntry>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<'pages' | 'technical' | 'preview'>('pages');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: SeoEntry[] }>('/api/v1/hospital-info/seo');
      const data = Array.isArray(res.data) ? res.data : (res.data as unknown as { data?: SeoEntry[] })?.data ?? [];

      // DB에 없는 기본 페이지도 표시
      const existing = new Set(data.map(e => e.path));
      const merged = [...data];
      for (const p of DEFAULT_PAGES) {
        if (!existing.has(p)) {
          // 🔴 미입력을 0점으로 넣으면 화면이 "0/100 Poor(빨강)"라 말한다 — 평가한 적 없는 페이지다
          merged.push({ path: p, title: '', description: '', keywords: '', ogImage: '', ogType: 'website', canonical: '', noIndex: false, jsonLd: '', h1: '', score: null });
        }
      }
      setEntries(merged.sort((a, b) => a.path.localeCompare(b.path)));
      setLoadFailed(false);
    } catch {
      // 🔴 조회 실패를 빈 목록으로 접으면 저장돼 있는 SEO 가 전부 '미입력'으로 보인다 — 실패는 실패라고 말한다
      setLoadFailed(true);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleEdit = (entry: SeoEntry) => {
    setEditPath(entry.path);
    setForm({ ...entry });
  };

  const handleSave = async () => {
    if (!editPath) return;
    try {
      // 🔴 W9: 예전엔 `/seo/${path}` 로 보냈는데 라우트 `seo/:path` 는 **한 세그먼트만** 매칭한다.
      //    `/care/departments`·`/care/centers`·`/care/doctors` 는 라우트에 닿지도 못하고 404 →
      //    화면엔 이유 없는 '저장에 실패했습니다'. (운영 seo 설정이 0행인 이유.)
      //    경로는 세그먼트가 아니라 값이므로 쿼리로 보낸다.
      const { path: _p, score: _s, ...payload } = form as Record<string, unknown>;
      await apiClient.put(`/api/v1/hospital-info/seo-entry?path=${encodeURIComponent(editPath)}`, payload);
      toast.success(tAttr('SEO 메타데이터가 저장되었습니다.'));
      setEditPath(null);
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || tAttr('저장에 실패했습니다.')); }
  };

  // 🔴 통계 분모는 평가된 것만 — 미입력 0점을 평균·'개선 필요'에 섞으면 입력할수록 성적이 좋아지는 착시가 된다
  const scored = entries.filter((e): e is SeoEntry & { score: number } => e.score !== null);
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, e) => s + e.score, 0) / scored.length) : null;
  const goodCount = scored.filter(e => e.score >= 80).length;
  const needsWork = scored.filter(e => e.score < 60).length;
  // 실측치 — DB 에 실제로 저장된 항목만 센다(기본 목록에 끼워 넣은 빈 껍데기는 '저장됨'이 아니다)
  const savedCount = entries.filter(e => e.title || e.description || e.jsonLd || e.ogImage).length;
  const jsonLdCount = entries.filter(e => e.jsonLd).length;

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="SEO / 메타데이터 관리" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="각 페이지의 검색엔진 최적화 정보를 관리합니다 (DB 기반 동적 관리)" /></p>
      </div>

      {/* 🔴 W9: 여기 저장한 값을 읽는 공개 화면이 **하나도 없다**(공개 EP `/api/v1/public/seo/:path` 호출자 0건,
          apps/homepage 의 generateMetadata 는 전부 자체 문자열). 저장은 되지만 검색엔진에는 아무 영향이 없다.
          "관리 도구인 척" 하지 않도록 화면이 그 사실을 먼저 말한다. */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
        <p className="text-xs font-bold text-amber-800"><T k="공개 홈페이지 미배선 — 저장해도 검색엔진에 반영되지 않습니다" /></p>
        {/* 🔴 i18n: 조사(가·를)만 남는 조각으로 쪼개면 어느 언어로도 번역할 수 없어, 문장 단위로 배선한다.
            그 대신 <code>·<b> 강조가 빠진다 — 표시되는 글자는 원문 그대로다. */}
        <p className="text-[11px] text-amber-700 mt-0.5">
          <T k="공개 사이트(hospital.example.org)의 각 페이지는 아직 자체 메타데이터를 사용하며 여기 저장한 값을 읽지 않습니다." />
          {' '}<T k="홈페이지 generateMetadata 가 /api/v1/public/seo 를 읽도록 배선하기 전까지 이 화면은 사전 입력용입니다." />
        </p>
      </div>

      {/* Summary Cards
          🔴 W9: 여기 'sitemap.xml / robots.txt', 'Schema.org / JSON-LD' 두 칸은 아무것도 측정하지 않는
             장식이었다. 초록 배경 위의 글자가 "돼 있다"로 읽힌다(P17 근거 없이 안심시킴). 실측 칸으로 바꾼다. */}
      {/* 조회 실패 시 통계 카드를 그리지 않는다 — 빈 목록 기반 '평가 0/0'은 실패를 미평가로 번역하는 것 */}
      {!loadFailed && <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          {avgScore === null
            ? <p className="text-2xl font-bold text-gray-300">—</p>
            : <p className={`text-2xl font-bold ${SCORE_COLOR(avgScore).split(' ')[0]}`}>{avgScore}</p>}
          <p className="text-[10px] text-gray-500 mt-1"><T k="평균 SEO 점수" /> <span className="text-gray-400">(<T k="평가" /> {scored.length}/{entries.length})</span></p>
        </div>
        <div className="bg-emerald-50 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">{goodCount}<span className="text-sm text-emerald-400">/{scored.length}</span></p>
          <p className="text-[10px] text-emerald-600 mt-1"><T k="우수 (80+)" /></p>
        </div>
        <div className="bg-red-50 rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{needsWork}<span className="text-sm text-red-300">/{scored.length}</span></p>
          <p className="text-[10px] text-red-600 mt-1"><T k="개선 필요 (60-)" /></p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{savedCount}<span className="text-sm text-gray-400">/{entries.length}</span></p>
          <p className="text-[10px] text-gray-500 mt-1"><T k="DB에 저장된 페이지" /></p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{jsonLdCount}<span className="text-sm text-gray-400">/{entries.length}</span></p>
          <p className="text-[10px] text-gray-500 mt-1"><T k="JSON-LD 입력됨" /></p>
        </div>
      </div>}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'pages' as const, label: '페이지별 SEO' },
          { key: 'technical' as const, label: '기술 SEO 체크리스트' },
          { key: 'preview' as const, label: '검색 결과 미리보기' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Pages Tab */}
      {tab === 'pages' && (
        <div className="space-y-3">
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
          ) : loadFailed ? (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 flex items-center justify-between">
              <p className="text-xs font-bold text-rose-700"><T k="SEO 설정을 불러오지 못했습니다 — 저장된 값이 없는 것이 아닙니다." /></p>
              <button onClick={() => load()} className="text-xs font-semibold text-rose-700 underline"><T k="다시 시도" /></button>
            </div>
          ) : entries.map(entry => (
            <div key={entry.path} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              {editPath === entry.path ? (
                /* 편집 모드 */
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{entry.path}</span>
                    {entry.score === null
                      ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-100"><T k="미입력" /></span>
                      : <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SCORE_COLOR(entry.score)}`}>{entry.score}/100</span>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="Title (30-60자 권장)" /></label>
                      <input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
                      <p className={`text-[10px] mt-0.5 ${(form.title?.length ?? 0) >= 30 && (form.title?.length ?? 0) <= 60 ? 'text-green-600' : 'text-amber-600'}`}>
                        {form.title?.length ?? 0}<T k="자" />
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase">H1 Heading</label>
                      <input value={form.h1 ?? ''} onChange={e => setForm({ ...form, h1: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1" placeholder={tAttr('페이지 주요 헤딩')} />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="Description (80-160자 권장)" /></label>
                    <textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })}
                      rows={2} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
                    <p className={`text-[10px] mt-0.5 ${(form.description?.length ?? 0) >= 80 && (form.description?.length ?? 0) <= 160 ? 'text-green-600' : 'text-amber-600'}`}>
                      {form.description?.length ?? 0}<T k="자" />
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="Keywords (쉼표 구분)" /></label>
                      <input value={form.keywords ?? ''} onChange={e => setForm({ ...form, keywords: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1" placeholder={tAttr('병원, 건강검진, 진료')} />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase">OG Image URL</label>
                      <input value={form.ogImage ?? ''} onChange={e => setForm({ ...form, ogImage: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1" placeholder="/media/og/page.png" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase">OG Type</label>
                      <select value={form.ogType ?? 'website'} onChange={e => setForm({ ...form, ogType: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1">
                        <option value="website">website</option>
                        <option value="article">article</option>
                        <option value="profile">profile</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-gray-500 uppercase">Canonical URL</label>
                      <input value={form.canonical ?? ''} onChange={e => setForm({ ...form, canonical: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm mt-1" placeholder="https://hospital.example.org/..." />
                    </div>
                    <div className="flex items-end gap-2 pb-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={form.noIndex ?? false} onChange={e => setForm({ ...form, noIndex: e.target.checked })}
                          className="rounded border-gray-300" />
                        <span className="text-xs text-gray-600">noindex</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium text-gray-500 uppercase"><T k="JSON-LD 구조화 데이터" /></label>
                    <textarea value={form.jsonLd ?? ''} onChange={e => setForm({ ...form, jsonLd: e.target.value })}
                      rows={4} className="w-full px-3 py-2 border rounded-lg text-xs font-mono mt-1"
                      placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "Hospital",\n  "name": "위루비병원"\n}'} />
                  </div>

                  {/* Google 검색 결과 미리보기 */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-[10px] text-gray-400 mb-2 uppercase"><T k="Google 검색 결과 미리보기" /></p>
                    <div className="max-w-xl">
                      <p className="text-blue-700 text-lg font-medium leading-snug">{form.title || <T k="제목 없음" />}</p>
                      <p className="text-green-800 text-xs mt-0.5">{`${PUBLIC_ORIGIN}${entry.path}`}</p>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{form.description || <T k="설명 없음" />}</p>
                    </div>
                  </div>

                  {/* SNS 공유 미리보기 */}
                  {form.ogImage && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[10px] text-gray-400 mb-2 uppercase"><T k="SNS 공유 미리보기 (Open Graph)" /></p>
                      <div className="max-w-sm border rounded-xl overflow-hidden bg-white">
                        <div className="h-32 bg-gray-200 flex items-center justify-center">
                          <img src={form.ogImage} alt="OG" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] text-gray-400 uppercase">{PUBLIC_ORIGIN.replace("https://","")}</p>
                          <p className="text-sm font-bold text-gray-900 mt-0.5">{form.title || <T k="제목" />}</p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{form.description || <T k="설명" />}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><T k="저장" /></button>
                    <button onClick={() => setEditPath(null)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg"><T k="취소" /></button>
                  </div>
                </div>
              ) : (
                /* 읽기 모드 */
                <div className="flex items-center justify-between p-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{entry.path}</span>
                      {/* 🔴 미입력(score null)은 'Poor 0점(빨강)'이 아니다 — 평가와 미평가는 다른 사실 */}
                      {entry.score === null
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-100"><T k="미입력" /></span>
                        : <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SCORE_COLOR(entry.score)}`}>
                          {entry.score}/100 {SCORE_LABEL(entry.score)}
                        </span>}
                      {entry.ogImage && <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">OG</span>}
                      {entry.jsonLd && <span className="text-[10px] text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">JSON-LD</span>}
                      {entry.noIndex && <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">noindex</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-900 mt-1 truncate">{entry.title || <span className="text-gray-300"><T k="제목 미설정" /></span>}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{entry.description || <span className="text-gray-300"><T k="설명 미설정" /></span>}</p>
                    {entry.keywords && <p className="text-[10px] text-gray-400 mt-0.5 truncate">Keywords: {entry.keywords}</p>}
                  </div>
                  {/* Score bar */}
                  <div className="flex items-center gap-3 ml-4">
                    {/* 🔴 값이 폭·색으로만 존재하던 것 — 숫자를 함께 찍는다.
                        막대 길이는 눈대중이고 색은 구간일 뿐이라, 62 와 79 를 구분할 수 없었다. */}
                    {entry.score === null ? (
                      <span className="text-xs text-gray-400 whitespace-nowrap"><T k="평가 전" /></span>
                    ) : (
                      <>
                        <div className="w-20">
                          <div className="w-full bg-gray-100 rounded-full h-2"
                            role="img" aria-label={`SEO 점수 ${entry.score}점(100점 만점)`}>
                            <div className={`h-2 rounded-full ${entry.score >= 80 ? 'bg-emerald-500' : entry.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${entry.score}%` }} />
                          </div>
                        </div>
                        <span className="text-xs font-medium text-gray-700 tabular-nums whitespace-nowrap">{entry.score}<span className="text-gray-400">/100</span></span>
                      </>
                    )}
                    <button onClick={() => handleEdit(entry)} className="text-xs text-blue-600 hover:underline whitespace-nowrap"><T k="편집" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Technical SEO Tab
          🔴 W9 실결함: 이 탭은 16개 항목 중 13개가 `status: true` 로 **하드코딩**돼 있었다.
             sitemap·robots·HTTPS·Core Web Vitals·H1 구조·alt 속성은 아무것도 측정하지 않는데
             전부 초록색 '완료' 배지를 달고 "13/16 완료 (81%)" 라고 단언했다.
             안전 화면의 초록은 분모를 묻는다 — 여기서 셀 수 있는 것만 세고, 못 재는 것은 못 잰다고 말한다. */}
      {tab === 'technical' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900"><T k="입력 현황 (이 화면이 실제로 셀 수 있는 것)" /></h3>
              <p className="text-[11px] text-gray-400 mt-0.5"><T k="아래 수치는 DB에 저장된 SEO 레코드를 그대로 센 값입니다." /></p>
            </div>
            <div className="space-y-2">
              {[
                { item: 'Title 입력', have: entries.filter(e => e.title).length, desc: '검색 결과 제목' },
                { item: 'Description 입력', have: entries.filter(e => e.description).length, desc: '검색 결과 설명' },
                { item: 'Keywords 입력', have: entries.filter(e => e.keywords).length, desc: '쉼표 구분 키워드' },
                { item: 'Open Graph 이미지', have: entries.filter(e => e.ogImage).length, desc: 'SNS 공유 썸네일(og:image)' },
                { item: 'Canonical URL', have: entries.filter(e => e.canonical).length, desc: '중복 페이지 방지' },
                { item: 'JSON-LD 구조화 데이터', have: entries.filter(e => e.jsonLd).length, desc: 'Schema.org 마크업' },
                { item: 'H1 지정', have: entries.filter(e => e.h1).length, desc: '페이지 주요 헤딩' },
                { item: 'noindex 지정', have: entries.filter(e => e.noIndex).length, desc: '검색 제외로 표시된 페이지' },
              ].map((c, i) => {
                const total = entries.length;
                const full = total > 0 && c.have === total;
                return (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${full ? 'bg-emerald-100 text-emerald-700' : c.have > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                      {full ? '✓' : c.have > 0 ? '!' : '-'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-900"><T k={c.item} /></p>
                      <p className="text-[10px] text-gray-400"><T k={c.desc} /></p>
                    </div>
                    <span className="text-[11px] font-medium text-gray-600 tabular-nums">{c.have} / {total}<Unit><T k="페이지" /></Unit></span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900"><T k="이 화면에서 확인할 수 없는 항목" /></h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                <T k="아래는 공개 홈페이지(hospital.example.org)를 직접 크롤링해야 알 수 있습니다. 여기서는 상태를 표시하지 않습니다 — 확인하려면 Google Search Console / Lighthouse 를 사용하세요." />
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                'sitemap.xml 노출', 'robots.txt 규칙', 'HTTPS 리다이렉트·HSTS', 'meta viewport',
                'lang 속성', '이미지 alt 속성', 'H1 계층 구조', 'Core Web Vitals',
                'Mobile Friendly', 'Twitter Card', 'FAQ / Breadcrumb Schema',
              ].map(t => (
                <span key={t} className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-2 py-1 rounded-lg"><T k={t} /> · <T k="미측정" /></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {tab === 'preview' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="Google 검색 결과 미리보기" /></h3>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 space-y-6">
            {entries.filter(e => e.title).map(entry => (
              <div key={entry.path} className="max-w-2xl">
                <p className="text-blue-800 text-lg font-medium leading-snug hover:underline cursor-pointer">{entry.title}</p>
                <p className="text-green-800 text-xs mt-0.5">{`${PUBLIC_ORIGIN}${entry.path}`}</p>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{entry.description}</p>
              </div>
            ))}
            {entries.filter(e => e.title).length === 0 && (
              <EmptyState icon="📊" title="SEO 메타데이터가 설정된 페이지가 없습니다." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
