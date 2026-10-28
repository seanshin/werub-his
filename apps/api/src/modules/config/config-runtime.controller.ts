import { Controller, Get, Put, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ConfigRuntimeService } from './config-runtime.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetConfigValueDto } from './dto/config-runtime.dto';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NUMERIC_POLICIES, settingValueInvalidReason } from '@hospital-run/shared';

// 전용 승인 워크플로우로만 변경 가능한 보호 키 — 범용 config PUT 우회 차단(스카우트 4차).
// 예: 가명화 컷오버 게이트/승인 레코드는 /admin/phase0-cutover 승인 게이팅을 거쳐야만 변경.
const PROTECTED_KEYS = new Set<string>([
  'integration.pseudonymizeChartNo', // 컷오버 게이트 — 법무 승인 후 execute EP로만
  'integration.cutoverApproval',     // 승인 레코드 — 위조 방지(직접 set 시 approved 조작 가능)
  // 🔴 AI egress 목적지 — 환자 임상 텍스트가 **어디로 나가는지**를 정하는 값이다.
  //    종전엔 ADMIN 이 PUT 한 번으로 임의 호스트(수집 서버)로 돌릴 수 있었다(INV-PHI-03/INV-NET-01).
  //    범용 설정 화면에서 바꿀 성질의 값이 아니다 — 변경은 배포(환경변수/마이그레이션)로만.
  //    ⚠️ '보호'는 **값을 못 바꾸게 하는 것**이지 값을 바꾸는 것이 아니다(현재 값은 그대로 유지된다).
  'ai.server.url',
]);

// 시크릿 키(인증키·토큰·비밀번호)는 HTTP 응답에서 마스킹 — 저권한 계정 노출 방지(보안 C-1)
const SECRET_RE = /(secret|password|token)/i;
function isSecretKey(k: string): boolean {
  return SECRET_RE.test(k) || /key$/i.test((k.split('.').pop() ?? ''));
}
function maskValue(key: string, value: unknown): unknown {
  if (!isSecretKey(key)) return value;
  return typeof value === 'string' && value.length > 0 ? '••••••••(설정됨)' : value;
}

@ApiTags('Config (런타임 설정)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/config')
export class ConfigRuntimeController {
  private readonly logger = new Logger(ConfigRuntimeController.name);
  constructor(
    private readonly configService: ConfigRuntimeService,
    /** 결정 엔진 — 결정에 묶인 설정 보호(설정 모듈은 결정 모듈을 import 하지 못한다 · 이벤트 `decision.configGuard`) */
    private readonly events: EventEmitter2,
  ) {}

  @Get()
  @ApiOperation({ summary: '전체 설정 목록 (시크릿 마스킹) — 각 항목이 source(db/default)·registered 를 함께 말한다' })
  async getAll(@Query('category') category?: string) {
    const list = await this.configService.getAll(category);
    return { data: list.map((e) => ({ ...e, value: maskValue(e.key, e.value) })) };
  }

  @Get('categories')
  @ApiOperation({ summary: '설정 카테고리 목록' })
  async getCategories() { return { data: await this.configService.getCategories() }; }

  @Get('hospital-context')
  @ApiOperation({ summary: '병원 컨텍스트 (AI용)' })
  async getHospitalContext() { return { data: await this.configService.getHospitalContext() }; }

  /**
   * 🔴 `data` 는 **값 그대로** 유지한다 — 이 응답의 `data` 를 값으로 읽는 화면이 10곳 넘는다.
   *    출처는 `meta` 로만 더한다(덧붙이기·기존 소비처 불변).
   */
  @Get(':key')
  @ApiOperation({ summary: '설정값 조회 (시크릿 마스킹) — meta.source 로 값의 출처(db/default/unset)를 함께 말한다' })
  async get(@Param('key') key: string) {
    const { value, source, registered, seeded } = await this.configService.getWithSource(key);
    // seeded — 개발 시드가 넣은 행(원내가 정한 값 아님 · 시드 행일 때만)
    return { data: maskValue(key, value), meta: { source, registered, ...(seeded ? { seeded: true } : {}) } };
  }

