import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateProfileSchema, type UpdateProfileInput } from '@zatma/validation';
import { CurrentAuth, SessionOnly } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { RequestAuth } from '../common/request.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @SessionOnly()
  @ApiOperation({ summary: 'Current user with organization memberships' })
  me(@CurrentAuth() auth: RequestAuth) {
    return this.users.getCurrent(auth.userId, auth.activeOrganizationId);
  }

  @Patch('me')
  @SessionOnly()
  @ApiOperation({ summary: 'Update profile (name, locale, timezone)' })
  update(@CurrentAuth() auth: RequestAuth, @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput) {
    return this.users.update(auth.userId, auth.activeOrganizationId, body);
  }
}
