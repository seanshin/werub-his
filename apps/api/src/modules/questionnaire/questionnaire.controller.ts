import { Controller, Get, Post, Put, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { QuestionnaireService } from './questionnaire.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GenerateQuestionnaireTokenDto, SubmitQuestionnaireDto } from './dto/questionnaire.dto';

// 인증 필요 엔드포인트
@ApiTags('Questionnaire')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class QuestionnaireController {
  constructor(private readonly service: QuestionnaireService) {}

  @Post('questionnaires/generate-token')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '문진표 토큰 생성' })
  async generateToken(@Body() dto: GenerateQuestionnaireTokenDto) {
    const token = await this.service.generateToken(dto);
    return { data: token };
  }

  @Get('patients/:patientId/questionnaires')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 문진표 목록' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findByPatient(patientId) };
  }
}

// 공개 엔드포인트 (인증 불필요)
/**
 * 🔴 (2026-09-16 I1) 이 클래스는 **무인증 동결 목록에 없었다** — 스캐너가 `@Controller` 앞 800자를 읽다가
 *    바로 위 `QuestionnaireController` 의 `@UseGuards(JwtAuthGuard)` 를 주워 "인증됨"으로 오판했다.
 *    그래서 F1·G2·H1·H2 의 "무인증 140 전건 판정"이 이 세 EP(무인증 쓰기 2 포함)를 **본 적이 없다**.
 *    토큰은 randomUUID·48시간 만료·완료 후 차단이라 fail-closed 지만,
 *    형제 공개 폼(VoC 5/분·제휴 5/분·컨시어지 30/분)과 달리 **자기 한도가 없었다** — 여기서 못박는다.
 */
@ApiTags('Questionnaire (Public)')
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('api/v1/questionnaires')
export class QuestionnairePublicController {
  constructor(private readonly service: QuestionnaireService) {}

  @Get(':token')
  @ApiOperation({ summary: '문진표 폼 조회 (공개)' })
  async getByToken(@Param('token') token: string) {
    return { data: await this.service.getByToken(token) };
  }

  @Post(':token/submit')
  @ApiOperation({ summary: '문진표 제출 (공개)' })
  async submit(@Param('token') token: string, @Body() dto: SubmitQuestionnaireDto) {
    return { data: await this.service.submit(token, dto.data) };
  }

  @Put(':token/save')
  @ApiOperation({ summary: '문진표 임시저장 (공개)' })
  async saveDraft(@Param('token') token: string, @Body() dto: SubmitQuestionnaireDto) {
    return { data: await this.service.saveDraft(token, dto.data) };
  }
}
