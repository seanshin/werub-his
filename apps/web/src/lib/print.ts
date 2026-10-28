import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

const LS_KEY = 'hr.workstation.code'; // WorkstationBadge 선택기와 공유

interface PrintResult {
  ok?: boolean; clientSide?: boolean; connection?: string; deviceId?: string;
  host?: string; port?: number; message?: string; zpl?: string; summary?: string;
}

const unwrap = (d: unknown): PrintResult => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: PrintResult }).data : raw) as PrintResult;
};

function downloadZpl(zpl: string, name: string) {
  const url = URL.createObjectURL(new Blob([zpl], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function wsCode(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

/**
 * 워크스테이션 기본 프린터 인쇄 공용 유틸 — 선택기(localStorage code) 기반 라우팅.
 * NETWORK: 서버가 raw 9100 송출 / 비NETWORK·미설정: ZPL 다운로드 폴백.
 */
export async function printOrderLabel(orderId: string, copies = 1): Promise<boolean> {
  const code = wsCode();
  if (!code) {
    toast.warning('워크스테이션 미선택 — 상단 배지에서 워크스테이션을 먼저 선택하세요');
    return false;
  }
  try {
    const res = unwrap(await apiClient.post('/api/v1/workstation-setup/print/order-label', { orderId, code, copies }));
    if (res.clientSide && res.zpl) {
      downloadZpl(res.zpl, `label-${orderId.slice(0, 8)}.zpl`);
      toast.info(`${res.connection} 연결 프린터 — ZPL 파일로 다운로드했습니다`);
      return true;
    }
    toast.success(`라벨 인쇄 전송${res.summary ? ` — ${res.summary}` : ''}`);
    return true;
  } catch (e) {
    toast.error((e as { message?: string })?.message || '라벨 인쇄 실패');
    return false;
  }
}

/** 임의 페이로드 인쇄(ZPL 라벨/문서 텍스트) — compounding 등 기생성 ZPL 라우팅용 */
export async function printRaw(kind: 'LABEL' | 'DOC', payload: string, fallbackName = 'print.zpl'): Promise<boolean> {
  const code = wsCode();
  if (!code) {
    toast.warning('워크스테이션 미선택 — 상단 배지에서 워크스테이션을 먼저 선택하세요');
    return false;
  }
  try {
    const res = unwrap(await apiClient.post('/api/v1/workstation-setup/print', { code, kind, payload }));
    if (res.clientSide) {
      downloadZpl(payload, fallbackName);
      toast.info(`${res.connection} 연결 프린터 — 파일로 다운로드했습니다`);
      return true;
    }
    toast.success('인쇄 전송 완료');
    return true;
  } catch (e) {
    toast.error((e as { message?: string })?.message || '인쇄 실패');
    return false;
  }
}
