'use client';

/**
 * [DEPRECATED · Track3 이중 시스템 통합] 구형 진료기록 템플릿(EncounterTemplate) 관리 화면.
 * 정식 템플릿 시스템은 ChartTemplate(/admin/chart-editor) — 프리셋 22종·임상도구(clinical-chart)·버전관리 제공.
 * 구형 BE 모듈(encounter-templates API)·운영 데이터는 보존(파괴적 제거 없음), 화면만 차트 에디터로 안내한다.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T } from '@/components/ui/i18n-text';

export default function EncounterTemplatesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace('/admin/chart-editor'), 1500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="max-w-xl mx-auto mt-20 bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-3">
      <p className="text-3xl">🗂️</p>
      <h1 className="text-lg font-bold text-gray-900"><T k="진료기록 템플릿 관리가 「차트 에디터」로 통합되었습니다" /></h1>
      <p className="text-sm text-gray-500">
        <T k="섹션·필드 편집, 전문과 프리셋 22종, 임상도구(78종) 필드, 버전 이력을 차트 에디터에서 관리합니다. 잠시 후 자동 이동합니다." />
      </p>
      <button onClick={() => router.replace('/admin/chart-editor')}
        className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
        <T k="차트 에디터로 이동" />
      </button>
    </div>
  );
}
