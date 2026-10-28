import {
  Controller, Get, Post, Put, Param, Body,
  UseGuards, ParseUUIDPipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FormEngineService } from './form-engine.service';
import { CreateFormSchemaDto, UpdateFormSchemaDto } from './dto/create-form-schema.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Form Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class FormEngineController {
  constructor(private readonly formEngineService: FormEngineService) {}

  @Get('forms')
  @ApiOperation({ summary: '폼 스키마 목록' })
  async findAll() {
    const schemas = await this.formEngineService.findAllSchemas();
    return { data: schemas };
  }

  @Get('forms/:name')
  @ApiOperation({ summary: '폼 스키마 상세 (렌더링용)' })
  async findByName(@Param('name') name: string) {
    const schema = await this.formEngineService.findSchemaByName(name);
    return { data: schema };
  }

  @Post('forms')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '폼 스키마 생성' })
  async create(
    @Body() dto: CreateFormSchemaDto,
    @CurrentUser('id') userId: string,
  ) {
    const schema = await this.formEngineService.createSchema(dto, userId);
    return { data: schema };
  }

  // 🔴 W8 — `Partial<CreateFormSchemaDto>` 는 런타임 메타타입이 Object 라 ValidationPipe 가 스킵됐다.
  //         DTO 클래스로 바꿔 검증을 되살린다(서버 부분 갱신 규칙은 service.updateSchema 주석 참조).
  @Put('forms/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '폼 스키마 수정 — 부분 갱신(보내지 않은 최상위 키 보존·문항 소거 거부) · 문항이 바뀌면 새 판' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFormSchemaDto,
    @CurrentUser('id') userId: string,
  ) {
    const schema = await this.formEngineService.updateSchema(id, dto, userId);
    return { data: schema };
  }

  // 2026-10-21 임상 규칙 P5 A7 — 판 기록(판마다 받은 제출 수 · 판 원장 시작 전 제출 수)
  @Get('forms/:id/revisions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '폼 판 기록 — 판·출처·제출 수(관리자)' })
  async revisions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.formEngineService.revisions(id) };
  }

  @Get('forms/:id/revisions/:revision')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '폼 한 판의 문항 그대로(관리자)' })
  async revision(@Param('id', ParseUUIDPipe) id: string, @Param('revision', ParseIntPipe) revision: number) {
    return { data: await this.formEngineService.revision(id, revision) };
  }
}
