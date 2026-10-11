import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';
import { LocationsService } from '../locations/locations.service.js';
import {
  buildPagination,
  normalizeSearch,
  paginate,
  type PaginatedResult,
} from '../common/dto/pagination-query.dto.js';
import {
  CreateAddressDto,
  CreateUserDto,
  UpdateAddressDto,
  UpdateMyProfileDto,
} from './dto/user.dto.js';
import { normalizeVietnamesePhone } from '../common/utils/phone.util.js';
import { normalizeWhitespace } from '../common/utils/vietnamese-text.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';

/**
 * The scalar address columns this service writes.
 *
 * Declared explicitly rather than reusing `Prisma.AddressUncheckedUpdateInput`
 * because the generated update type allows field-level operations (`{ set: … }`)
 * that this code never produces, and mixing it with the create input makes the
 * resulting object unassignable to either.
 */
interface AddressWriteData {
  recipientName?: string;
  phone?: string;
  province?: string;
  provinceCode?: string | null;
  wardCode?: string | null;
  wardName?: string | null;
  district?: string | null;
  ward?: string | null;
  village?: string | null;
  detail?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role ?? UserRole.CUSTOMER;
    return this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone,
        role,
        status: dto.status,
        customerProfile: role === UserRole.CUSTOMER ? { create: {} } : undefined,
      },
      select: this.safeSelect(),
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: UserStatus;
    role?: UserRole;
  }): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = buildPagination(query.page, query.limit);
    const search = normalizeSearch(query.search);
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { email: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'desc' },
        select: this.safeSelect(),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...this.safeSelect(), customerProfile: { include: { addresses: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async addAddress(customerId: number, dto: CreateAddressDto) {
    const profile = await this.requireProfile(customerId);
    const data = await this.resolveAddressData(dto);

    // `CreateAddressDto` marks these four as required, so the resolver always
    // sets them. Re-checking here keeps the guarantee explicit at the point
    // where a NULL would actually corrupt a row, instead of asserting it to the
    // compiler with a non-null `!`.
    const { recipientName, phone, province, detail } = data;
    if (!recipientName || !phone || !province || !detail) {
      throw new BadRequestException('Thiếu thông tin địa chỉ giao hàng');
    }

    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { customerId: profile.id },
        data: { isDefault: false },
      });
    }

    return this.prisma.address.create({
      data: {
        customerId: profile.id,
        recipientName,
        phone,
        province,
        detail,
        provinceCode: data.provinceCode ?? null,
        wardCode: data.wardCode ?? null,
        wardName: data.wardName ?? null,
        district: data.district ?? null,
        ward: data.ward ?? null,
        village: data.village ?? null,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  /**
   * Update one of the caller's own addresses.
   *
   * The address is looked up by `(id, customerId)` so another customer's address
   * is indistinguishable from a missing one (404) and can never be edited.
   */
  async updateAddress(customerId: number, addressId: number, dto: UpdateAddressDto) {
    const profile = await this.requireProfile(customerId);
    await this.requireOwnAddress(profile.id, addressId);
    const data = await this.resolveAddressData(dto, { partial: true });

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({
          where: { customerId: profile.id, id: { not: addressId } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({ where: { id: addressId }, data });
    });
  }

  /**
   * Normalises and validates an address payload server-side.
   *
   * This is the ONLY gate for address data — the clients validate too, but their
   * checks are for feedback, not for trust:
   *
   *   - When `wardCode` is supplied it MUST exist in the verified catalogue of
   *     the given province. The official name is then read from the catalogue
   *     and stored in `wardName`; the client's own spelling is discarded, so a
   *     forged name cannot be persisted alongside a valid code, and a code from
   *     another province cannot be smuggled in.
   *   - `province` is forced to the catalogue's province name when a ward code
   *     resolves, so the display line and the code can never disagree.
   *   - The phone is normalised to the local 10-digit form and rejected when it
   *     is not a valid Vietnamese mobile number.
   *   - `detail` must be non-empty after trimming.
   *
   * Legacy fields (`district`, `ward`) are passed through untouched. They are
   * NOT derived from the new code: an old address keeps the text it was saved
   * with, and a new address simply does not set them.
   */
  private async resolveAddressData(
    dto: CreateAddressDto | UpdateAddressDto,
    options: { partial?: boolean } = {},
  ): Promise<AddressWriteData> {
    const data: AddressWriteData = {};

    if (dto.recipientName !== undefined) {
      const recipientName = normalizeWhitespace(dto.recipientName);
      if (!recipientName) throw new BadRequestException('Vui lòng nhập tên người nhận');
      data.recipientName = recipientName;
    }

    if (dto.phone !== undefined) {
      const phone = normalizeVietnamesePhone(dto.phone);
      if (!phone) throw new BadRequestException('Số điện thoại chưa hợp lệ');
      data.phone = phone;
    }

    if (dto.detail !== undefined) {
      const detail = normalizeWhitespace(dto.detail);
      if (!detail) throw new BadRequestException('Vui lòng nhập địa chỉ chi tiết');
      data.detail = detail;
    }

    if (dto.village !== undefined) {
      data.village = dto.village.trim() ? normalizeWhitespace(dto.village) : null;
    }

    // --- Commune level -----------------------------------------------------
    if (dto.wardCode !== undefined && dto.wardCode !== null && dto.wardCode !== '') {
      const provinceCode = (dto.provinceCode ?? '').trim();
      if (!provinceCode) {
        throw new BadRequestException('Thiếu mã tỉnh/thành phố cho xã/phường đã chọn');
      }

      const ward = await this.locations.findWard(provinceCode, dto.wardCode.trim());
      if (!ward) {
        throw new BadRequestException('Xã/phường không hợp lệ hoặc không thuộc tỉnh đã chọn');
      }

      data.provinceCode = ward.provinceCode;
      data.wardCode = ward.code;
      // Official name from the catalogue, never the client's text.
      data.wardName = ward.fullName;
      data.province = ward.provinceName;
      // The new model has no district level; a district sent alongside a valid
      // ward code would contradict it, so it is not stored.
      data.district = null;
    } else if (dto.provinceCode !== undefined) {
      // A province code without a ward code is only meaningful as a partial
      // update that clears the selection.
      data.provinceCode = dto.provinceCode.trim() || null;
    }

    // --- Legacy free-text fields -------------------------------------------
    // Only touched when the request actually carries them AND no ward code was
    // resolved, so editing a new-style address cannot resurrect a district.
    if (dto.district !== undefined && data.wardCode === undefined) {
      data.district = dto.district.trim() ? normalizeWhitespace(dto.district) : null;
    }
    if (dto.ward !== undefined && data.wardCode === undefined) {
      data.ward = dto.ward.trim() ? normalizeWhitespace(dto.ward) : null;
    }
    if (dto.province !== undefined && data.wardCode === undefined) {
      const province = normalizeWhitespace(dto.province);
      if (!province && !options.partial) {
        throw new BadRequestException('Vui lòng nhập tỉnh/thành phố');
      }
      if (province) data.province = province;
    }

    // A create must end up with a usable address.
    if (!options.partial) {
      if (!data.province) throw new BadRequestException('Vui lòng nhập tỉnh/thành phố');
    }

    return data;
  }

  /** Delete one of the caller's own addresses. */
  async removeAddress(customerId: number, addressId: number) {
    const profile = await this.requireProfile(customerId);
    await this.requireOwnAddress(profile.id, addressId);
    await this.prisma.address.delete({ where: { id: addressId } });
    return { id: addressId, deleted: true };
  }

  /**
   * Make one of the caller's own addresses the default.
   *
   * Exactly one default per customer: the flag is cleared on the others in the
   * same transaction, so the invariant cannot be broken by a concurrent call.
   */
  async setDefaultAddress(customerId: number, addressId: number) {
    const profile = await this.requireProfile(customerId);
    await this.requireOwnAddress(profile.id, addressId);

    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { customerId: profile.id, id: { not: addressId } },
        data: { isDefault: false },
      });
      return tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
    });
  }

  /** Own profile: name and phone. Email and role are not editable by the customer. */
  async updateProfile(userId: number, dto: UpdateMyProfileDto) {
    await this.requireUser(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...dto },
      select: this.safeSelect(),
    });
  }

  private async requireUser(userId: number): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async requireProfile(userId: number) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Customer profile not found');
    return profile;
  }

  /** Loads an address that belongs to `profileId`, or throws 404. */
  private async requireOwnAddress(profileId: number, addressId: number) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, customerId: profileId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  async listAddresses(customerId: number) {
    const profile = await this.requireProfile(customerId);
    return this.prisma.address.findMany({
      where: { customerId: profile.id },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
    });
  }

  async setStatus(id: number, status: UserStatus): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN && status === UserStatus.INACTIVE) {
      const adminCount = await this.prisma.user.count({ where: { role: UserRole.ADMIN } });
      if (adminCount <= 1) throw new BadRequestException('Cannot deactivate the last admin');
    }
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  private safeSelect() {
    return {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.UserSelect;
  }
}
