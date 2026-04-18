import request from 'supertest';
import express from 'express';
import {
  AppError,
  ServiceError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from '../../server/src/errors';
import { errorHandler } from '../../server/src/middleware/errorHandler';

// --- Unit tests for error classes ---

describe('AppError hierarchy', () => {
  it('AppError has correct statusCode and message', () => {
    const err = new AppError('test error', 418);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe('test error');
    expect(err.name).toBe('AppError');
  });

  it('ServiceError (deprecated) extends AppError', () => {
    const err = new ServiceError('test error', 418);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe('ServiceError');
  });

  it('NotFoundError defaults to 404', () => {
    const err = new NotFoundError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('NotFoundError accepts custom message', () => {
    const err = new NotFoundError('User 42 not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('User 42 not found');
  });

  it('ValidationError defaults to 422', () => {
    const err = new ValidationError('Invalid input');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Invalid input');
    expect(err.name).toBe('ValidationError');
  });

  it('UnauthorizedError defaults to 401', () => {
    const err = new UnauthorizedError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Not authenticated');
    expect(err.name).toBe('UnauthorizedError');
  });

  it('ForbiddenError defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Insufficient permissions');
    expect(err.name).toBe('ForbiddenError');
  });

  it('ConflictError defaults to 409', () => {
    const err = new ConflictError('Already exists');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Already exists');
    expect(err.name).toBe('ConflictError');
  });
});

// --- Integration tests for error handler middleware ---

describe('Error handler middleware', () => {
  function createTestApp(errorToThrow: Error) {
    const app = express();
    app.get('/test', () => {
      throw errorToThrow;
    });
    app.use(errorHandler);
    return app;
  }

  it('returns 404 for NotFoundError', async () => {
    const app = createTestApp(new NotFoundError('Item not found'));
    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Item not found' });
  });

  it('returns 422 for ValidationError', async () => {
    const app = createTestApp(new ValidationError('Bad input'));
    const res = await request(app).get('/test');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Bad input' });
  });

  it('returns 401 for UnauthorizedError', async () => {
    const app = createTestApp(new UnauthorizedError());
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not authenticated' });
  });

  it('returns 403 for ForbiddenError', async () => {
    const app = createTestApp(new ForbiddenError());
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Insufficient permissions' });
  });

  it('returns 409 for ConflictError', async () => {
    const app = createTestApp(new ConflictError('Duplicate entry'));
    const res = await request(app).get('/test');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Duplicate entry' });
  });

  it('returns 500 with generic message for unknown errors', async () => {
    const app = createTestApp(new Error('secret internal details'));
    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    // Must NOT leak the original error message
    expect(res.body.error).not.toContain('secret');
  });
});

// --- Test that health endpoint includes version ---

describe('Health endpoint version', () => {
  it('GET /api/health includes version field', async () => {
    const app = (await import('../../server/src/app')).default;
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
  });
});
