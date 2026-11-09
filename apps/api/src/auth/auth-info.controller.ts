import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthProviders } from '@zatma/types';
import { Public } from '../common/decorators/auth.decorators.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthInfoController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('providers')
  @Public()
  @ApiOperation({ summary: 'Sign-in methods enabled on this deployment' })
  providers(): AuthProviders {
    return {
      emailPassword: true,
      google: Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET),
      requireEmailVerification: this.env.REQUIRE_EMAIL_VERIFICATION,
    };
  }
}
