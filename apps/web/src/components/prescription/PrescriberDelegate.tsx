'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { ORDER_SOURCE_OPTIONS, isVerbalOrder } from '@hospital-run/shared';

/**
 * 책임 처방의 지정·승인 — 간호사(구두처방 대리입력)·임상병리사(워크인 검사 등록)가 쓰는 공용 흐름.
 *
 * 모델은 **입력은 열되 책임은 의사**다. 의료법상 처방 주체는 의사이므로, 비처방 역할이 입력할 때는
 *  1) 책임 처방의를 반드시 지정하고
 *  2) 그 의사의 승인(폰)을 받아 발급된 토큰을 처방 저장에 동봉한다.
 * 서버는 규칙 on/off 와 무관하게 이 둘이 없으면 저장을 거부한다(fail-closed) — 화면은 그 경로를 안내할 뿐,
 * 화면을 우회해도 통과되지 않는다.
 *
 * 승인 토큰은 **처방 본문 해시에 바인딩**된다. 승인 후 약품·용량을 바꾸면 저장이 거부되므로,
 * 승인 요청에 넘기는 본문과 실제 저장 본문이 같아야 한다.
 */
export interface Prescriber {
  id: string;
  name?: string;
  role?: string;
  department?: string | null;
  specialty?: string | null;
  self?: boolean;
  attending?: boolean;
}

/** 유형별 입력 모드(서버 정본 shared `order-entry-scope`) — SELF 본인 권한 · DELEGATE 의사 승인 · NONE 불가 */
export type EntryMode = 'SELF' | 'DELEGATE' | 'NONE';
export interface EntryScope {
  role?: string | null;
  profession: string | null;
  professionSource: 'SET' | 'ROLE_DEFAULT' | 'MISMATCH_IGNORED' | 'NONE' | string;
  modes: Record<string, EntryMode>;
  /** 유형별 완료·결과 기록 가능 여부(서버 정본 canExecuteOrder) */
  executes?: Record<string, boolean>;
  overrideConfigured?: boolean;
}

/**
 * 한 유형의 모드 — 서버가 준 표가 정본. 구 서버(표 없음)면 종전 의미(delegationRequired)로 접는다.
 * 🔴 종전엔 "비처방 역할이면 어떤 유형이든 의사 승인" 하나였다 — 간호사의 간호 오더도 의사 승인을 받아야 했다.
 */
export function entryModeFor(info: Pick<AuthorizedPrescribers, 'entryScope' | 'delegationRequired'> | null | undefined, type: string | undefined): EntryMode {
  const m = type ? info?.entryScope?.modes?.[type] : undefined;
  if (m === 'SELF' || m === 'DELEGATE' || m === 'NONE') return m;
  return info?.delegationRequired ? 'DELEGATE' : 'SELF';
}

export interface AuthorizedPrescribers {
  enabled: boolean;
  /** 유형별 입력 모드 — 없으면 구 서버 */
  entryScope?: EntryScope;
  allowDelegate?: boolean;
  /** 이 사용자는 지정+승인 없이 저장할 수 없다 */
  delegationRequired?: boolean;
  guideline?: string | null;
  encounterDepartment?: string | null;
  prescribers: Prescriber[];
}

/** 승인 요청에 넘기는 처방 본문 — 서버의 bodyHash 와 **필드·값이 같아야** 한다 */
export interface DelegateBody {
  type?: string;
  medicationCodeId?: string;
  procedureCodeId?: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  route?: string;
}

export type DelegateStatus = 'IDLE' | 'REQUESTING' | 'WAITING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'ERROR';

/**
 * 승인 토큰은 **헤더**로 보낸다 — 서버 컨트롤러가 `x-prescriber-step-up-token` 헤더만 읽는다.
 * 🔴 body 에 실으면 토큰이 서버에 닿지 않아 `PRESCRIBER_AUTH_REQUIRED` 로 거부된다.
 *    "폰 승인은 받았는데 저장만 거부되는" 형태라 화면상으로는 원인이 보이지 않는다 —
 *    호출부는 반드시 이 헬퍼로 헤더를 만들어 넘길 것.
 */
export const PRESCRIBER_TOKEN_HEADER = 'x-prescriber-step-up-token';

export function prescriberAuthHeaders(token: string): Record<string, string> {
  return { [PRESCRIBER_TOKEN_HEADER]: token };
}

