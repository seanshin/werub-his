'use client';

/** 재사용 바텀시트(드래그업 느낌의 하단 오버레이). */
export default function BottomSheet({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="닫기" />
      <div className="relative bg-gray-50 rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="w-10 h-1.5 rounded-full bg-gray-300 hidden" />
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          </div>
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-xl text-gray-600 border border-gray-200">닫기</button>
        </div>
        <div className="overflow-auto p-3">{children}</div>
      </div>
    </div>
  );
}
