'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 🔴 2026-08-14 W8(P16) — 이 화면은 등재된 확장 3건을 초록 '활성' 배지로 그렸지만,
 *    ① `@hospital-run/ext-*` 패키지가 없고 ② 슬롯을 렌더하는 코드가 어디에도 없으며
 *    ③ 레지스트리가 서버 메모리라 재시작이면 사라진다. 지금은 서버가 `installed`·`persisted`
 *    를 함께 주고, 화면은 **동작하지 않는 것을 '활성'이라 부르지 않는다.**
 */

interface ExtensionItem {
  id: string;
  name: string;
  version?: string;
  component?: string;
  enabled: boolean;
  installed?: boolean;
  persisted?: boolean;
  effectiveStatus?: 'ACTIVE' | 'NOT_INSTALLED' | 'DISABLED';
}

interface ExtensionSlot {
  slot: string;
  description?: string;
  extensions?: ExtensionItem[];
}

interface RegistryMeta {
  persisted?: boolean;
  storage?: string;
  total?: number;
  installed?: number;
  rendererWired?: boolean;
  note?: string;
}

interface ExtensionListResponse {
  data: ExtensionSlot[];
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: '활성', cls: 'bg-emerald-50 text-emerald-700' },
  NOT_INSTALLED: { label: '미설치 (화면에 그려지지 않음)', cls: 'bg-amber-50 text-amber-700' },
  DISABLED: { label: '비활성', cls: 'bg-gray-100 text-gray-500' },
};

export default function ExtensionsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['extensions'],
    queryFn: () => apiClient.get<{ data: ExtensionSlot[]; meta?: { registry?: RegistryMeta } }>('/api/v1/extensions/slots'),
  });
  const _extRaw = data?.data;
  const extensionsList = Array.isArray(_extRaw) ? _extRaw : (_extRaw as ExtensionListResponse | undefined)?.data ?? [];
  const registry = data?.meta?.registry;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Extension / Slot</h2>
        <p className="text-sm text-gray-500 mt-1"><T k="플러그인 확장 슬롯 및 등록된 확장 목록" /></p>
      </div>

      {/* 레지스트리의 운영 사실 — 목록을 읽기 전에 알아야 하는 것 */}
      {registry && (registry.persisted === false || registry.rendererWired === false) && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900 space-y-1">
          {registry.rendererWired === false && (
            <p><b><T k="슬롯 렌더러가 배선되어 있지 않습니다." /></b> <T k="아래 목록의 확장은 등재만 되어 있을 뿐 실제 화면에 그려지지 않습니다." /></p>
          )}
          {registry.persisted === false && (
            <p><b><T k="이 목록은 저장되지 않습니다" />({registry.storage ?? 'IN_MEMORY'}).</b> <T k="사용 설정·등록은 서버가 재시작되면 초기 상태로 돌아갑니다." /></p>
          )}
          <p className="text-amber-700"><Tf k="등재 {등재}건 중 실제 설치 {설치}건." params={{ 등재: registry.total ?? 0, 설치: registry.installed ?? 0 }} /></p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="h-4 w-32 bg-gray-100 rounded-lg animate-pulse mb-4" />
              <div className="space-y-2">
                <div className="h-3 w-full bg-gray-50 rounded-lg animate-pulse" />
                <div className="h-3 w-2/3 bg-gray-50 rounded-lg animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : !extensionsList.length ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
          <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.421 48.421 0 01-4.185-.428l.146 1.163c.338 2.694.614 5.408.84 8.136l.146 1.757a2.304 2.304 0 002.296 2.125h5.67a2.304 2.304 0 002.296-2.125l.146-1.757c.226-2.728.502-5.442.84-8.136l.146-1.163a48.422 48.422 0 01-4.185.428.64.64 0 01-.657-.643v0z" />
          </svg>
          <p className="text-sm text-gray-400"><T k="등록된 확장 슬롯이 없습니다" /></p>
        </div>
      ) : (
        <div className="space-y-4">
          {extensionsList.map((slot: ExtensionSlot) => (
            <div key={slot.slot} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50">
                <h3 className="text-sm font-semibold text-gray-700">{slot.slot}</h3>
                {slot.description && <p className="text-xs text-gray-400 mt-0.5">{slot.description}</p>}
              </div>
              {slot.extensions?.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-50">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500"><T k="확장명" /></th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500"><T k="컴포넌트" /></th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.extensions.map((e: ExtensionItem) => {
                      // 🔴 enabled 만 보고 '활성'이라 쓰지 않는다 — 서버가 준 effectiveStatus 가 정본.
                      const st = STATUS_BADGE[e.effectiveStatus ?? (e.enabled ? 'NOT_INSTALLED' : 'DISABLED')] ?? STATUS_BADGE.DISABLED;
                      return (
                      <tr key={e.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-900">{e.name}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs font-mono">{e.component ?? e.version ?? '-'}</td>
                        <td className="px-5 py-3">
                          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.cls}`}><T k={st.label} /></span>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-4 text-xs text-gray-400"><T k="등록된 확장이 없습니다" /></p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