const POLL_MS = 2000;
const POLL_LIMIT = 150; // 5분(승인 TTL)

/**
 * 지시 경로 — 🔴 `prescriptions.order_source` 는 컬럼도 배지도 있는데 **DTO 에 키가 없어**
 * whitelist 가 지우고 있었다(운영 1,769건 전량 WRITTEN — 구두·전화 처방이 개통 이래 0건).
 * 오기 위험이 가장 높은 경로가 원장에서 통째로 사라져 있었다.
 *
 * 🔴 자동으로 정하지 않는다. 대리입력이라고 해서 구두처방이라 단정할 수 없다(폰 승인으로 받은 지시는
 *    구두가 아니다). 입력하는 사람만 아는 사실이므로 고르게 한다.
 *
 * 🔴 어휘 정본은 shared `order-source.ts` 하나다 — 종전 이 파일이 값을 직접 들고 있었고
 *    서버는 서버대로 인라인 비교를 했다(같은 사실에 정본이 둘·P12). 여기서는 다시 내보내기만 한다.
 */
export { ORDER_SOURCE_OPTIONS, isVerbalOrder };

export function usePrescriberDelegate(encounterId?: string | null) {
  const [info, setInfo] = useState<AuthorizedPrescribers | null>(null);
  /**
   * 🔴 (2026-09-15 F3) 처방 권한 조회가 실패하면 `info=null` 이 되고, `authorize` 는 그것을 **"위임 불요"** 로 읽어
   *    `{}` 를 돌려줬다 — 비처방 역할이 책임 처방의·지시 경로(구두·전화) 없이 저장으로 넘어갔다(실패를 없음으로).
   *    조회 상태를 따로 들고, 확인되지 않았으면 저장을 멈춘다(모르면 안전측).
   */
  const [infoState, setInfoState] = useState<'IDLE' | 'LOADING' | 'OK' | 'ERROR'>('IDLE');
  const [prescriberId, setPrescriberId] = useState('');
  /** '' = 미선택. 위임 입력에서는 고르기 전에는 저장하지 않는다(=WRITTEN 으로 조용히 적지 않는다) */
  const [orderSource, setOrderSource] = useState('');
  const [readBackConfirmed, setReadBackConfirmed] = useState(false);
  const [status, setStatus] = useState<DelegateStatus>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!encounterId) { setInfo(null); setInfoState('IDLE'); return; }
    let alive = true;
    setInfoState('LOADING');
    apiClient
      .get<{ data: AuthorizedPrescribers }>(`/api/v1/encounters/${encounterId}/authorized-prescribers`)
      .then((r) => { if (alive) { setInfo(r.data as AuthorizedPrescribers); setInfoState('OK'); } })
      .catch(() => { if (alive) { setInfo(null); setInfoState('ERROR'); } });
    return () => { alive = false; };
  }, [encounterId]);

  /**
   * 승인 요청 → 폴링 → 토큰. 실패·거부·만료면 null 을 돌려주고 상태로 이유를 남긴다.
   * 호출부는 토큰이 있을 때만 저장을 진행한다.
   */
  const requestApproval = useCallback(async (body: DelegateBody): Promise<string | null> => {
    if (!encounterId || !prescriberId) { setError('책임 처방의를 선택하세요.'); return null; }
    setError(null);
    setStatus('REQUESTING');
    try {
      const req = await apiClient.post<{ data: { requestId: string } }>(
        `/api/v1/encounters/${encounterId}/prescriptions/delegate-request`,
        { prescriberId, ...body },
      );
      const requestId = (req.data as { requestId?: string })?.requestId;
      if (!requestId) { setStatus('ERROR'); setError('승인 요청을 만들지 못했습니다.'); return null; }

      setStatus('WAITING');
      for (let i = 0; i < POLL_LIMIT; i += 1) {
        await new Promise<void>((res) => { timer.current = setTimeout(res, POLL_MS); });
        const st = await apiClient
          .get<{ data: { status: string; stepUpToken?: string } }>(`/api/v1/auth/step-up/push/delegate/status/${requestId}`)
          .catch(() => null);
        const d = st?.data as { status?: string; stepUpToken?: string } | undefined;
        if (!d) continue;
        if (d.status === 'APPROVED' && d.stepUpToken) { setStatus('APPROVED'); return d.stepUpToken; }
        if (d.status === 'DENIED') { setStatus('DENIED'); setError('지정 처방의가 승인을 거부했습니다.'); return null; }
        if (d.status === 'EXPIRED') { setStatus('EXPIRED'); setError('승인 요청이 만료되었습니다.'); return null; }
      }
      setStatus('EXPIRED');
      setError('승인 대기 시간이 지났습니다.');
      return null;
    } catch (e) {
      setStatus('ERROR');
      setError(e instanceof Error ? e.message : '승인 요청 실패');
      return null;
    }
  }, [encounterId, prescriberId]);

  /**
   * 저장 **직전** 호출 — 비처방 역할이면 승인을 받아 요청에 붙일 헤더·지정 처방의를 돌려준다.
   *
   *  - `{}`   = 위임 불요(처방 권한 역할) → 그대로 저장
   *  - `null` = 승인 실패·미선택 → **저장 중단**(사유는 `error`)
   *
   * 토큰 전달 경로를 여기 한 곳에 가둔다 — 호출부가 body 에 실어 보내면 서버에 닿지 않는다.
   * 토큰은 jti 1회 소비이므로 재전송(DUR 강제처방 등)마다 새로 받아야 한다.
   */
  const authorize = useCallback(async (
    body: DelegateBody,
  ): Promise<{ headers?: Record<string, string>; prescriberId?: string; fields: Record<string, unknown> } | null> => {
    if (encounterId && infoState !== 'OK') {
      setError(infoState === 'ERROR'
        ? '처방 권한(책임 처방의 지정 필요 여부)을 확인하지 못했습니다 — 새로고침 후 다시 시도하세요.'
        : '처방 권한을 확인하는 중입니다 — 잠시 후 다시 시도하세요.');
      return null;
    }
    const mode = entryModeFor(info, body.type);
    if (mode === 'NONE') { setError('이 직종의 입력 범위에 없는 오더 유형입니다.'); return null; }
    // 본인 권한(의사 전 유형·간호사의 간호 오더) — 지정·승인 없이 저장(책임자 = 본인)
    if (mode === 'SELF') return { fields: {} };
    if (!orderSource) { setError('지시를 어떻게 받았는지(서면·구두·전화) 선택하세요.'); return null; }
    const token = await requestApproval(body);
    if (!token) return null;
    return {
      headers: prescriberAuthHeaders(token),
      prescriberId,
      // 🔴 호출부가 본문을 직접 조립하지 않게 한 곳에 모은다 — 종전엔 prescriberId 만 9곳에서 따로 붙였고,
      //    그래서 새 맥락 필드가 생기면 붙이는 곳과 빠뜨리는 곳이 갈렸다.
      fields: {
        ...(prescriberId ? { prescriberId } : {}),
        orderSource,
        // 복창은 구두·전화일 때만 의미가 있다. 참을 기본값으로 두지 않는다.
        ...(isVerbalOrder(orderSource) ? { readBackConfirmed } : {}),
      },
    };
  }, [info, infoState, encounterId, requestApproval, prescriberId, orderSource, readBackConfirmed]);

  const reset = useCallback(() => { setStatus('IDLE'); setError(null); }, []);

  return {
    info, infoState, prescriberId, setPrescriberId, status, error, requestApproval, authorize, reset,
    orderSource, setOrderSource, readBackConfirmed, setReadBackConfirmed,
  };
}

