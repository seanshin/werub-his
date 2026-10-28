import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FinanceBenchmarkService } from './finance-benchmark.service';
import { ImportDisclosureDto } from './finance-benchmark.dto';

const yearOf = (v?: string) => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new BadRequestException({ code: 'YEAR_INVALID' });
  return n;
};

/**
 * 경영성과 벤치마크(의료기관 회계정보공시 손익) — 경영진·관리자 조회 · 가져오기는 관리자.
 * 감사: 가져오기(변이)는 전역 인터셉터 기본 감사 · 조회는 환자 정보가 아니다(기관 공시 손익).
 */
@ApiTags('finance-benchmark')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
@Controller('api/v1/finance-benchmark')
export class FinanceBenchmarkController {
  constructor(private readonly svc: FinanceBenchmarkService) {}

  @Get('overview')
  @ApiOperation({ summary: '동급 통계(평균·중앙값·사분위·n) + 우리 병원(설정 지정 시) 편차' })
  async overview(@Query('year') year?: string, @Query('type') type?: string) {
    return { data: await this.svc.overview(yearOf(year), type || undefined) };
  }

  @Get('institutions')
  @ApiOperation({ summary: '기관 목록 — 지역(시도·시군구) 내 의료이익 비교·지도' })
  async institutions(@Query('year') year?: string, @Query('type') type?: string, @Query('sido') sido?: string, @Query('sigungu') sigungu?: string) {
    return { data: await this.svc.institutions(yearOf(year), type || undefined, sido || undefined, sigungu || undefined) };
  }

  @Get('trend')
  @ApiOperation({ summary: '한 기관의 연도별 의료이익률·경상이익률 + 동급 중앙값' })
  async trend(@Query('name') name?: string, @Query('code') code?: string) {
    // 기관 코드가 있으면 코드로 잇는다(연도마다 이름 표기가 다르다) · 없으면 이름
    if (code?.trim()) {
      if (!/^[0-9A-Za-z-]{1,20}$/.test(code.trim())) throw new BadRequestException({ code: 'CODE_INVALID' });
      return { data: await this.svc.trend(undefined, code.trim()) };
    }
    if (!name?.trim()) throw new BadRequestException({ code: 'NAME_REQUIRED' });
    return { data: await this.svc.trend(name.trim()) };
  }

  @Get('detail')
  @ApiOperation({ summary: '한 기관·한 해 손익 세목 드릴다운 + 같은 종별 동급 비중 중앙값' })
  async detail(@Query('code') code?: string, @Query('name') name?: string, @Query('year') year?: string) {
    if (code?.trim()) {
      if (!/^[0-9A-Za-z-]{1,20}$/.test(code.trim())) throw new BadRequestException({ code: 'CODE_INVALID' });
      return { data: await this.svc.detail(code.trim(), undefined, yearOf(year)) };
    }
    if (!name?.trim()) throw new BadRequestException({ code: 'NAME_REQUIRED' });
    return { data: await this.svc.detail(undefined, name.trim(), yearOf(year)) };
  }

  @Get('imports')
  @ApiOperation({ summary: '가져오기 이력(최근 20)' })
  async imports() {
    return { data: await this.svc.imports() };
  }

  @Post('imports')
  @Roles(UserRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '공시 손익 CSV 가져오기(UTF-8 · 머리행=공시 열 이름) — 항등식 검증 · 기관·연도 upsert' })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_r, file, cb) => {
      const ok = /\.csv$/i.test(file.originalname) || file.mimetype === 'text/csv';
      cb(ok ? null : new BadRequestException({ code: 'CSV_ONLY' }), ok);
    },
  }))
  async importCsv(
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: ImportDisclosureDto,
    @CurrentUser('id') userId: string,
  ) {
    if (!file?.buffer) throw new BadRequestException({ code: 'FILE_REQUIRED' });
    return { data: await this.svc.importCsv(file, body.sourceNote, userId ?? null) };
  }
}
