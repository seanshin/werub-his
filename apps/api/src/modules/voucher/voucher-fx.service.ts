import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { safeFetch } from '../../common/util/safe-fetch';

// 정산 환율(DB-2) — 1 단위 외화 = ? KRW(기준환율). ERP 회신 v2: HIS가 BOK 기준환율 스냅샷 동봉.
// fx.bokApiKey 미설정 시 시뮬레이션 폴백([[dev_simulation_registry]] 패턴·source=SIMULATION으로 투명 표기).
const SIM_RATES: Record<string, number> = {
  USD: 1350, CNY: 190, JPY: 9, EUR: 1450, GBP: 1700, HKD: 173, SGD: 1000, AUD: 890, THB: 38, VND: 0.054, RUB: 14, TWD: 42,
};
// BOK ECOS 통계항목(731Y001 환율통계·일자료·매매기준율 종가)
const BOK_ITEM: Record<string, string> = { USD: '0000001', JPY: '0000002', EUR: '0000003', CNY: '0000053' };

@Injectable()
export class VoucherFxService {
  private readonly logger = new Logger(VoucherFxService.name);
  constructor(private readonly configRuntime: ConfigRuntimeService) {}

  /** 기준환율 스냅샷. KRW→1(BASE). 외화는 BOK ECOS(키설정) 우선·실패/미설정 시 SIMULATION. */
  async getKrwRate(currency: string): Promise<{ rate: number; source: string; date: string }> {
    const cur = (currency || 'KRW').toUpperCase();
    const date = new Date().toISOString().slice(0, 10);
    if (cur === 'KRW') return { rate: 1, source: 'BASE', date };

    const apiKey = (await this.configRuntime.get('fx.bokApiKey')) as string | undefined;
    if (apiKey && BOK_ITEM[cur]) {
      try {
        const r = await this.fetchBok(cur, apiKey);
        if (r && r > 0) return { rate: r, source: 'BOK', date };
      } catch (e) { this.logger.warn(`BOK 환율 조회 실패(${cur}): ${(e as Error).message}`); }
    }
    const sim = SIM_RATES[cur];
    if (sim == null) throw new BadRequestException({ code: 'FX_UNSUPPORTED', message: `환율 미지원 통화: ${cur} (BOK 키 또는 시뮬 레이트 필요)` });
    return { rate: sim, source: 'SIMULATION', date };
  }

  /** BOK ECOS 매매기준율(731Y001·일자료). 최근 7일 중 마지막(영업일) 값. */
  private async fetchBok(cur: string, apiKey: string): Promise<number | null> {
    const end = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/1/10/731Y001/D/${start}/${end}/${BOK_ITEM[cur]}`;
    const res = await safeFetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { StatisticSearch?: { row?: { DATA_VALUE: string }[] } };
    const rows = json?.StatisticSearch?.row ?? [];
    const last = rows[rows.length - 1];
    return last ? Number(last.DATA_VALUE) : null;
  }
}
