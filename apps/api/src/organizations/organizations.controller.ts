import { Body, Controller, Delete, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { setLogoSchema, updateOrganizationSchema, type SetLogoInput, type UpdateOrganizationInput } from '@zatma/validation';
import { Audit } from '../audit/audit.decorator.js';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@ApiCookieAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('current')
  @RequirePermissions('organization:read')
  @ApiOperation({ summary: 'Active organization profile, your role, permissions and plan' })
  current() {
    return this.organizations.current();
  }

  @Patch('current')
  @RequirePermissions('organization:update')
  @Audit('organization.updated', 'organization', 'response')
  @ApiOperation({ summary: 'Update the active organization profile' })
  update(@Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput) {
    return this.organizations.update(body);
  }

  @Get('current/members')
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'Members of the active organization' })
  members() {
    return this.organizations.members();
  }

  @Put('current/logo')
  @RequirePermissions('organization:update')
  @Audit('organization.logo_updated', 'organization', 'response')
  @ApiOperation({ summary: 'Set the organization logo to an uploaded LOGO image' })
  setLogo(@Body(new ZodValidationPipe(setLogoSchema)) body: SetLogoInput) {
    return this.organizations.setLogo(body.fileId);
  }

  @Delete('current/logo')
  @RequirePermissions('organization:update')
  @Audit('organization.logo_removed', 'organization', 'response')
  @ApiOperation({ summary: 'Remove the organization logo' })
  removeLogo() {
    return this.organizations.setLogo(null);
  }

  @Get('current/invitations')
  @RequirePermissions('member:read')
  @ApiOperation({ summary: 'Pending invitations of the active organization' })
  invitations() {
    return this.organizations.invitations();
  }

  @Get('invitations/:id')
  @Public()
  @ApiOperation({ summary: 'Public details of an invitation (for the accept page)' })
  publicInvitation(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) id: string) {
    return this.organizations.publicInvitation(id);
  }
}
