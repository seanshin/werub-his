import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StepUpService } from './step-up.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { StepUpVerifyDto } from './dto/step-up.dto';

@ApiTags('auth-step-up')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/auth/step-up')
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Post('options')
  @ApiOperation({ summary: 'step-up 재인증 옵션(챌린지) 발급' })
  async options(@CurrentUser('id') userId: string) {
    return { data: await this.stepUp.getOptions(userId) };
  }

  @Post('verify')
  @ApiOperation({ summary: 'step-up assertion 검증 → step-up 토큰(action·resource·bodyHash 바인딩)' })
  async verify(@CurrentUser('id') userId: string, @Body() body: StepUpVerifyDto) {
    return {
      data: await this.stepUp.verify(userId, body.response, body.action, body.resourceId, body.bodyHash),
    };
  }
}
