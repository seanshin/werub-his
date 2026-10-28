'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { kstToday } from '@/lib/kst-today';

interface Popup {
  id: string; title: string; type: string; content?: string;
  imageUrl?: string; linkUrl?: string; linkText?: string;
  hideToday: boolean;
}

export function PopupRenderer() {
  const [popups, setPopups] = useState<Popup[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const pathname = usePathname();

  useEffect(() => {
    // 오늘 안 보기 체크
    const todayKey = `popup_dismissed_${kstToday()}`;
    const stored = localStorage.getItem(todayKey);
    if (stored) setDismissed(new Set(JSON.parse(stored)));

    fetch(`/api/v1/public/popups/active?page=${pathname}`)
      .then(r => r.json())
      .then(res => setPopups(res.data ?? []))
      .catch(() => {});
  }, [pathname]);

  const dismiss = (id: string, hideToday: boolean) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      if (hideToday) {
        const todayKey = `popup_dismissed_${kstToday()}`;
        localStorage.setItem(todayKey, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };

  const modals = popups.filter(p => p.type === 'MODAL' && !dismissed.has(p.id));
  const strips = popups.filter(p => p.type === 'STRIP' && !dismissed.has(p.id));
  const floatings = popups.filter(p => p.type === 'FLOATING' && !dismissed.has(p.id));

  return (
    <>
      {/* 띠배너 */}
      {strips.map(p => (
        <div key={p.id} className="bg-gradient-to-r from-blue-600 to-blue-700 text-white text-center py-2.5 text-[13px] relative">
          <span className="inline-flex items-center gap-2">
            <span className="bg-red-500 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">NEW</span>
            {p.linkUrl ? <Link href={p.linkUrl} className="hover:underline">{p.title}</Link> : p.title}
          </span>
          <button onClick={() => dismiss(p.id, p.hideToday)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-lg" aria-label="닫기">&times;</button>
        </div>
      ))}

      {/* 모달 팝업 */}
      {modals.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => dismiss(modals[0].id, false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            {modals[0].imageUrl && (
              <img src={modals[0].imageUrl} alt={modals[0].title} className="w-full h-48 object-cover" />
            )}
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900">{modals[0].title}</h3>
              {modals[0].content && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{modals[0].content}</p>}
              {modals[0].linkUrl && (
                <Link href={modals[0].linkUrl} className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
                  {modals[0].linkText || '자세히 보기'}
                </Link>
              )}
            </div>
            <div className="px-6 pb-4 flex items-center justify-between border-t border-gray-100 pt-3">
              {modals[0].hideToday && (
                <button onClick={() => dismiss(modals[0].id, true)} className="text-xs text-gray-400 hover:text-gray-600">오늘 하루 안 보기</button>
              )}
              <button onClick={() => dismiss(modals[0].id, false)} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 배너 */}
      {floatings.map(p => (
        <div key={p.id} className="fixed bottom-20 left-4 z-40 max-w-xs bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="w-full h-24 object-cover" />}
          <div className="p-3">
            <h4 className="text-sm font-bold text-gray-900">{p.title}</h4>
            {p.content && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.content}</p>}
            {p.linkUrl && <Link href={p.linkUrl} className="text-xs text-blue-600 font-medium mt-1 inline-block">{p.linkText || '자세히 →'}</Link>}
          </div>
          <button onClick={() => dismiss(p.id, p.hideToday)} className="absolute top-1 right-1 w-6 h-6 bg-black/50 text-white rounded-full text-xs flex items-center justify-center" aria-label="닫기">&times;</button>
        </div>
      ))}
    </>
  );
}
