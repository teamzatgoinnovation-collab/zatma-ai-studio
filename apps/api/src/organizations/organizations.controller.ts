import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateOrganizationSchema, type UpdateOrganizationInput } from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@ApiCookieAuth()
@Controller('organizations/current')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermissions('organization:read')
  @ApiOperation({ summary: 'Active organization profile, your role, permissions and plan' })
  current() {
    return this.organizations.current();
  }

  @Patch()
  @RequirePermissions('organization:update')
  @Audit('organization.updated', 'organization', 'response')
  @ApiOperation({ summary: 'Update the active organization profile' })
  update(@Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput) {
    return this.organizations.update(body);
  }

  @Get('members')
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'Members of the active organization' })
  members() {
    return this.organizations.members();
  }
}
