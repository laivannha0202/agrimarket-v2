import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../dto/pagination-query.dto.js';

/**
 * Query DTO for `GET /audit-logs` (ADMIN).
 *
 * The audit trail is append-only and is only read for investigations, so the
 * list supports narrowing by the fields an operator actually has in hand:
 * the action, the entity, the actor and a date range. `search` (inherited)
 * matches the action / entity type / entity id as a contains filter.
 */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'REFUND_COMPLETE' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'Refund' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  actorUserId?: number;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
