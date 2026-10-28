'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface ChartTemplate {
  id: string;
  name: string;
  department: string;
  role: string;
  isPersonal?: boolean;
  sections?: unknown[];
}

interface ChartPreference {
  defaultTemplateId: string | null;
  favoriteTemplateIds: string[];
  recentTemplateIds: string[];
}

interface ForMeResponse {
  templates: ChartTemplate[];
  preference: ChartPreference;
}

export function ChartTemplateSelector({ useTemplate, selectedTemplate, onToggle, onSelect, diagnosisCodes }: {
  useTemplate: boolean; selectedTemplate: ChartTemplate | null; onToggle: () => void; onSelect: (t: ChartTemplate) => void; diagnosisCodes?: string[];
}) {
  const tAttr = useTAttr();
  const [showList, setShowList] = useState(false);
  const qc = useQueryClient();

  // Phase 4: WeRU.B 추천 — 진단코드 기반
  const codesParam = (diagnosisCodes ?? []).join(',');
  const { data: recommendData } = useQuery({
    queryKey: ['chart-templates-recommend', codesParam],
    queryFn: () => apiClient.get<{ data: ChartTemplate[] }>(`/api/v1/chart-templates/recommend`, { codes: codesParam }),
    enabled: showList && codesParam.length > 0,
  });
  const recommendRaw = recommendData?.data;
  const recommendedTemplates: ChartTemplate[] = Array.isArray(recommendRaw) ? recommendRaw : (recommendRaw as Record<string, unknown> | undefined)?.data as ChartTemplate[] ?? [];

  const { data: forMeData } = useQuery({
    queryKey: ['chart-templates-for-me'],
    queryFn: () => apiClient.get<{ data: ForMeResponse }>('/api/v1/chart-templates/for-me'),
    enabled: showList,
  });

  const raw = forMeData?.data;
  const forMe: ForMeResponse = (raw as unknown as Record<string, unknown>)?.data as ForMeResponse ?? raw ?? { templates: [], preference: { defaultTemplateId: null, favoriteTemplateIds: [], recentTemplateIds: [] } };
  const templatesList = forMe.templates ?? [];
  const pref = forMe.preference ?? { defaultTemplateId: null, favoriteTemplateIds: [], recentTemplateIds: [] };

  // 분류
  const defaultTemplate = pref.defaultTemplateId ? templatesList.find((t: ChartTemplate) => t.id === pref.defaultTemplateId) : null;
  const recentTemplates = (pref.recentTemplateIds ?? [])
    .map((id: string) => templatesList.find((t: ChartTemplate) => t.id === id))
    .filter((t): t is ChartTemplate => !!t);
  const favoriteTemplates = (pref.favoriteTemplateIds ?? [])
    .map((id: string) => templatesList.find((t: ChartTemplate) => t.id === id))
    .filter((t): t is ChartTemplate => !!t);
  const personalTemplates = templatesList.filter((t: ChartTemplate) => t.isPersonal);
  const publicTemplates = templatesList.filter((t: ChartTemplate) => !t.isPersonal);

  const setDefaultMut = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.fetch('/api/v1/chart-templates/my-settings/default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-templates-for-me'] }),
  });

  const toggleFavMut = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.fetch('/api/v1/chart-templates/my-settings/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-templates-for-me'] }),
  });

  const personalizeMut = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.fetch(`/api/v1/chart-templates/${templateId}/personalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-templates-for-me'] }),
  });

  const recordUsageMut = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.fetch(`/api/v1/chart-templates/${templateId}/use`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chart-templates-for-me'] }),
  });

  const handleSelect = (t: ChartTemplate) => {
    onSelect(t);
    setShowList(false);
    recordUsageMut.mutate(t.id);
  };

  const isFavorite = (id: string) => (pref.favoriteTemplateIds ?? []).includes(id);

  const renderTemplateItem = (t: ChartTemplate, showActions = true) => (
    <div key={t.id}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors cursor-pointer ${selectedTemplate?.id === t.id ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'}`}
    >
      <button onClick={() => handleSelect(t)} className="flex-1 text-left min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate">
          {t.isPersonal && <span className="text-indigo-500 mr-1"><T k="[개인]" /></span>}
          {t.name}
        </p>
        <p className="text-[10px] text-gray-400">{t.department} · {t.role === 'NURSE' ? '간호사' : t.role === 'LAB_TECH' ? '검사기사' : '의사'} · {(t.sections ?? []).length}섹션</p>
      </button>
      {showActions && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); setDefaultMut.mutate(t.id); }}
            title={tAttr("기본 템플릿 설정")}
            className={`p-1 rounded text-[10px] ${pref.defaultTemplateId === t.id ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}>
            {pref.defaultTemplateId === t.id ? '\u2605' : '\u2606'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); toggleFavMut.mutate(t.id); }}
            title={tAttr("즐겨찾기")}
            className={`p-1 rounded text-[10px] ${isFavorite(t.id) ? 'text-red-400' : 'text-gray-300 hover:text-red-300'}`}>
            {isFavorite(t.id) ? '\u2764' : '\u2661'}
          </button>
          {!t.isPersonal && (
            <button onClick={(e) => { e.stopPropagation(); personalizeMut.mutate(t.id); }}
              title={tAttr("개인화 (복제)")}
              className="p-1 rounded text-[10px] text-gray-300 hover:text-blue-400">
              +
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex items-center gap-3 pb-3 border-b border-gray-100 relative">
      <button onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${useTemplate ? 'bg-indigo-600' : 'bg-gray-200'}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${useTemplate ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-xs text-gray-600">
        {useTemplate ? (
          <span className="flex items-center gap-2">
            <span className="font-medium text-indigo-700"><T k="차트 템플릿:" /></span>
            <span className="font-bold text-gray-900">{selectedTemplate?.name ?? '선택 안됨'}</span>
            <button onClick={() => setShowList(!showList)} className="text-blue-600 hover:text-blue-700 text-[10px]"><T k="변경" /></button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span><T k="기본 SOAP" /></span>
            <button onClick={() => setShowList(!showList)} className="text-indigo-600 hover:text-indigo-700 text-[10px] font-medium"><T k="차트 템플릿 사용" /></button>
          </span>
        )}
      </span>

      {showList && (
        <div className="absolute z-20 top-10 left-0 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-80 max-h-[28rem] overflow-y-auto">

          {/* WeRU.B 추천 템플릿 */}
          {recommendedTemplates.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1 flex items-center gap-1">
                <span className="px-1.5 h-3.5 bg-emerald-100 rounded-full flex items-center justify-center text-[9px] normal-case">{AI_ORIGIN_TEXT}</span>
                <T k="진단코드 기반 추천" />
              </p>
              {recommendedTemplates.slice(0, 3).map((t: ChartTemplate) => (
                <div key={`rec-${t.id}`} className="relative">
                  {renderTemplateItem(t, false)}
                  <span className="absolute top-1 right-1 text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium"><T k="추천" /></span>
                </div>
              ))}
              <hr className="my-2 border-gray-100" />
            </>
          )}

          {/* 기본 템플릿 */}
          {defaultTemplate && (
            <>
              <p className="text-[10px] font-semibold text-yellow-600 uppercase mb-1"><T k="내 기본 템플릿" /></p>
              {renderTemplateItem(defaultTemplate, false)}
              <hr className="my-2 border-gray-100" />
            </>
          )}

          {/* 최근 사용 */}
          {recentTemplates.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="최근 사용" /></p>
              {recentTemplates.map((t: ChartTemplate) => renderTemplateItem(t, false))}
              <hr className="my-2 border-gray-100" />
            </>
          )}

          {/* 즐겨찾기 */}
          {favoriteTemplates.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-red-400 uppercase mb-1"><T k="즐겨찾기" /></p>
              {favoriteTemplates.map((t: ChartTemplate) => renderTemplateItem(t, false))}
              <hr className="my-2 border-gray-100" />
            </>
          )}

          {/* 내 개인 템플릿 */}
          {personalTemplates.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-indigo-500 uppercase mb-1"><T k="내 개인 템플릿" /></p>
              {personalTemplates.map((t: ChartTemplate) => renderTemplateItem(t))}
              <hr className="my-2 border-gray-100" />
            </>
          )}

          {/* 공용 템플릿 (전체) */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1"><T k="전체 (내 진료과)" /></p>
          {publicTemplates.length === 0 ? (
            <EmptyState icon="📄" title="템플릿이 없습니다." hint="관리자 → 차트 에디터에서 생성하세요." />
          ) : (
            publicTemplates.map((t: ChartTemplate) => renderTemplateItem(t))
          )}

          <button onClick={() => setShowList(false)} className="w-full text-center text-xs text-gray-400 mt-2 hover:text-gray-600"><T k="닫기" /></button>
        </div>
      )}
    </div>
  );
}
