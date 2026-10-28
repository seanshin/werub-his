import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExternalCredentialsService } from './external-credentials.service';

/**
 * 외부 자격증명 관제 — **무엇이 아직 밖에서 오지 않았는가**를 한 화면에서 본다.
 *
 * 🔴 값은 담지 않는다. 있는지 없는지와 **없으면 무엇이 안 되는지**만 말한다.
 * 🔴 두 종류를 합치지 않는다 — `FAIL_CLOSED`(없으면 거절)와 `FEATURE_OFF`(없으면 기능만 꺼짐)는
 *    준비율로 합치면 "거의 다 됐다"는 거짓 안심이 된다.
 */
@ApiTags('mobile-app-integrity')
@Controller('api/v1/mobile/external-credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExternalCredentialsController {
  constructor(private readonly credentials: ExternalCredentialsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '네이티브 앱 스택 외부 자격증명 설정 상태' })
  status() {
    return { data: { items: this.credentials.status(), summary: this.credentials.summary() } };
  }
}
