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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, error } = mapPrismaError(exception));
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

function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
  error: string;
} {
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
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Database request failed',
        error: 'BadRequest',
      };
  }
}
