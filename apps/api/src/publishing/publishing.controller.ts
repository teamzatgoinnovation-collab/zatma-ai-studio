import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  approvePostSchema,
  calendarQuerySchema,
  createPostSchema,
  listPostsSchema,
  postMediaSchema,
  postTargetInputSchema,
  publishNowSchema,
  rejectPostSchema,
  schedulePostSchema,
  socialSettingsSchema,
  updatePostSchema,
  type CalendarQuery,
  type CreatePostInput,
  type ListPostsQuery,
  type SchedulePostInput,
  type SocialSettings,
  type UpdatePostInput,
} from '@zatma/validation';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator.js';
import { RequirePermissions } from '../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { PublishingService } from './publishing.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });
const validateSchema = z
  .object({
    caption: z.string().max(63_206).default(''),
    hashtags: z.array(z.string().max(100)).max(30).default([]),
    media: z.array(postMediaSchema).max(20).default([]),
    targets: z.array(postTargetInputSchema).max(25).default([]),
  })
  .strict();

@ApiTags('Social publishing')
@ApiCookieAuth()
@Controller('social')
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Get('settings')
  @RequirePermissions('social:read')
  settings() {
    return this.publishing.settingsDto();
  }

  @Patch('settings')
  @RequirePermissions('social:publish', 'organization:update')
  @Audit('social.settings_updated', 'organization')
  updateSettings(@Body(new ZodValidationPipe(socialSettingsSchema)) body: SocialSettings) {
    return this.publishing.updateSettings(body);
  }

  @Get('posts')
  @RequirePermissions('social:read')
  list(@Query(new ZodValidationPipe(listPostsSchema)) q: ListPostsQuery) {
    return this.publishing.list(q);
  }

  @Get('calendar')
  @RequirePermissions('social:read')
  @ApiOperation({ summary: 'Posts scheduled or published in a date range (max 62 days)' })
  calendar(@Query(new ZodValidationPipe(calendarQuerySchema)) q: CalendarQuery) {
    return this.publishing.calendar(q);
  }

  @Post('posts/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:draft')
  @ApiOperation({ summary: 'Dry-run platform validation for a draft' })
  validate(@Body(new ZodValidationPipe(validateSchema)) body: z.infer<typeof validateSchema>) {
    return this.publishing.validateDraft(body);
  }

  @Post('posts')
  @RequirePermissions('social:draft')
  create(@Body(new ZodValidationPipe(createPostSchema)) body: CreatePostInput) {
    return this.publishing.create(body);
  }

  @Get('posts/:id')
  @RequirePermissions('social:read')
  get(@Param('id', uuid) id: string) {
    return this.publishing.getWithMedia(id);
  }

  @Patch('posts/:id')
  @RequirePermissions('social:draft')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updatePostSchema)) body: UpdatePostInput) {
    return this.publishing.update(id, body);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('social:draft')
  remove(@Param('id', uuid) id: string) {
    return this.publishing.remove(id);
  }

  @Post('posts/:id/duplicate')
  @RequirePermissions('social:draft')
  duplicate(@Param('id', uuid) id: string) {
    return this.publishing.duplicate(id);
  }

  @Post('posts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:draft')
  submit(@Param('id', uuid) id: string) {
    return this.publishing.submit(id);
  }

  @Post('posts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:publish')
  approve(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(approvePostSchema)) body: { note?: string }) {
    return this.publishing.approve(id, body.note);
  }

  @Post('posts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:publish')
  reject(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(rejectPostSchema)) body: { note: string }) {
    return this.publishing.reject(id, body.note);
  }

  @Post('posts/:id/schedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:publish')
  schedule(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(schedulePostSchema)) body: SchedulePostInput) {
    return this.publishing.schedule(id, body);
  }

  @Post('posts/:id/publish')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 30), ttl: 60_000 } })
  @RequirePermissions('social:publish')
  @ApiOperation({ summary: 'Publish now. Requires { confirm: true }: this posts to the selected accounts immediately.' })
  publish(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(publishNowSchema)) _body: { confirm: true }) {
    return this.publishing.publishNow(id);
  }

  @Post('posts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:publish')
  cancel(@Param('id', uuid) id: string) {
    return this.publishing.cancel(id);
  }

  @Post('posts/:id/targets/:targetId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('social:publish')
  retry(@Param('id', uuid) id: string, @Param('targetId', uuid) targetId: string) {
    return this.publishing.retry(id, targetId);
  }
}
