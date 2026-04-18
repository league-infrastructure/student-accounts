---
status: pending
priority: high
source: inventory app (server/src/middleware/errorHandler.ts)
---

# Typed ServiceError Hierarchy

Replace generic error handling with a typed error class hierarchy that
maps to HTTP status codes. Services throw specific errors; the error
handler middleware translates them to responses.

## Error Classes

Create `server/src/errors.ts`:

```typescript
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
```

## Error Handler Middleware

Update `server/src/middleware/errorHandler.ts`:

```typescript
export function errorHandler(
  err: Error, req: Request, res: Response, next: NextFunction
) {
  if (err instanceof ServiceError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

## Usage in Services

```typescript
// In UserService:
async getById(id: number) {
  const user = await this.prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError(`User ${id} not found`);
  return user;
}

async create(data: CreateUserInput) {
  const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new ConflictError(`User with email ${data.email} already exists`);
  return this.prisma.user.create({ data });
}
```

Routes become thin — they call the service and let errors propagate to
the middleware:

```typescript
router.get('/:id', requireAuth(), async (req, res) => {
  const user = await registry.users.getById(Number(req.params.id));
  res.json(user);
});
// NotFoundError → 404, no try/catch needed in the route
```

## Reference Files

- Inventory: `server/src/middleware/errorHandler.ts`
- Inventory: services throw these errors throughout

## Verification

- Service throwing NotFoundError returns 404 to client
- Service throwing ValidationError returns 400
- Unhandled errors return 500 without leaking stack traces
- Error messages are included in the JSON response body
