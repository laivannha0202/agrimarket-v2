import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/enums.js';

export class CheckoutAddressDto {
  @ApiProperty({ example: 'Nguyễn Thị Lan' })
  @IsString()
  recipientName!: string;

  @ApiProperty({ example: '0912345678' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: 'Hưng Yên' })
  @IsString()
  province!: string;

  @ApiPropertyOptional({ example: 'Văn Lâm' })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({ example: 'Tân Quang' })
  @IsOptional()
  @IsString()
  ward?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  village?: string;

  @ApiProperty({ example: 'Số 12, đường Nguyễn Văn Linh' })
  @IsString()
  detail!: string;
}

export class CheckoutItemDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  productVariantId!: number;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

export class CheckoutDto {
  @ApiProperty({ type: CheckoutAddressDto })
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  shippingAddress!: CheckoutAddressDto;

  @ApiPropertyOptional({ type: [CheckoutItemDto], description: 'Defaults to the current cart' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items?: CheckoutItemDto[];

  @ApiPropertyOptional({ example: 'HUNGYEN50K' })
  @IsOptional()
  @IsString()
  voucherCode?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.COD })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ example: 20000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
