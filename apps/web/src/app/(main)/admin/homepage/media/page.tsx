'use client';

import { useState, useEffect, useRef } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface MediaItem {
  id: string; fileName: string; originalName: string; mimeType: string;
  fileSize: number; url: string; folder: string; width?: number; height?: number;
  createdAt: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function MediaLibraryPage() {
  const tAttr = useTAttr();
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [stats, setStats] = useState<{ totalFiles: number; totalSize: number; imageCount: number } | null>(null);
  const [filesError, setFilesError] = useState<unknown>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('/');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 🔴 종전에는 세 조회를 `Promise.all(...).then(...).catch(() => {})` 로 묶어, 하나만 실패해도
  //    **셋 다 반영되지 않았다.** files 는 `[]` 그대로라 화면이 "파일이 없습니다. 업로드 버튼을
  //    클릭하세요"라고 단정했고(조회 실패 → '없음'), stats 는 null 이라 헤더가 **영구 '로딩 중...'**
  //    으로 굳었다. 조각별로 성공을 반영하고, 실패한 조각을 화면이 말한다.
  const load = () => {
    setLoading(true);
    setFilesError(null);
    Promise.allSettled([
      apiClient.get<{ data: MediaItem[] }>(`/api/v1/homepage/media?folder=${folder}${search ? `&search=${search}` : ''}`),
      apiClient.get<{ data: string[] }>('/api/v1/homepage/media/folders'),
      apiClient.get<{ data: any }>('/api/v1/homepage/media/stats'),
    ]).then(([filesRes, foldersRes, statsRes]) => {
      if (filesRes.status === 'fulfilled') {
        const d = filesRes.value.data;
        setFiles(Array.isArray(d) ? d : (d as any)?.data ?? []);
        setFilesError(null);
      } else {
        setFiles([]);
        setFilesError(filesRes.reason ?? new Error('파일 목록 조회 실패'));
      }
      if (foldersRes.status === 'fulfilled') {
        const d = foldersRes.value.data;
        setFolders(Array.isArray(d) ? d : (d as any)?.data ?? ['/']);
      }
      setStats(statsRes.status === 'fulfilled'
        ? ((statsRes.value.data as any)?.data ?? statsRes.value.data ?? null)
        : null);
      setStatsFailed(statsRes.status === 'rejected');
    }).finally(() => setLoading(false));
  };

  useEffect(load, [folder, search]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('파일 크기는 10MB 이하여야 합니다'); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const token = apiClient.getToken();
      const res = await fetch(`/api/v1/homepage/media/upload?folder=${encodeURIComponent(folder)}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      // 🔴 W9: 서버가 왜 거부했는지(확장자·용량·권한)를 버리고 '업로드 실패'만 띄웠다.
      //    거부 이유를 안 보여주면 관리자는 같은 파일을 계속 다시 올린다.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? body?.message ?? `업로드 실패 (HTTP ${res.status})`);
      }
      toast.success('업로드 완료');
      load();
    } catch (e) { toast.error((e as { message?: string })?.message || '업로드 실패'); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 파일을 삭제하시겠습니까?\n디스크에서도 함께 지워집니다.')) return;
    // 🔴 W9: try/catch 가 없어 삭제가 거부돼도(서버가 파일을 못 지운 경우) 화면은 아무 말도 하지 않았다.
    //    반대로 예전 서버는 파일 삭제 실패를 삼키고 DB 행만 지워, 재시작 시 self-healing 스캔이
    //    지운 파일을 되살렸다(= "삭제했는데 다시 나타남"). 지금은 서버가 거부하고 그 이유를 여기서 말한다.
    try {
      await apiClient.del(`/api/v1/homepage/media/${id}`);
      toast.success('삭제 완료');
      setSelected(null);
      load();
    } catch (e) {
      toast.error((e as { message?: string })?.message || '삭제 실패 — 파일이 그대로 남아 있습니다');
      load();
    }
  };

  const selectedFile = files.find(f => f.id === selected);

  return (
    <div className="max-w-7xl space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="미디어 라이브러리" /></h1>
          {/* 🔴 조회 실패를 영구 '로딩 중...' 으로 굳히지 않는다 — 로딩과 실패는 다른 상태다 */}
          <p className="text-sm text-gray-500 mt-1">
            {stats ? `${stats.totalFiles}개 파일 · ${formatSize(stats.totalSize)} 사용`
              : statsFailed ? <span className="text-red-600"><T k="사용량을 불러오지 못했습니다" /></span>
              : <T k={loading ? '로딩 중...' : '사용량 정보 없음'} />}
          </p>
        </div>
        <div className="flex gap-2">
          {/* 🔴 W9: accept 가 PDF·DOC 를 고를 수 있게 열어두었지만 서버 fileFilter 는 jpg/png/gif/webp 만
              받는다(`/media` 는 확장자로 Content-Type 이 정해지는 공개 정적 경로 — SVG·HTML 은 저장형 XSS).
              화면이 할 수 있다고 말한 것을 서버가 거부하고 있었다. 실제 허용 집합으로 맞춘다. */}
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={handleUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            title={tAttr('JPG · PNG · GIF · WebP, 최대 10MB')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition">
            <T k={uploading ? '업로드 중...' : '📤 이미지 업로드'} />
          </button>
        </div>
      </div>

      {/* 폴더 + 검색 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFolder('/')} className={`px-3 py-1.5 text-xs rounded-full border ${folder === '/' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}><T k="전체" /></button>
          {folders.filter(f => f !== '/').map(f => (
            <button key={f} onClick={() => setFolder(f)} className={`px-3 py-1.5 text-xs rounded-full border ${folder === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {f.replace(/^\//, '')}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tAttr('파일명 검색...')}
          className="flex-1 max-w-xs px-3 py-1.5 border rounded-lg text-sm" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 파일 그리드 */}
        <div className="lg:col-span-3">
          {loading ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">{[...Array(12)].map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : filesError ? (
            /* 🔴 조회 실패를 "파일이 없습니다"로 말하지 않는다 */
            <QueryErrorFallback error={filesError} onRetry={load} />
          ) : files.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <svg className="w-16 h-16 mx-auto text-gray-200 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 7.5l.75-.75a2.25 2.25 0 013.182 0L12 8.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25" /></svg>
              <p className="text-sm"><T k="파일이 없습니다. 업로드 버튼을 클릭하세요." /></p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {files.map(f => (
                <button key={f.id} onClick={() => setSelected(f.id)}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${selected === f.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-200'}`}>
                  {f.mimeType.startsWith('image/') ? (
                    <img src={f.url} alt={f.originalName} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center">
                      <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                      <span className="text-[9px] text-gray-400 mt-1">{f.mimeType.split('/')[1]}</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                    <p className="text-[9px] text-white truncate">{f.originalName}</p>
                    <p className="text-[8px] text-white/60">{formatSize(f.fileSize)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 상세 패널 */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm h-fit sticky top-4">
          {selectedFile ? (
            <div className="space-y-3">
              {selectedFile.mimeType.startsWith('image/') && (
                <img src={selectedFile.url} alt={selectedFile.originalName} className="w-full rounded-xl" />
              )}
              <div className="space-y-2 text-xs">
                <div><span className="text-gray-400"><T k="파일명" />:</span> <span className="text-gray-700 font-medium">{selectedFile.originalName}</span></div>
                <div><span className="text-gray-400"><T k="크기" />:</span> <span className="text-gray-700">{formatSize(selectedFile.fileSize)}</span></div>
                <div><span className="text-gray-400"><T k="유형" />:</span> <span className="text-gray-700">{selectedFile.mimeType}</span></div>
                <div><span className="text-gray-400"><T k="폴더" />:</span> <span className="text-gray-700">{selectedFile.folder}</span></div>
                <div><span className="text-gray-400"><T k="업로드" />:</span> <span className="text-gray-700">{kdate(new Date(selectedFile.createdAt), 'datetime')}</span></div>
                {selectedFile.width && <div><span className="text-gray-400"><T k="크기" />:</span> <span className="text-gray-700">{selectedFile.width}×{selectedFile.height}px</span></div>}
              </div>
              <div className="space-y-2 pt-2 border-t">
                <button onClick={() => { navigator.clipboard.writeText(selectedFile.url); toast.success('URL 복사됨'); }}
                  className="w-full py-2 bg-blue-50 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100 transition"><T k="URL 복사" /></button>
                <button onClick={() => handleDelete(selectedFile.id)}
                  className="w-full py-2 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 transition"><T k="삭제" /></button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm"><T k="파일을 선택하세요" /></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
