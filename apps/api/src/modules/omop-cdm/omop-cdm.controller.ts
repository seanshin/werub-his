import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { OmopCdmService } from './omop-cdm.service';

/**
 * 🔴 2026-08-14 W7 — 이 컨트롤러의 응답은 전부 날조였다(하드코딩 행수·난수 품질점수·가짜 진행률).
 *    변환 파이프라인이 구현될 때까지 변환/추출 EP 는 501 로 거절하고,
 *    현황 EP 는 "CDM 미구축 + 변환 대상(소스) 실측"만 말한다. 상세는 service 주석 참조.
 */
@ApiTags('OMOP CDM')
@Controller('api/v1/cdm')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OmopCdmController {
  constructor(private readonly omopCdmService: OmopCdmService) {}

  @Post('convert')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'EMR → OMOP CDM 변환 실행 (미구현)',
    description: '변환 파이프라인 미구현 — 501 Not Implemented. 성공을 흉내내지 않는다.',
  })
  @ApiResponse({ status: 501, description: 'CDM_CONVERSION_NOT_IMPLEMENTED' })
  runConversion(
    @Body()
    body: {
      sourceSchema: string;
      targetCdmVersion: string;
      includeTables: string[];
      incrementalMode: boolean;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.omopCdmService.runConversion(body);
  }

  @Get('convert/:jobId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '변환 작업 상태 조회 (작업 없음)',
    description: '변환 이력 저장소가 없다 — 항상 404. 종전 인메모리 Map 은 재시작마다 유실됐다.',
  })
  @ApiResponse({ status: 404, description: 'CDM_JOB_NOT_FOUND' })
  getConversionStatus(@Param('jobId') jobId: string) {
    return this.omopCdmService.getConversionStatus(jobId);
  }

  @Get('tables')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'CDM 테이블 실재 여부 + 변환 대상(소스 EMR) 실측 건수',
    description: 'cdmRecordCount 는 테이블이 없으면 null. sourceRecordCount 는 변환 결과가 아니라 소스 실측.',
  })
  getTableCounts() {
    return this.omopCdmService.getTableCounts();
  }

  @Get('quality')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '데이터 품질 리포트 (산출 불가)',
    description: '품질 검증 로직 미구현 — 모든 지표 null, tables 는 빈 목록.',
  })
  getQualityReport() {
    return this.omopCdmService.getQualityReport();
  }

  @Get('extract/:jobId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: '변환 데이터 추출 다운로드 (미구현)',
    description: '추출 산출물이 존재하지 않는다 — 501.',
  })
  @ApiResponse({ status: 501, description: 'CDM_EXTRACT_NOT_IMPLEMENTED' })
  downloadExtract(@Param('jobId') jobId: string) {
    return this.omopCdmService.downloadExtract(jobId);
  }
}
