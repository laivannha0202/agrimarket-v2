/**
 * Mail delivery.
 *
 * TRANSPORT SELECTION (all from the environment, never hardcoded)
 *
 *   `MAIL_TRANSPORT=smtp`  Real delivery through the configured SMTP server.
 *                          Requires SMTP_HOST (and credentials when the server
 *                          needs them). This is the ONLY mode in which an e-mail
 *                          actually leaves the machine.
 *   `MAIL_TRANSPORT=test`  No network. Messages are captured in memory and can
 *                          be asserted on (see `sentMessages`). Used by the test
 *                          suite so the recovery flow is exercised end to end
 *                          without inventing a delivery that never happened.
 *   (unset)                Falls back to `smtp` when SMTP_HOST is present,
 *                          otherwise to `test`.
 *
 * HONESTY ABOUT DELIVERY
 *   `deliveryMode` reports which transport is active, and the password-recovery
 *   endpoint surfaces it. A `test` transport is NOT delivery: the API never
 *   claims an e-mail was sent when no SMTP server is configured.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export type MailTransportMode = 'smtp' | 'test';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** A captured message, exposed for assertions in the test suite. */
export interface CapturedMessage extends MailMessage {
  capturedAt: Date;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  readonly mode: MailTransportMode;

  /** Messages captured while running on the `test` transport. */
  private readonly captured: CapturedMessage[] = [];

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('smtpHost') ?? '';
    const requested = (this.config.get<string>('mailTransport') ?? '').toLowerCase();

    this.mode =
      requested === 'smtp' || requested === 'test' ? requested : host ? 'smtp' : 'test';

    this.from = this.config.get<string>('mailFrom') ?? 'AgriMarket <no-reply@agrimarket.vn>';

    if (this.mode === 'smtp') {
      this.transport = createTransport({
        host,
        port: this.config.get<number>('smtpPort') ?? 587,
        secure: this.config.get<boolean>('smtpSecure') ?? false,
        auth: this.config.get<string>('smtpUser')
          ? {
              user: this.config.get<string>('smtpUser') as string,
              pass: this.config.get<string>('smtpPassword') ?? '',
            }
          : undefined,
      });
    } else {
      // `jsonTransport` serialises instead of sending: nothing leaves the
      // process, so a test can never mail a real person by accident.
      this.transport = createTransport({ jsonTransport: true });
    }
  }

  /** True when messages are really delivered over the network. */
  get isRealDelivery(): boolean {
    return this.mode === 'smtp';
  }

  /**
   * Sends one message.
   *
   * The caller decides what to do on failure — for password recovery the
   * response is identical either way (see `AuthService.forgotPassword`), so a
   * delivery problem can never be used to probe which e-mails exist.
   */
  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (this.mode === 'test') {
        this.captured.push({ ...message, capturedAt: new Date() });
      }
    } catch (error) {
      // The address and the body are never logged: a recovery mail contains a
      // live reset link, and the recipient is personal data.
      this.logger.error(
        `Mail delivery failed (mode=${this.mode}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw error;
    }
  }

  /**
   * Messages captured by the `test` transport, newest last.
   *
   * Exposed for the test suite and for local debugging. Always empty in `smtp`
   * mode, where nothing is retained.
   */
  sentMessages(): readonly CapturedMessage[] {
    return this.captured;
  }

  /** Clears the capture buffer. Used between tests. */
  clearCaptured(): void {
    this.captured.length = 0;
  }
}
