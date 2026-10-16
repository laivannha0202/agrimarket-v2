import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { Response } from 'express';

/**
 * Turns every error into a clean JSON body and never leaks Prisma internals
 * or stack traces to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      // The client could not even start (server down, bad credentials, …).
      // This is an infrastructure outage, never the caller's payload.
      ({ status, message, error } = databaseUnreachable());
      this.logger.error(`Prisma initialization failure: ${exception.message}`);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, error } = mapPrismaError(exception));
      if (status === HttpStatus.SERVICE_UNAVAILABLE) {
        this.logger.error(`Prisma ${exception.code}: database unreachable`);
      } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        // Keep the raw code visible in server logs: the response body stays
        // generic, so a silent failure here would be impossible to diagnose.
        this.logger.error(`Prisma ${exception.code} mapped to HTTP ${status}`);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}

/** HTTP 503 body for "MySQL is down / unreachable" (matches the health probe). */
function databaseUnreachable(): { status: number; message: string; error: string } {
  return {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Database is not reachable',
    error: 'ServiceUnavailable',
  };
}

/**
 * True when a Prisma error is really an infrastructure problem: the driver
 * could not open or keep a connection to MySQL.
 *
 * With driver adapters (Prisma 7 + @prisma/adapter-mariadb) a refused
 * connection arrives as a PrismaClientKnownRequestError whose code is not one
 * of the classic P1001/P1002 codes — the original driver error is embedded in
 * `meta.driverAdapterError` — so both the code and the embedded cause are
 * checked. Such a failure must surface as 503 "service unavailable", NEVER as
 * a 400 that the clients render as "invalid data".
 */
function isDatabaseUnreachable(e: Prisma.PrismaClientKnownRequestError): boolean {
  if (e.code === 'P2039') return true;
  const meta = e.meta as { driverAdapterError?: unknown } | undefined;
  const raw = `${e.message} ${JSON.stringify(meta?.driverAdapterError ?? '')}`;
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|pool timeout|Can't reach database/i.test(
    raw,
  );
}

function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
  error: string;
} {
  if (isDatabaseUnreachable(e)) {
    return databaseUnreachable();
  }
  switch (e.code) {
    case 'P2002': {
      const target = Array.isArray(e.meta?.target) ? (e.meta.target as string[]).join(', ') : '';
      return {
        status: HttpStatus.CONFLICT,
        message: target ? `Duplicate value for: ${target}` : 'Duplicate value',
        error: 'Conflict',
      };
    }
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Resource not found', error: 'NotFound' };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Related record not found',
        error: 'BadRequest',
      };
    default:
      // An unrecognised database failure is a server-side problem; it must
      // not masquerade as a client validation error (400).
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Database request failed',
        error: 'InternalServerError',
      };
  }
}
