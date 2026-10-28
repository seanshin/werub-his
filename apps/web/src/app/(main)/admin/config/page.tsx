'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import {
  CONFIG_SOURCE_TEXT, CONFIG_SOURCE_HINT,
  CONFIG_UNREGISTERED_TEXT, CONFIG_UNREGISTERED_HINT,
  CONFIG_SEEDED_TEXT, CONFIG_SEEDED_HINT,
  type ConfigSource,
} from '@hospital-run/shared';

const CATEGORY_COLOR: Record<string, string> = {
  SYSTEM: 'bg-blue-50 text-blue-700', SECURITY: 'bg-red-50 text-red-700',
  NOTIFICATION: 'bg-purple-50 text-purple-700', INTEGRATION: 'bg-teal-50 text-teal-700',
};

interface ConfigItem {
  key: string;
  value: string | number | boolean | Record<string, unknown>;
  category?: string;
  description?: string;
  /** 🔴 값의 출처 — 서버가 말해주지 않던 것(구버전 응답에는 없다 → undefined 를 '설정됨'으로 읽지 않는다) */
  source?: ConfigSource;
  /** 코드 설정 카탈로그(DEFAULTS) 등재 여부 — false 면 DB 행만 있는 키다 */
  registered?: boolean;
  /** 개발 시드가 넣은 행 — 출처 db 지만 원내가 정한 값이 아니다(시드 행일 때만 온다) */
  seeded?: boolean;
}

/**
 * 출처 배지 색 — **경보가 아니다.**
 * 기본값으로 돌고 있는 것은 결함이 아니라 "아무도 정한 적이 없다"는 사실이다(거짓 경보는 진짜 경보를 죽인다).
 * 되돌릴 자리가 없어 실제로 사람을 곤란하게 했던 것은 **미등재**(DB 행만 있는 키)라 그것만 주황으로 둔다.
 */
const SOURCE_COLOR: Record<ConfigSource, string> = {
  db: 'bg-emerald-50 text-emerald-700',
  default: 'bg-gray-100 text-gray-600',
  unset: 'bg-gray-100 text-gray-500',
  // 환경변수가 이긴 값 — 화면에서 바꿀 수 없다(파랑: 경보가 아니라 "여기서는 못 바꾼다"는 사실)
  env: 'bg-blue-50 text-blue-700',
};

export default function ConfigPage() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['config'],
    queryFn: () => apiClient.get<{ data: ConfigItem[] }>('/api/v1/config'),
  });
  const _configRaw = data?.data;
  const configList: ConfigItem[] = Array.isArray(_configRaw) ? _configRaw : (_configRaw as unknown as Record<string, unknown>)?.data as ConfigItem[] ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900"><T k="설정값 목록(읽기 전용)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="전역 시스템 구성 파라미터 — 값과 출처를 보는 화면입니다." /></p>
        <p className="text-xs text-gray-400 mt-1"><T k="값이 어디서 왔는지 함께 표시합니다 — 기본값이라고 해서 결함은 아닙니다." /></p>
        {/*
          🔴 이 화면과 `/admin/ai-settings` 가 **둘 다 제목이 「시스템 설정」** 이었다(2026-09-13 외부 실측 S8).
             왼쪽 메뉴는 편집 화면으로 가는데 구축 가이드·Go-Live 드릴다운·결정 등록부는 이 읽기 화면을 가리켜,
             "시스템 설정에서 스위치를 끄세요"를 따르는 사람이 **끌 수 없는 화면**에 도착했다.
             정본은 하나다 — **값을 바꾸는 화면은 `/admin/ai-settings`**(`PUT /api/v1/config/:key`).
             여기는 같은 값을 출처 배지와 함께 보는 곳이고, 그 사실을 화면이 스스로 말한다(사람은 코드를 읽지 않는다).
             가드: `apps/api/test/go-live/settings-screen-canon.spec.ts`(이 화면에 쓰기 호출 0 · 이 문구 실재).
        */}
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-3 inline-block">
          {/* 🔴 조각 배선 금지 — 한 문장은 한 키로(어순은 번역문이 정한다) */}
          <Tf
            k="이 화면에서는 값을 바꿀 수 없습니다 — 변경은 {화면} 에서 합니다."
            params={{ 화면: <Link href="/admin/ai-settings" className="font-semibold underline"><T k="시스템 설정" /></Link> }}
          />
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="키" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="값" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="출처" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="카테고리" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="설명" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-24 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !configList.length ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="등록된 설정값이 없습니다" /></p>
                </td>
              </tr>
            ) : (
              configList.map((c: ConfigItem) => (
                <tr key={c.key} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-5 py-4 font-mono text-xs text-gray-900">{c.key}</td>
                  <td className="px-5 py-4 font-semibold text-gray-800 text-xs">{typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)}</td>
                  <td className="px-5 py-4">
                    {/* 🔴 서버가 출처를 말하지 않으면(구버전 응답) 지어내지 않고 '-' 로 둔다 */}
                    {!c.source ? <span className="text-xs text-gray-300">-</span> : (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${SOURCE_COLOR[c.source]}`}
                          title={tAttr(CONFIG_SOURCE_HINT[c.source])}
                        >
                          <T k={CONFIG_SOURCE_TEXT[c.source]} />
                        </span>
                        {c.seeded && (
                          <span
                            className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-violet-50 text-violet-700"
                            title={tAttr(CONFIG_SEEDED_HINT)}
                            data-config-seeded={c.key}
                          >
                            <T k={CONFIG_SEEDED_TEXT} />
                          </span>
                        )}
                        {c.registered === false && (
                          <span
                            className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700"
                            title={tAttr(CONFIG_UNREGISTERED_HINT)}
                          >
                            <T k={CONFIG_UNREGISTERED_TEXT} />
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {c.category ? (
                      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${CATEGORY_COLOR[c.category] ?? 'bg-gray-50 text-gray-600'}`}>
                        {c.category}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-xs">{c.description ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
