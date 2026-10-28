'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { HOSPITAL_CONTACT } from '@/lib/hospital-contact';

interface RecruitItem {
  id: string;
  slug: string;
  title: string;
  content: string;
  metadata: {
    position?: string;
    department?: string;
    employmentType?: string;
    requirements?: string[];
    benefits?: string[];
    deadline?: string;
    contactEmail?: string;
    status?: string;
  };
  tags: string[];
  isPinned: boolean;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  OPEN: { label: '모집중', color: 'bg-green-100 text-green-800 border-green-200' },
  CLOSING_SOON: { label: '마감임박', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  CLOSED: { label: '마감', color: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const EMP_TYPE: Record<string, string> = {
  FULL_TIME: '정규직', PART_TIME: '파트타임', CONTRACT: '계약직', INTERN: '인턴',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function daysRemaining(deadline: string) {
  const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '마감';
  if (diff === 0) return 'D-Day';
  return `D-${diff}`;
}

export default function RecruitPage() {
  const [items, setItems] = useState<RecruitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ data: RecruitItem[] }>('/api/v1/public/recruit')
      .then(res => setItems(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">채용 안내</h1>
        <p className="text-sm text-gray-500 mt-1">위루비병원과 함께할 인재를 찾습니다</p>
      </div>

      {/* 채용 현황 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{items.filter(i => i.metadata?.status === 'OPEN').length}</p>
          <p className="text-xs text-green-600 mt-1">모집중</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-orange-700">{items.filter(i => i.metadata?.status === 'CLOSING_SOON').length}</p>
          <p className="text-xs text-orange-600 mt-1">마감임박</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-500">{items.filter(i => i.metadata?.status === 'CLOSED').length}</p>
          <p className="text-xs text-gray-400 mt-1">마감</p>
        </div>
      </div>

      {/* 채용 목록 */}
      {items.length === 0 ? (
        <EmptyState icon="📋" title="등록된 채용 공고가 없습니다" />
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const meta = item.metadata;
            const status = STATUS_BADGE[meta?.status ?? 'OPEN'] ?? STATUS_BADGE.OPEN;
            const isOpen = expanded === item.id;
            const isClosed = meta?.status === 'CLOSED';

            return (
              <div key={item.id} className={`bg-white border rounded-2xl overflow-hidden ${isClosed ? 'border-gray-100 opacity-60' : 'border-gray-100'}`}>
                <button
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition text-left"
                >
                  {/* 상태 배지 */}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold whitespace-nowrap flex-shrink-0 ${status.color}`}>
                    {status.label}
                  </span>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 truncate">{item.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                      {meta?.department && <span>{meta.department}</span>}
                      {meta?.employmentType && <span>· {EMP_TYPE[meta.employmentType] ?? meta.employmentType}</span>}
                    </div>
                  </div>

                  {/* 마감일 */}
                  {meta?.deadline && (
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-bold ${isClosed ? 'text-gray-400' : 'text-blue-600'}`}>
                        {daysRemaining(meta.deadline)}
                      </p>
                      <p className="text-[10px] text-gray-400">~{formatDate(meta.deadline)}</p>
                    </div>
                  )}

                  <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 border-t border-gray-50 space-y-4">
                    {/* 상세 내용 */}
                    <div className="pt-4 text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.content}</div>

                    {/* 자격 요건 */}
                    {meta?.requirements && meta.requirements.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-800 mb-2">자격 요건</h4>
                        <ul className="space-y-1">
                          {meta.requirements.map((r, i) => (
                            <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 복리후생 */}
                    {meta?.benefits && meta.benefits.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-800 mb-2">복리후생</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {meta.benefits.map(b => (
                            <span key={b} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">{b}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 지원 방법 */}
                    {meta?.contactEmail && !isClosed && (
                      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-blue-800 mb-1">지원 방법</h4>
                        <p className="text-xs text-blue-700">이력서를 이메일로 보내주세요:</p>
                        <a href={`mailto:${meta.contactEmail}`} className="text-sm font-bold text-blue-600 hover:underline mt-1 inline-block">
                          {meta.contactEmail}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 안내 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center">
        {/* 🔴 `02-1234-5678 (인사팀)` 은 지어낸 번호였다(2026-09-12). 인사팀 직통은 어느 정본에도 없다 —
            지어내는 대신 **확인된 대표전화**를 그 이름으로 안내한다(앱 정본 `lib/hospital-contact.ts`). */}
        <p className="text-sm text-gray-600">채용 관련 문의: <span className="font-bold text-gray-800">{HOSPITAL_CONTACT.main} (대표전화)</span></p>
        <p className="text-xs text-gray-400 mt-1">hr@hospital.example.org</p>
      </div>
    </div>
  );
}
