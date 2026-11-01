import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentMethod } from '../../generated/prisma/enums.js';

/**
 * Which payment methods this deployment can actually settle.
 *
 * `PaymentMethod` is a database enum, not a capability list. `VNPAY` and
 * `MOCK_ONLINE` exist because historical rows may carry them, but no payment
 * gateway is integrated: there is no initiation endpoint, no signature
 * verification and no callback. Offering them at checkout would create an order
 * that can never be paid and would let a client "choose" a method that has no
 * implementation behind it.
 *
 * A configuration flag is NOT evidence that a gateway exists. `PAYMENTS_ONLINE_ENABLED`
 * used to be the only gate, so setting it to `true` on a deployment with no
 * VNPay integration made `VNPAY` selectable and let an order reach a payment
 * state nobody could ever settle. Availability is therefore the AND of three
 * independent facts:
 *
 *   1. the deployment flag is on (an operator decision),
 *   2. a gateway adapter is registered for the method (code that exists), and
 *   3. the adapter is allowed in this environment (`MOCK_ONLINE` is refused in
 *      production, so a misconfigured production build cannot accept a fake
 *      "successful" online payment).
 *
 * The registry below is empty on purpose: no gateway has been integrated yet.
 * Adding one means implementing the adapter (initiation + signature check +
 * callback reconciliation) and registering it here — not flipping an env var.
 */

/** A payment gateway this deployment could talk to. */
export interface PaymentGatewayAdapter {
  /** Stable provider id used in logs and audit rows (`vnpay`, `mock`). */
  readonly provider: string;
  /**
   * True only for adapters that move no real money (development stubs).
   * Production refuses these even when the deployment flag is on.
   */
  readonly sandboxOnly: boolean;
}

export type PaymentGatewayRegistry = Partial<Record<PaymentMethod, PaymentGatewayAdapter>>;

/**
 * Integrated gateways. Empty: VNPay is not implemented, and `MOCK_ONLINE` has
 * no adapter outside the test doubles used by unit tests.
 */
export const PAYMENT_GATEWAYS: PaymentGatewayRegistry = Object.freeze({});

export interface PaymentAvailabilityOptions {
  onlineEnabled?: string;
  nodeEnv?: string;
  /** Test seam / future wiring point; defaults to the real registry. */
  gateways?: PaymentGatewayRegistry;
}

export function isOnlinePaymentEnabled(
  raw: string | undefined = process.env.PAYMENTS_ONLINE_ENABLED,
): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/** Whether a real adapter is registered for this method. */
export function isGatewayIntegrated(
  method: PaymentMethod,
  gateways: PaymentGatewayRegistry = PAYMENT_GATEWAYS,
): boolean {
  return gateways[method] != null;
}

export function isPaymentMethodAvailable(
  method: PaymentMethod,
  options: PaymentAvailabilityOptions = {},
): boolean {
  if (method === PaymentMethod.COD) return true;
  if (!isOnlinePaymentEnabled(options.onlineEnabled)) return false;

  const gateway = (options.gateways ?? PAYMENT_GATEWAYS)[method];
  // No adapter = no way to initiate or verify a payment for this method.
  if (!gateway) return false;

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (gateway.sandboxOnly && nodeEnv === 'production') return false;
  if (method === PaymentMethod.MOCK_ONLINE) return nodeEnv !== 'production';
  return true;
}

/**
 * Throws 503 (not 400) when a method exists in the enum but is not configured:
 * the request is well-formed, the deployment simply cannot serve it yet.
 */
export function assertPaymentMethodAvailable(
  method: PaymentMethod,
  options: PaymentAvailabilityOptions = {},
): void {
  if (isPaymentMethodAvailable(method, options)) return;
  throw new ServiceUnavailableException(
    'Phương thức thanh toán trực tuyến chưa được kích hoạt. Vui lòng chọn thanh toán khi nhận hàng (COD).',
  );
}

/** The methods a client may actually choose right now. */
export function availablePaymentMethods(
  options: PaymentAvailabilityOptions = {},
): PaymentMethod[] {
  return Object.values(PaymentMethod).filter((method) =>
    isPaymentMethodAvailable(method, options),
  );
}
