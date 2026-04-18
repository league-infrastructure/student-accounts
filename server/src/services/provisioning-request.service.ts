/**
 * ProvisioningRequestService — stub for Sprint 001.
 *
 * Business logic for provisioning request approval, rejection, and
 * processing is deferred to a later sprint. This stub exists to allow
 * ServiceRegistry to instantiate it without errors.
 *
 * The repository layer (ProvisioningRequestRepository) provides all
 * DB-level operations and is fully tested in T006.
 */

import { ProvisioningRequestRepository } from './repositories/provisioning-request.repository.js';
import type { ProvisioningRequest } from '../generated/prisma/client.js';

export class ProvisioningRequestService {
  constructor(private prisma: any) {}

  /** Return all pending provisioning requests, oldest first. */
  async findPending(): Promise<ProvisioningRequest[]> {
    return ProvisioningRequestRepository.findPending(this.prisma);
  }

  /** Return all provisioning requests for a specific user. */
  async findByUser(userId: number): Promise<ProvisioningRequest[]> {
    return ProvisioningRequestRepository.findByUser(this.prisma, userId);
  }
}
