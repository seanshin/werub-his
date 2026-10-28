import { Body, Controller, Get, Headers, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ErpAccessSyncService } from './erp-access-sync.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

class ErpRosterUserDto {
  @IsString() email!: string;
  @IsOptional() @IsString() erpRole?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() employeeCode?: string;
}

class ErpAccessSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ErpRosterUserDto)
  users!: ErpRosterUserDto[];

  @IsOptional() @IsIn(['replace', 'merge']) mode?: 'replace' | 'merge';
}

// ERP 명단 → HIS 일괄 동기화 (서버-서버, X-Integration-Key). ERP=소스 오브 트루스.
@ApiTags('ERP Integration (Access 명단 동기화)')
@SkipThrottle()
@Controller('api/v1/integration/erp')
export class ErpAccessSyncController {
  constructor(
    private readonly svc: ErpAccessSyncService,
    private readonly configRuntime: ConfigRuntimeService,
  ) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  @Post('access-sync')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 사용자 명단 → HIS ERP접근(SSO) 허용 일괄 동기화(인바운드)' })
  async accessSync(@Headers('x-integration-key') key: string, @Body() dto: ErpAccessSyncDto) {
    await this.auth(key);
    return { data: await this.svc.sync(dto.users, dto.mode ?? 'replace') };
  }

  @Get('access-sync/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ADMIN: 최근 ERP 명단 동기화 결과(리포트)' })
  async status() {
    return { data: (await this.configRuntime.get('erp.accessSyncMeta')) ?? null };
  }
}
