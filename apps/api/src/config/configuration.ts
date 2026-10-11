export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigin: string[];
  /** Public base URL of the Customer Web, used to build password-reset links. */
  customerWebUrl: string;
  /** Mail transport selection — see `MailService`. */
  mailTransport: string;
  mailFrom: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'CHANGE_ME',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigin: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Where the recovery link points. Defaults to the local Customer Web port so
  // a dev machine works without configuration.
  customerWebUrl: process.env.CUSTOMER_WEB_URL ?? 'http://localhost:3002',
  mailTransport: process.env.MAIL_TRANSPORT ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'AgriMarket <no-reply@agrimarket.vn>',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpSecure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
});
