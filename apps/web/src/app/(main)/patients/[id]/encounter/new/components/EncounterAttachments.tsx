'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { safeFormat as format } from '@/lib/safe-date';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Attachment {
  id: string;
  kind: string; // SKETCH | IMAGE | FILE
  url: string;
  mimeType: string;
  note: string | null;
  createdAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const MAX_SIZE = 8 * 1024 * 1024; // BE 한도 8MB (encounter.service addAttachment)
const ACCEPT = 'image/png,image/jpeg'; // BE는 png/jpeg dataURL만 수신

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read fail'));
    reader.readAsDataURL(file);
  });
}

/**
 * 진료기록 이미지 첨부 — 다중 업로드(PNG/JPEG, BE 계약) → 썸네일 갤러리 → 다운로드/삭제.
 * BE: POST/GET/DELETE /encounters/:id/attachments (base64 dataUrl 전송, 서버가 파일 저장).
 */
export function EncounterAttachments({
  encounterId,
  readOnly = false,
}: {
  encounterId: string;
  readOnly?: boolean;
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['encounter-attachments', encounterId],
    queryFn: () =>
      apiClient.get<{ data: Attachment[] }>(`/api/v1/encounters/${encounterId}/attachments`),
    enabled: !!encounterId,
  });
  const attachments = data?.data ?? [];

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['encounter-attachments', encounterId] });

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name}: 8MB를 초과합니다`);
        continue;
      }
      if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
        toast.error(`${file.name}: PNG/JPEG 이미지만 첨부할 수 있습니다`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        const kind = file.type.startsWith('image/') ? 'IMAGE' : 'FILE';
        await apiClient.post(`/api/v1/encounters/${encounterId}/attachments`, {
          dataUrl,
          kind,
          note: file.name,
        });
        ok++;
      } catch {
        toast.error(`${file.name} 업로드 실패`);
      }
    }
    setUploading(false);
    if (ok) {
      toast.success(`${ok}개 파일을 첨부했습니다`);
      invalidate();
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeMutation = useMutation({
    mutationFn: (attId: string) =>
      apiClient.del(`/api/v1/encounters/${encounterId}/attachments/${attId}`),
    onSuccess: () => {
      toast.success('첨부를 삭제했습니다');
      invalidate();
    },
    onError: () => toast.error('삭제 실패'),
  });

  const isImage = (a: Attachment) => a.kind === 'IMAGE' || a.kind === 'SKETCH' || a.mimeType.startsWith('image/');
  const src = (a: Attachment) => `${API_BASE}${a.url}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          <T k="진료 첨부" /> <span className="text-gray-400 font-normal">({attachments.length})</span>
        </h3>
        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading || !encounterId}
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50"
            >
              {uploading ? '업로드 중…' : '＋ 이미지 첨부'}
            </button>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-400 py-4 text-center"><T k="불러오는 중…" /></div>
      ) : attachments.length === 0 ? (
        <EmptyState icon="📋" title="첨부된 이미지·파일이 없습니다" className="border border-dashed border-gray-200 rounded-lg" />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="group relative border border-gray-100 rounded-lg overflow-hidden bg-gray-50">
              {isImage(a) ? (
                <button
                  type="button"
                  onClick={() => setPreview(a)}
                  className="block w-full aspect-square"
                  title={a.note ?? ''}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(a)} alt={a.note ?? '첨부 이미지'} className="w-full h-full object-cover" />
                </button>
              ) : (
                <a
                  href={src(a)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col items-center justify-center w-full aspect-square text-gray-500 hover:bg-gray-100"
                  title={a.note ?? ''}
                >
                  <span className="text-2xl">📄</span>
                  <span className="text-[10px] mt-1 px-1 truncate max-w-full">{a.note ?? 'FILE'}</span>
                </a>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-1 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={src(a)}
                  download={a.note ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-white hover:underline"
                  title={tAttr("다운로드")}
                >
                  <T k="⬇ 저장" />
                </a>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('이 첨부를 삭제할까요?')) removeMutation.mutate(a.id);
                    }}
                    className="text-[10px] text-red-200 hover:text-red-100"
                    title={tAttr("삭제")}
                  >
                    <T k="✕ 삭제" />
                  </button>
                )}
              </div>
              <div className="px-1.5 py-1 text-[9px] text-gray-400 truncate">
                {format(new Date(a.createdAt), 'MM/dd HH:mm')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 이미지 라이트박스 */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div className="max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(preview)} alt={preview.note ?? ''} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <div className="flex items-center justify-between mt-2 text-white text-xs">
              <span className="truncate">{preview.note}</span>
              <div className="flex gap-3">
                <a href={src(preview)} download={preview.note ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">
                  <T k="⬇ 다운로드" />
                </a>
                <button type="button" onClick={() => setPreview(null)} className="hover:underline"><T k="닫기" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
