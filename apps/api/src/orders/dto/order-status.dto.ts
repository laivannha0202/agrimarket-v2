import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { OrderStatus } from '../../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}

/** Query DTO for `GET /orders` (admin): strict order-status enum. */
export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  declare status?: OrderStatus;
}

/**
 * Query DTO for `GET /orders/me` (customer). The status filter is a strict
 * enum, so the server-side filter and `meta.total` are accurate and an unknown
 * value is a 400 rather than a silently ignored parameter.
 */
export class MyOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  declare status?: OrderStatus;
}

/**
 * Body of `POST /orders/delivery-reconciliation` (ADMIN): reconcile one order
 * (`orderId` set) or walk every flagged order (`orderId` omitted).
 *
 * `dryRun` defaults to `true` on purpose: a bare POST only reports. Rewriting
 * status rows is an explicit `dryRun: false` decision.
 */
export class DeliveryReconciliationDto {
  @ApiPropertyOptional({
    description: 'Repair one order only; omit to scan all DELIVERED orders',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'true (default): report the decision without writing; false: execute the repair',
  })
  @IsOptional()
  @IsBoolean()
  dryRun: boolean = true;
}