const STATUS_TEXT: Record<DelegateStatus, string> = {
  IDLE: '',
  REQUESTING: '승인 요청 보내는 중…',
  WAITING: '지정 처방의 승인 대기 중… (폰 알림 확인)',
  APPROVED: '승인됨 — 처방을 저장합니다',
  DENIED: '승인이 거부되었습니다',
  EXPIRED: '승인 요청이 만료되었습니다',
  ERROR: '승인 처리 중 오류',
};

/** 책임 처방의 선택 패널 — 비처방 역할일 때만 띄운다 */
export function PrescriberPicker({
  info, infoState, prescriberId, onSelect, status, error,
  orderSource, onOrderSource, readBackConfirmed, onReadBack, orderType,
}: {
  info: AuthorizedPrescribers | null;
  /** 처방 권한 조회 상태 — 필수(실패를 "위임 불요"처럼 아무것도 안 그리면 저장이 왜 멈췄는지 모른다) */
  infoState: 'IDLE' | 'LOADING' | 'OK' | 'ERROR';
  prescriberId: string;
  onSelect: (id: string) => void;
  status: DelegateStatus;
  error?: string | null;
  /** 지시 경로 — 미전달이면 이 칸을 띄우지 않는다(구 호출부 호환) */
  orderSource?: string;
  onOrderSource?: (v: string) => void;
  readBackConfirmed?: boolean;
  onReadBack?: (v: boolean) => void;
  /** 지금 입력 중인 유형 — 주면 유형별 모드로 그린다(본인 권한이면 의사 선택을 띄우지 않는다) */
  orderType?: string;
}) {
  if (infoState === 'ERROR') {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
        처방 권한(책임 처방의 지정 필요 여부)을 확인하지 못했습니다. 확인될 때까지 처방을 저장할 수 없습니다 — 새로고침 후 다시 시도하세요.
      </div>
    );
  }
  if (!info?.delegationRequired) return null;
  if (orderType) {
    const mode = entryModeFor(info, orderType);
    if (mode === 'SELF') {
      return (
        <div role="status" data-entry-mode="SELF" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          본인 권한 오더 — 지정 의사·승인 없이 등록되고 <b>책임자는 본인</b>으로 기록됩니다.
        </div>
      );
    }
    if (mode === 'NONE') {
      return (
        <div role="alert" data-entry-mode="NONE" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          이 직종의 입력 범위에 없는 오더 유형입니다 — 입력할 수 없습니다.
        </div>
      );
    }
  }
  const candidates = info.prescribers.filter((p) => !p.self);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <p className="text-xs font-semibold text-amber-900">책임 처방의 지정 (필수)</p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-amber-800">
        처방 주체는 의사입니다. 입력은 본인 이름으로 기록되고, <b>책임 처방의</b>로 지정한 의사의 승인을 받아야 발행됩니다.
      </p>

      {candidates.length === 0 ? (
        <p className="mt-2 text-[11px] text-rose-700">지정 가능한 의사가 없습니다 — 담당의 배정 후 다시 시도하세요.</p>
      ) : (
        <select
          value={prescriberId}
          onChange={(e) => onSelect(e.target.value)}
          disabled={status === 'WAITING' || status === 'REQUESTING'}
          className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="">— 의사 선택 —</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.department ? ` (${p.department}` : ''}{p.specialty ? `·${p.specialty}` : ''}{p.department ? ')' : ''}{p.attending ? ' · 주치의' : ''}
            </option>
          ))}
        </select>
      )}

      {/* 지시 경로 — 🔴 대리입력에서 이것을 묻지 않으면 원장은 전부 '서면'이 된다(운영 1,769건 전량 WRITTEN 이었다) */}
      {onOrderSource && (
        <div className="mt-2">
          <label className="text-[10.5px] font-semibold text-amber-900">지시를 어떻게 받았습니까? (필수)</label>
          <select
            value={orderSource ?? ''}
            onChange={(e) => onOrderSource(e.target.value)}
            disabled={status === 'WAITING' || status === 'REQUESTING'}
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">— 선택 —</option>
            {ORDER_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {isVerbalOrder(orderSource) && onReadBack && (
            <label className="mt-1.5 flex items-start gap-2 text-[10.5px] leading-relaxed text-amber-900">
              <input
                type="checkbox"
                checked={!!readBackConfirmed}
                onChange={(e) => onReadBack(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                받아 적은 내용을 <b>지시한 의사에게 復唱(복창)하여 확인</b>했습니다.
                {/* 체크하지 않아도 저장은 된다 — 막으면 방치되고, 강제하면 거짓 체크가 된다.
                    확인하지 않은 사실이 원장에 그대로 남는 것이 안전 지표의 분모다. */}
                <span className="block text-amber-700">확인하지 않았다면 체크하지 마세요 — 그대로 기록됩니다.</span>
              </span>
            </label>
          )}
        </div>
      )}

      {info.guideline && <p className="mt-1.5 text-[10.5px] text-amber-700">과 가이드: {info.guideline}</p>}

      {status !== 'IDLE' && (
        <p className={`mt-2 text-[11px] ${status === 'APPROVED' ? 'text-emerald-700' : status === 'WAITING' || status === 'REQUESTING' ? 'text-amber-800' : 'text-rose-700'}`}>
          {status === 'WAITING' && <span className="mr-1 inline-block animate-pulse">●</span>}
          {STATUS_TEXT[status]}
        </p>
      )}
      {error && status !== 'WAITING' && <p className="mt-1 text-[11px] text-rose-700">{error}</p>}
    </div>
  );
}
