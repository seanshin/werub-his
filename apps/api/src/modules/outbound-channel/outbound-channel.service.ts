import { Injectable, Optional } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { OUTBOUND_CHANNELS, CHANNEL_FAMILY_LABEL, type OutboundChannelDef, type ChannelFamily } from './outbound-channel.registry';
import { GO_LIVE_REGISTRY } from '../go-live/go-live.registry';
import { EGRESS_ROUTES, egressSummary } from '@hospital-run/shared';

export interface OutboundChannelView extends OutboundChannelDef {
  /** 운영 설정값. `null` = 설정 키가 없거나 값을 읽지 못했다(추측하지 않는다) */
  enabled: boolean | null;
  /**
   * 🔴 지금 이 채널로 **실제로 나가는가**.
   *   true  = 구현됐고 설정도 켜져 있다
   *   false = 나가지 않는다(구현 안 됐거나 설정이 꺼져 있다) — `blockedBy` 가 이유를 말한다
   *   null  = **판정할 수 없다**(구현 여부를 코드에서 못 읽었다)
   */
  effective: boolean | null;
  blockedBy: 'NOT_IMPLEMENTED' | 'DISABLED_BY_CONFIG' | null;
  /** 비어 있어서 발송을 막는 설정 키들(있으면 화면이 그대로 보여준다) */
  missingConfig: string[];
  familyLabel: string;
}

/**
 * 설정값 하나가 "채워져 있는가". `null` = **읽지 못했다**(모른다) — 꺼짐과 구분한다.
 * 🔴 `SIMULATION` 은 발신이 아니다.
 */
function satisfied(v: unknown, field?: string): boolean | null {
  if (v === undefined) return false; // 키 자체가 없다 = 채워지지 않았다(모르는 것과 다르다)
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim() !== '' && v.trim().toUpperCase() !== 'SIMULATION';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (field) return typeof o[field] === 'string' ? (o[field] as string).trim() !== '' : o[field] != null;
    return Object.keys(o).length > 0;
  }
  return null; // 모양을 모르는 값 — 추측하지 않는다
}

@Injectable()
export class OutboundChannelService {
  constructor(@Optional() private readonly config?: ConfigRuntimeService) {}

  /**
   * 대외 발신 채널 현황.
   * 🔴 "최근 발신 건수"는 담지 않는다 — 채널마다 저장 위치가 달라(원장·JSON·로그) 한 번에
   * 정확히 셀 수 없다. 부정확한 수치를 관제에 올리면 그 수치가 근거로 쓰인다.
   * 필요해지면 채널별 계수 근거를 먼저 확정한 뒤 붙인다.
   */
  async list(family?: ChannelFamily | 'NON_AGENCY'): Promise<{ channels: OutboundChannelView[]; measuredAt: string; caveat: string }> {
    const scope = OUTBOUND_CHANNELS.filter((c) =>
      !family ? true : family === 'NON_AGENCY' ? c.family !== 'AGENCY' : c.family === family);
    const out: OutboundChannelView[] = [];
    for (const c of scope) {
      // 🔴 `requires` **전부**를 본다. 하나만 보고 "켜졌다"고 말하면 관제가 거짓말한다
      //    (실측: `email.provider='RESEND'` 여도 `email.resendApiKey` 가 비면 코드는 시뮬레이션한다).
      let enabled: boolean | null = c.requires.length === 0 ? null : true;
      const missing: string[] = [];
      for (const req of c.requires) {
        let ok: boolean | null;
        try {
          ok = satisfied(await this.config?.get(req.key), req.field);
        } catch {
          ok = null; // 🔴 읽지 못한 것을 "꺼짐"이라 말하지 않는다
        }
        if (ok === null) { enabled = null; break; }
        if (!ok) { enabled = false; missing.push(req.field ? `${req.key}.${req.field}` : req.key); }
      }

      let effective: boolean | null;
      let blockedBy: OutboundChannelView['blockedBy'] = null;
      if (c.implemented === false) { effective = false; blockedBy = 'NOT_IMPLEMENTED'; }
      else if (c.implemented === null) { effective = null; }
      else if (enabled === false) { effective = false; blockedBy = 'DISABLED_BY_CONFIG'; }
      else if (enabled === null && c.requires.length > 0) { effective = null; } // 설정을 못 읽었다 = 판정 불가
      else effective = true;

      out.push({ ...c, enabled, effective, blockedBy, missingConfig: missing, familyLabel: CHANNEL_FAMILY_LABEL[c.family] });
    }
    return {
      channels: out,
      measuredAt: new Date().toISOString(),
      caveat:
        '구현 여부는 코드 선언(각 모듈의 채널 상수)에서 읽는다. 발신 건수는 채널마다 저장 위치가 달라 담지 않는다.',
    };
  }

  /**
   * 🔴 외부 전송 경로(egress) — 채널 **아래층**의 네트워크 호출 지점 정본(shared `egress-inventory`)을 같은 관제에 싣는다.
   *    채널 선언은 "발송 기능이 켜졌나"를 말하고, 이것은 "어느 코드가 어느 목적지로 무엇을 보내나"를 말한다.
   *    🔴 국가 프로파일(`country.institutionProfile`) 결정 전이라 **허용/금지 판정을 하지 않는다**(`verdict: null`).
   *    🔴 목적지는 코드가 가리키는 것만(env·설정 키 이름) — 운영 설정값을 읽어 "원내다"라고 추정하지 않는다.
   */
  egressInventory() {
    return {
      routes: EGRESS_ROUTES,
      summary: egressSummary(),
      verdictNote: '국가 프로파일 결정 전 — 국외 이전 허용/금지를 판정하지 않았습니다. 목적지는 코드가 가리키는 설정 키이며 운영 설정값이 원내인지는 확인하지 않았습니다.',
    };
  }

  /**
   * 🔴 기관 연동 전용 — **별도 메뉴로 관리한다**(2026-08-20 사람 결정).
   *
   * 기관 전송은 성격이 다르다: 법정 의무이고, 대외 계약·인증서가 선행하며,
   * **실 서비스 개시 전까지 구현되어 있으면 된다**(지금 미구현은 결함이 아니라 예정된 상태다).
   * 그래서 메시지 채널·환자 푸시와 한 화면에 섞지 않는다.
   *
   * 담당·개시 추적은 **Go-Live 등록부가 정본**이다 — 여기서 다시 적지 않고 연결만 한다
   * (`sourceKey: 'channel:<KEY>'` 로 등재된 항목을 역으로 찾는다).
   */
  async listAgency() {
    const base = await this.list('AGENCY');
    const channels = base.channels.map((c) => {
      const item = GO_LIVE_REGISTRY.find(
        (g) => g.sourceKey?.startsWith('channel:') && g.sourceKey.slice(8).split(',').map((k) => k.trim()).includes(c.key),
      );
      return {
        ...c,
        goLive: item
          ? { key: item.key, title: item.title, owner: item.owner ?? null, note: item.note ?? null, blocking: item.isBlocking !== false }
          : null, // 🔴 등재되지 않았으면 그렇게 말한다 — 추적되고 있다고 지어내지 않는다
      };
    });
    return {
      ...base,
      channels,
      caveat:
        '구현 여부는 각 모듈의 채널 상수에서 읽는다. 담당·개시 추적의 정본은 Go-Live 등록부이며 여기서는 연결만 한다. ' +
        '🔴 미구현은 현재 결함이 아니라 **실 서비스 개시 전 완료 대상**이다 — 그동안 신고·청구는 수기로 대체된다.',
    };
  }
}