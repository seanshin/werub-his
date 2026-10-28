'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface MediaItem {
  id: string; fileName: string; originalName: string; mimeType: string;
  fileSize: number; url: string; folder: string; createdAt: string;
}

interface MediaPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function MediaPickerModal({ open, onClose, onSelect }: MediaPickerModalProps) {
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('/');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(null);
    // 🔴 종전에는 `Promise.all(...).catch(() => {})` 라 폴더 목록 하나가 죽어도 파일 목록까지
    //    반영되지 않았고, 화면은 "이미지가 없습니다"(EmptyState)로 단정했다 — 라이브러리에
    //    이미지가 있는데도 편집자는 없는 줄 알고 같은 파일을 다시 올린다. 조각별로 반영하고
    //    파일 조회가 실패하면 **실패라고 말한다.**
    setFilesError(null);
    Promise.allSettled([
      apiClient.get<{ data: MediaItem[] }>(`/api/v1/homepage/media?folder=${folder}${search ? `&search=${search}` : ''}`),
      apiClient.get<{ data: string[] }>('/api/v1/homepage/media/folders'),
    ]).then(([filesRes, foldersRes]) => {
      if (filesRes.status === 'fulfilled') {
        const d = filesRes.value.data;
        setFiles(Array.isArray(d) ? d : (d as any)?.data ?? []);
      } else {
        setFiles([]);
        setFilesError(filesRes.reason ?? new Error('이미지 목록 조회 실패'));
      }
      if (foldersRes.status === 'fulfilled') {
        const d = foldersRes.value.data;
        setFolders(Array.isArray(d) ? d : (d as any)?.data ?? ['/']);
      }
    }).finally(() => setLoading(false));
  }, [open, folder, search]);

  if (!open) return null;

  const selectedFile = files.find(f => f.id === selected);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[900px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">미디어 라이브러리에서 선택</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 필터 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-50 bg-gray-50/50">
          <div className="flex gap-1 flex-wrap flex-1">
            <button onClick={() => setFolder('/')} className={`px-2.5 py-1 text-[11px] rounded-full border ${folder === '/' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>전체</button>
            {folders.filter(f => f !== '/').map(f => (
              <button key={f} onClick={() => setFolder(f)} className={`px-2.5 py-1 text-[11px] rounded-full border ${folder === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {f.replace(/^\//, '')}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="검색..."
            className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-xs" />
        </div>

        {/* 이미지 그리드 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
              {[...Array(14)].map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}
            </div>
          ) : filesError ? (
            /* 🔴 조회 실패를 "이미지가 없습니다"로 말하지 않는다 */
            <QueryErrorFallback error={filesError} size="compact" />
          ) : files.length === 0 ? (
            <EmptyState icon="📋" title="이미지가 없습니다" />
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-7 gap-2">
              {files.filter(f => f.mimeType.startsWith('image/')).map(f => (
                <button key={f.id} onClick={() => setSelected(f.id)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition ${selected === f.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-200'}`}>
                  <img src={f.url} alt={f.originalName} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                    <p className="text-[8px] text-white truncate">{f.originalName}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <div className="text-xs text-gray-500">
            {selectedFile ? (
              <span>{selectedFile.originalName} · {formatSize(selectedFile.fileSize)}</span>
            ) : (
              <span>이미지를 선택하세요</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">취소</button>
            <button
              onClick={() => { if (selectedFile) { onSelect(selectedFile.url); onClose(); } }}
              disabled={!selectedFile}
              className="px-4 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
              선택
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
