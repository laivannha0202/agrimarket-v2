import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { DiscountType } from '../../../generated/prisma/enums.js';

/**
 * Returns true when `value` is a usable discount for `type`.
 *
 * Rules (identical to the service-side guard):
 *   - must be a real, finite number (strings/null/NaN/Infinity are rejected);
 *   - must be >= 0;
 *   - PERCENT must be <= 100.
 *
 * FIXED is intentionally not capped: a fixed amount larger than an order is
 * capped by the order subtotal at checkout time.
 */
export function isValidDiscountValue(type: DiscountType | undefined, value: unknown): boolean {
  if (type !== DiscountType.FIXED && type !== DiscountType.PERCENT) return false;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < 0) return false;
  if (type === DiscountType.PERCENT && value > 100) return false;
  return true;
}

/**
 * Property validator for `discountValue`.
 *
 * A plain `@ValidateIf` on the same property is unsafe: class-validator skips
 * ALL other validators on that property when the condition is false. That made
 * `FIXED -5`, `FIXED "abc"` and `FIXED null` pass (the very bug this replaces).
 * This single conditional validator always runs and checks every rule.
 */
export function IsValidDiscountValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isValidDiscountValue',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const type = (args.object as { discountType?: DiscountType }).discountType;
          return isValidDiscountValue(type, value);
        },
        defaultMessage(args: ValidationArguments): string {
          const value = args.value;
          const type = (args.object as { discountType?: DiscountType }).discountType;

          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return 'discountValue must be a finite number';
          }
          if (value < 0) {
            return 'discountValue must not be negative';
          }
          if (type === DiscountType.PERCENT && value > 100) {
            return 'PERCENT discountValue must not exceed 100';
          }
          return 'discountValue is invalid';
        },
      },
    });
  };
}
