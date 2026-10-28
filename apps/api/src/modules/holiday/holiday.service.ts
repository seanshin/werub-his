import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';

@Injectable()
export class HolidayService {
  private readonly logger = new Logger(HolidayService.name);
  private readonly apiKey: string;
  // 🔴 2026-08-20 http → https. 종전엔 `DATA_GO_KR_API_KEY` 가 **평문 HTTP 쿼리스트링**으로 나갔다
  //    (경로상 누구나 키를 읽을 수 있다). 같은 host·path 가 https 로 동일 응답(401 SERVICE_KEY_IS_NULL)을
  //    주는 것을 확인하고 바꿨다 — 리다이렉트 없음(safeFetch 는 리다이렉트를 따라가지 않는다).
  private readonly apiUrl = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

  // 메모리 캐시 (연도별)
  private cache = new Map<number, { dates: Set<string>; loadedAt: number }>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('DATA_GO_KR_API_KEY', '');
  }

  /** 해당 날짜가 공휴일인지 확인 */
  async isHoliday(date: Date): Promise<boolean> {
    const dateStr = date.toISOString().slice(0, 10);
    const year = date.getFullYear();
    const holidays = await this.getHolidaySet(year);
    return holidays.has(dateStr);
  }

  /** 해당 날짜의 공휴일 이름 반환 (없으면 null) */
  async getHolidayName(date: Date): Promise<string | null> {
    const holiday = await this.prisma.holidayCalendar.findFirst({
      where: { date: { equals: new Date(date.toISOString().slice(0, 10)) }, isHoliday: true },
    });
    return holiday?.name ?? null;
  }

  /** 연도의 공휴일 Set (YYYY-MM-DD) — 캐시 우선 */
  async getHolidaySet(year: number): Promise<Set<string>> {
    // 메모리 캐시 확인
    const cached = this.cache.get(year);
    if (cached && Date.now() - cached.loadedAt < this.CACHE_TTL) {
      return cached.dates;
    }

    // DB 조회
    const dbHolidays = await this.prisma.holidayCalendar.findMany({
      where: { year, isHoliday: true },
      select: { date: true },
    });

    if (dbHolidays.length > 0) {
      const dates = new Set(dbHolidays.map(h => h.date.toISOString().slice(0, 10)));
      this.cache.set(year, { dates, loadedAt: Date.now() });
      return dates;
    }

    // DB 비어있으면 API 동기화 시도
    await this.syncFromApi(year);
    const afterSync = await this.prisma.holidayCalendar.findMany({
      where: { year, isHoliday: true },
      select: { date: true },
    });
    const dates = new Set(afterSync.map(h => h.date.toISOString().slice(0, 10)));
    this.cache.set(year, { dates, loadedAt: Date.now() });
    return dates;
  }

  /** 해당 연도 공휴일 목록 조회 */
  async getHolidays(year: number) {
    return this.prisma.holidayCalendar.findMany({
      where: { year },
      orderBy: { date: 'asc' },
    });
  }

  /** data.go.kr API에서 공휴일 동기화 */
  async syncFromApi(year: number): Promise<{ synced: number; total: number }> {
    if (!this.apiKey) {
      this.logger.warn('DATA_GO_KR_API_KEY not configured, using seed data');
      return { synced: 0, total: 0 };
    }

    let total = 0;
    let synced = 0;

    try {
      // 1~12월 전체 조회
      for (let month = 1; month <= 12; month++) {
        const url = `${this.apiUrl}?ServiceKey=${this.apiKey}&solYear=${year}&solMonth=${String(month).padStart(2, '0')}&_type=json&numOfRows=50`;
        // 🔴 종전 타임아웃 없음(12개월 루프가 무한 대기할 수 있었다) → 8s 신설.
        const res = await safeFetch(url, {}, { timeoutMs: 8000 });
        if (!res.ok) continue;

        const data = await res.json() as any;
        const items = data?.response?.body?.items?.item;
        if (!items) continue;

        const itemList = Array.isArray(items) ? items : [items];
        for (const item of itemList) {
          if (item.isHoliday !== 'Y') continue;
          const locdate = String(item.locdate);
          const dateStr = `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`;

          try {
            await this.prisma.holidayCalendar.upsert({
              where: { date_name: { date: new Date(dateStr), name: item.dateName } },
              create: {
                date: new Date(dateStr),
                name: item.dateName,
                type: this.classifyHolidayType(item.dateName),
                isHoliday: true,
                year,
                source: 'API',
              },
              update: { isHoliday: true, source: 'API' },
            });
            synced++;
          } catch {}
          total++;
        }
      }

      // 캐시 무효화
      this.cache.delete(year);
      this.logger.log(`Holiday sync ${year}: ${synced}/${total} synced`);
    } catch (e) {
      if (e instanceof EgressBlockedError) {
        // 차단 = "공휴일 없음"이 아니다. 동기화가 일어나지 않았다는 사실을 남긴다.
        this.logger.error(`공휴일 API 송신 차단(SSRF 방어): ${e.message}. ${year}년 동기화가 수행되지 않았습니다.`);
      } else {
        this.logger.error(`Holiday API sync error: ${e}`);
      }
    }

    return { synced, total };
  }

  /** 병원 자체 휴무 추가 */
  async addHospitalHoliday(date: Date, name: string) {
    return this.prisma.holidayCalendar.upsert({
      where: { date_name: { date, name } },
      create: { date, name, type: 'HOSPITAL', isHoliday: true, year: date.getFullYear(), source: 'MANUAL' },
      update: { isHoliday: true },
    });
  }

  /** 영업일 계산: 주말 + 공휴일 제외한 날짜 목록 */
  async getBusinessDays(startDate: Date, count: number): Promise<Date[]> {
    const year = startDate.getFullYear();
    const holidays = await this.getHolidaySet(year);
    // 연말 넘어갈 수 있으므로 다음 해도 로드
    const nextYearHolidays = await this.getHolidaySet(year + 1);
    const allHolidays = new Set([...holidays, ...nextYearHolidays]);

    const result: Date[] = [];
    const d = new Date(startDate);
    let safety = 0;
    while (result.length < count && safety < 60) {
      d.setDate(d.getDate() + 1);
      safety++;
      const day = d.getDay();
      if (day === 0 || day === 6) continue; // 주말
      if (allHolidays.has(d.toISOString().slice(0, 10))) continue; // 공휴일
      result.push(new Date(d));
    }
    return result;
  }

  /** 공휴일을 피해 날짜 이동 */
  async skipHolidays(date: Date, direction: 1 | -1 = 1): Promise<Date> {
    const year = date.getFullYear();
    const holidays = await this.getHolidaySet(year);
    const d = new Date(date);
    let safety = 0;
    while (safety < 14) {
      const day = d.getDay();
      const dateStr = d.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6 && !holidays.has(dateStr)) break;
      d.setDate(d.getDate() + direction);
      safety++;
    }
    return d;
  }

  private classifyHolidayType(name: string): string {
    if (/대체/.test(name)) return 'SUBSTITUTE';
    if (/임시/.test(name)) return 'TEMPORARY';
    return 'NATIONAL';
  }
}
