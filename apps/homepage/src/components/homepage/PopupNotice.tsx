'use client';

import { useState, useEffect } from 'react';

interface PopupItem {
  id: string;
  title: string;
  content: string;
  imageUrl?: string | null;
  linkUrl?: string;
}

const STORAGE_KEY = 'popup-dismissed';

export function PopupNotice({ items }: { items: PopupItem[] }) {
  const [visible, setVisible] = useState<PopupItem[]>([]);
  const [dontShowToday, setDontShowToday] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) {
      const { date, ids } = JSON.parse(dismissed);
      if (date === new Date().toISOString().slice(0, 10)) {
        const filtered = items.filter((i) => !ids.includes(i.id));
        setVisible(filtered);
        return;
      }
    }
    setVisible(items);
  }, [items]);

  const dismiss = (id: string) => {
    setVisible((v) => v.filter((i) => i.id !== id));
    if (dontShowToday) {
      const existing = localStorage.getItem(STORAGE_KEY);
      const ids = existing ? JSON.parse(existing).ids || [] : [];
      ids.push(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), ids }));
    }
  };

  if (visible.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {visible.map((item, idx) => (
          <div key={item.id} className={idx > 0 ? 'border-t' : ''}>
            {item.imageUrl && (
              <div className="aspect-[16/9] bg-gray-100 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-5">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h3>
              <p className="text-sm text-gray-600 whitespace-pre-line">{item.content}</p>
              {item.linkUrl && (
                <a href={item.linkUrl} className="inline-block mt-3 text-sm text-blue-600 hover:underline font-medium">
                  자세히 보기 →
                </a>
              )}
            </div>
          </div>
        ))}
        <div className="px-5 pb-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
            <input
              type="checkbox" checked={dontShowToday}
              onChange={(e) => setDontShowToday(e.target.checked)}
              className="rounded border-gray-300"
            />
            오늘 하루 보지 않기
          </label>
          <button
            onClick={() => visible.forEach((v) => dismiss(v.id))}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
