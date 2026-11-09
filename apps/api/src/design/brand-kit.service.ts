import { HttpStatus, Injectable } from '@nestjs/common';
import type { BrandKitDto, BrandKitInput, UpdateBrandKitInput } from '@zatma/validation';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { BrandKit } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_BRAND_KITS = 20;

@Injectable()
export class BrandKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  async toDto(kit: BrandKit): Promise<BrandKitDto> {
    let logoUrl: string | null = null;
    if (kit.logoFileId) {
      const file = await this.db.storedFile.findFirst({ where: { id: kit.logoFileId, status: 'UPLOADED' } });
      if (file) logoUrl = await this.storage.signedUrlForKey(file.key);
    }
    return {
      id: kit.id,
      name: kit.name,
      workspaceId: kit.workspaceId,
      isDefault: kit.isDefault,
      logoFileId: kit.logoFileId,
      logoUrl,
      colors: kit.colors as BrandKitDto['colors'],
      fonts: kit.fonts as BrandKitDto['fonts'],
      tagline: kit.tagline,
      website: kit.website,
      phone: kit.phone,
      whatsapp: kit.whatsapp,
      email: kit.email,
      address: kit.address,
      guidelines: kit.guidelines,
      updatedAt: kit.updatedAt.toISOString(),
    };
  }

  /** Validates references that must belong to the active organization. */
  private async assertRefs(input: { logoFileId?: string | null; workspaceId?: string | null }) {
    if (input.logoFileId) {
      const file = await this.db.storedFile.findFirst({ where: { id: input.logoFileId, status: 'UPLOADED' } });
      if (!file || !file.mimeType.startsWith('image/')) {
        throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_ASSET', 'The logo must be an uploaded image of this organization');
      }
    }
    if (input.workspaceId) {
      const ws = await this.db.workspace.findFirst({ where: { id: input.workspaceId } });
      if (!ws) throw notFound('Workspace');
    }
  }

  async list(): Promise<BrandKitDto[]> {
    const kits = await this.db.brandKit.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return Promise.all(kits.map((k) => this.toDto(k)));
  }

  async getEntity(id: string): Promise<BrandKit> {
    const kit = await this.db.brandKit.findFirst({ where: { id } });
    if (!kit) throw notFound('Brand kit');
    return kit;
  }

  async get(id: string): Promise<BrandKitDto> {
    return this.toDto(await this.getEntity(id));
  }

  /** The kit explicitly requested, else the organization's default, else none. */
  async resolve(id?: string | null): Promise<BrandKit | null> {
    if (id) return this.getEntity(id);
    return this.db.brandKit.findFirst({ where: { isDefault: true } });
  }

  async create(input: BrandKitInput): Promise<BrandKitDto> {
    await this.assertRefs(input);
    const organizationId = TenantContext.requireOrganizationId();
    const count = await this.db.brandKit.count();
    if (count >= MAX_BRAND_KITS) throw new AppException(HttpStatus.CONFLICT, 'LIMIT_REACHED', `An organization can have up to ${MAX_BRAND_KITS} brand kits`);
    const kit = await this.db.brandKit.create({
      data: { ...input, organizationId, isDefault: count === 0 },
    });
    return this.toDto(kit);
  }

  async update(id: string, input: UpdateBrandKitInput): Promise<BrandKitDto> {
    await this.getEntity(id);
    await this.assertRefs(input);
    const kit = await this.db.brandKit.update({ where: { id }, data: input });
    return this.toDto(kit);
  }

  async setDefault(id: string): Promise<BrandKitDto> {
    await this.getEntity(id);
    await this.db.brandKit.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const kit = await this.db.brandKit.update({ where: { id }, data: { isDefault: true } });
    return this.toDto(kit);
  }

  async remove(id: string): Promise<void> {
    const kit = await this.getEntity(id);
    await this.db.brandKit.delete({ where: { id } });
    if (kit.isDefault) {
      const next = await this.db.brandKit.findFirst({ orderBy: { createdAt: 'asc' } });
      if (next) await this.db.brandKit.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
}