  @Put(':key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '설정값 변경 (Admin)' })
  async set(@Param('key') key: string, @Body() body: SetConfigValueDto, @CurrentUser('id') userId: string) {
    // 보호 키는 범용 PUT 차단 — 전용 승인 워크플로우(예: /admin/phase0-cutover)로만 변경
    if (PROTECTED_KEYS.has(key)) {
      const how = key === 'ai.server.url'
        ? '환자 임상 데이터의 외부 전송 목적지라 화면에서 바꿀 수 없습니다 — 변경은 배포(환경변수/마이그레이션)로만'
        : '전용 승인 화면에서만 변경할 수 있습니다';
      throw new BadRequestException({ code: 'CONFIG_KEY_PROTECTED', message: `'${key}'는 ${how}(범용 설정 변경 차단)` });
    }
    // 수치 정책 정밀도(ui.precision.*) — 잠금(법정·안전) 도메인은 위원회 의결로만(서버측 이중 방어)
    const pm = /^ui\.precision\.(.+)$/.exec(key);
    if (pm) {
      const pol = NUMERIC_POLICIES[pm[1]];
      if (!pol) throw new BadRequestException(`알 수 없는 수치 도메인: ${pm[1]}`);
      if (pol.locked) throw new BadRequestException(`'${pol.label}'는 법정·안전 정책이라 위원회 의결로만 변경할 수 있습니다`);
      const n = Number(body.value);
      if (!Number.isInteger(n) || n < 0 || n > 4) throw new BadRequestException('소수 자릿수는 0~4 정수여야 합니다');
    }
    // 결정에 묶인 설정(QI 흐름 2026-10-09 · 배치 10-F 2026-10-10) — 기능이 알아듣는 값만(모르는 값이 저장되면 "정해짐"으로 보이는데 동작은 미설정과 같다)
    const qiInvalid = settingValueInvalidReason(key, body.value);
    if (qiInvalid) throw new BadRequestException({ code: 'CONFIG_VALUE_INVALID', message: '이 설정이 받는 값이 아닙니다', details: { key, reason: qiInvalid } });
    // 마스킹된 플레이스홀더를 그대로 저장하면 실제 시크릿이 덮어써짐 → 무시(변경 없음)
    if (typeof body.value === 'string' && body.value.startsWith('••••••••')) {
      return { data: { key, skipped: true, reason: 'masked-unchanged' } };
    }
    /**
     * 🔴 결정에 묶인 설정 — 결정 엔진이 판정한다(2026-10-11). 결정 경로 밖 변경은 결정 이력에 남고(WARN)
     *    보호 수준이 BLOCK 이면 실결정이 정한 값과 다른 값은 막는다. 결정이 정한 값으로 되돌리는 것은 막지 않는다.
     */
    const prev = await this.configService.get(key);
    const [verdict] = (await this.events.emitAsync('decision.configGuard', { phase: 'check', key, value: body.value })) as Array<{ block: boolean; mode: string; governing: Array<{ key: string; title: string; decidedValue: unknown; seeded: boolean }> } | null>;
    if (verdict?.block) {
      await this.events.emitAsync('decision.configGuard', { phase: 'blocked', key, value: body.value, prev, actorUserId: userId })
        .catch((e) => this.logger.error(`설정 변경 차단 이력 기록 실패(${key}): ${e instanceof Error ? e.message : String(e)}`));
      throw new ConflictException({
        code: 'CONFIG_DECISION_GOVERNED',
        message: '이 설정은 기록된 결정이 정한 값입니다 — 결정 화면에서 결정을 다시 기록하거나 위원회 의결로 바꾸세요.',
        details: { key, decisions: verdict.governing.filter((g) => !g.seeded).map((g) => ({ key: g.key, decidedValue: g.decidedValue })) },
      });
    }
    const saved = await this.configService.set(key, body.value, userId);
    let decisionLog: unknown = null;
    if (verdict && JSON.stringify(prev ?? null) !== JSON.stringify(body.value ?? null)) {
      // 🔴 결정 이력 기록 실패는 저장을 되돌리지 않는다(이미 저장됐다) — 응답이 말한다
      decisionLog = await this.events.emitAsync('decision.configGuard', { phase: 'changed', key, value: body.value, prev, actorUserId: userId })
        .then(() => ({ logged: true, decisions: verdict.governing.map((g) => g.key) }))
        .catch((e) => { this.logger.error(`설정 직접 변경 이력 기록 실패(${key}): ${e instanceof Error ? e.message : String(e)}`); return { logged: false }; });
    }
    return { data: saved, ...(decisionLog ? { meta: { decisionGoverned: decisionLog, protectionMode: verdict?.mode } } : {}) };
  }
}
