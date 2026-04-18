export class ServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = 'Not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = 'Not authenticated') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
