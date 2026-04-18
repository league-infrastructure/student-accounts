/**
 * Shared type alias used by all repository methods.
 *
 * Repositories are stateless: they do not store the client. Instead, every
 * method accepts a `DbClient` as its first argument so callers can compose
 * multiple repository calls inside a single Prisma interactive transaction.
 *
 * Usage:
 *   // Inside a transaction
 *   await prisma.$transaction(async (tx) => {
 *     await UserRepository.create(tx, data);
 *     await AuditEventRepository.create(tx, auditData);
 *   });
 *
 *   // Outside a transaction (plain client)
 *   await UserRepository.findById(prisma, id);
 */
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';

export type DbClient = PrismaClient | Prisma.TransactionClient;
