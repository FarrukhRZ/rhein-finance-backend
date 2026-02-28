import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Party } from './entities/party.entity';
import { Deposit, DepositStatus } from './entities/deposit.entity';
import { DamlService } from '../daml/daml.service';
import { UsersService } from '../users/users.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class AdminService {
  private readonly participantAdminHost: string;
  private readonly participantAdminPort: string;

  constructor(
    @InjectRepository(Party)
    private partyRepository: Repository<Party>,
    @InjectRepository(Deposit)
    private depositRepository: Repository<Deposit>,
    private damlService: DamlService,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    this.participantAdminHost = this.configService.get('PARTICIPANT_ADMIN_HOST') || '172.18.0.6';
    this.participantAdminPort = this.configService.get('PARTICIPANT_ADMIN_PORT') || '5002';
  }

  // Helper to validate party ID format
  private validatePartyId(partyId: string): boolean {
    return partyId.includes('::') && partyId.includes('1220');
  }

  private ensureValidPartyId(partyId: string): void {
    if (!this.validatePartyId(partyId)) {
      throw new BadRequestException('Invalid party ID format. Expected format: partyName::1220...');
    }
  }

  /**
   * Create a new party on Canton Network via gRPC PartyManagementService.
   * Uses grpcurl to call AllocateParty on the participant admin API.
   */
  async createParty(displayName: string) {
    console.log(`Creating party via gRPC PartyManagementService: ${displayName}`);

    try {
      const partyId = await this.allocatePartyViaGrpc(displayName);
      console.log(`Successfully created party: ${displayName} -> ${partyId}`);

      // Save party to database
      const party = this.partyRepository.create({
        partyId,
        displayName,
        createdBy: 'admin',
        isIssuer: false,
      });

      await this.partyRepository.save(party);

      return {
        name: displayName,
        id: partyId,
        dbId: party.id,
      };
    } catch (error) {
      console.error('Error creating party:', error);
      throw new BadRequestException(
        `Failed to create party: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Allocate party using gRPC PartyManagementService on the participant admin port.
   * Uses execFile (not exec) to avoid shell injection.
   */
  private async allocatePartyViaGrpc(displayName: string): Promise<string> {
    // Ledger API gRPC is on port 5001 (not the Canton admin port 5002)
    const host = `${this.participantAdminHost}:5001`;
    const partyIdHint = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const payload = JSON.stringify({
      party_id_hint: partyIdHint,
    });

    console.log(`Calling gRPC AllocateParty on ${host} with hint: ${partyIdHint}`);

    const { stdout } = await execFileAsync('grpcurl', [
      '-plaintext',
      '-d', payload,
      host,
      'com.daml.ledger.api.v2.admin.PartyManagementService/AllocateParty',
    ]);

    const result = JSON.parse(stdout);
    const partyId = result.party_details?.party || result.partyDetails?.party;

    if (!partyId) {
      console.error('Unexpected gRPC response:', stdout);
      throw new Error('gRPC AllocateParty did not return a party ID');
    }

    return partyId;
  }

  /**
   * Onboard a registered user: allocate Canton party, link to user, issue initial USDC.
   */
  async onboardUser(userId: string, initialUsdcAmount?: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    if (user.partyId) {
      throw new BadRequestException(`User ${user.email} is already onboarded with party ${user.partyId}`);
    }

    const displayName = user.firstName || user.email.split('@')[0];
    // Use lowercase alphanumeric username + random suffix for uniqueness
    const baseName = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const suffix = Math.random().toString(36).slice(2, 6);
    const damlUsername = `${baseName}-${suffix}`;
    console.log(`[Onboard] Registering user ${user.email} (${userId}) with validator as "${damlUsername}"`);

    // 1. Register with validator → creates DAML user + Canton party + wallet
    const partyId = await this.damlService.registerWithValidator(damlUsername);

    // 2. Link party to user record
    await this.usersService.update(userId, { partyId });

    // 3. Save party record in DB and link to user
    const party = this.partyRepository.create({
      partyId,
      displayName: damlUsername,
      createdBy: 'admin',
      isIssuer: false,
      userId,
    });
    await this.partyRepository.save(party);

    // 4. Issue initial USDC
    const usdcAmount = initialUsdcAmount || 100000;
    const issueResult = await this.damlService.issueTokensToParty(partyId, usdcAmount);

    console.log(`[Onboard] User ${user.email} onboarded: party=${partyId}, USDC=${usdcAmount}`);

    return {
      success: true,
      user: {
        id: userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      party: {
        partyId,
        displayName,
      },
      wallet: {
        usdcIssued: usdcAmount,
        issueSuccess: issueResult.success,
        message: issueResult.message,
      },
    };
  }

  async approveDeposit(data: {
    partyId: string;
    assetType: 'USDC' | 'CC';
    amount: number;
    externalReference?: string;
  }) {
    this.ensureValidPartyId(data.partyId);

    const partyName = data.partyId.split('::')[0];

    console.log(`Approving deposit for ${data.partyId}:`);
    console.log(`  Asset: ${data.assetType}`);
    console.log(`  Amount: ${data.amount}`);
    if (data.externalReference) {
      console.log(`  External Ref: ${data.externalReference}`);
    }

    // Find or create party in database
    let party = await this.partyRepository.findOne({
      where: { partyId: data.partyId }
    });

    console.log('Found party in DB:', party);

    if (!party) {
      // Create party record if it doesn't exist
      party = this.partyRepository.create({
        partyId: data.partyId,
        displayName: partyName,
        createdBy: 'system',
        isIssuer: false,
      });
      party = await this.partyRepository.save(party);
    }

    // Create deposit record
    const deposit = this.depositRepository.create({
      partyDbId: party.id,
      partyId: data.partyId,
      partyName,
      assetType: data.assetType,
      amount: data.amount,
      externalReference: data.externalReference,
      status: 'approved' as DepositStatus,
      approvedBy: 'admin',
      approvedAt: new Date(),
    });

    // Issue tokens
    const result = await this.damlService.issueTokensToParty(data.partyId, data.amount);
    console.log('Token issuance result:', result);
    // Update deposit status based on result
    if (result.success) {
      deposit.status = 'completed';
      deposit.completedAt = new Date();
    } else {
      deposit.status = 'failed';
      deposit.errorMessage = result.message;
    }

    await this.depositRepository.save(deposit);

    return {
      success: result.success,
      message: result.message || `Successfully issued ${data.amount} ${data.assetType} to ${partyName}`,
      deposit: {
        id: deposit.id,
        partyId: data.partyId,
        partyName,
        assetType: data.assetType,
        amount: data.amount,
        externalReference: data.externalReference,
        status: deposit.status,
        timestamp: deposit.approvedAt,
      },
    };
  }

  async getAllParties() {
    const parties = await this.partyRepository.find({
      order: { createdAt: 'DESC' },
    });

    // Filter out invalid party IDs (those that don't match the proper format)
    // Valid format: Name::1220[64 hex chars]
    const validPartyIdRegex = /^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/;

    return parties
      .filter(p => validPartyIdRegex.test(p.partyId))
      .map(p => ({
        name: p.displayName,
        id: p.partyId,
        isIssuer: p.isIssuer,
        createdAt: p.createdAt,
        createdBy: p.createdBy,
      }));
  }

  async getDepositHistory(filters?: {
    partyId?: string;
    status?: string;
    assetType?: string;
  }) {
    const query = this.depositRepository.createQueryBuilder('deposit');

    if (filters?.partyId) {
      query.andWhere('deposit.partyId = :partyId', { partyId: filters.partyId });
    }
    if (filters?.status) {
      query.andWhere('deposit.status = :status', { status: filters.status });
    }
    if (filters?.assetType) {
      query.andWhere('deposit.assetType = :assetType', { assetType: filters.assetType });
    }

    const deposits = await query
      .orderBy('deposit.createdAt', 'DESC')
      .getMany();

    return deposits;
  }

  async getDepositById(id: string) {
    const deposit = await this.depositRepository.findOne({ where: { id } });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    return deposit;
  }

  async getStats() {
    const [totalParties, totalDeposits] = await Promise.all([
      this.partyRepository.count(),
      this.depositRepository.count(),
    ]);

    const [completedDeposits, failedDeposits] = await Promise.all([
      this.depositRepository.count({ where: { status: 'completed' } }),
      this.depositRepository.count({ where: { status: 'failed' } }),
    ]);

    // Calculate total amounts by asset type
    const usdcDeposits = await this.depositRepository
      .createQueryBuilder('deposit')
      .select('SUM(deposit.amount)', 'total')
      .where('deposit.assetType = :type', { type: 'USDC' })
      .andWhere('deposit.status = :status', { status: 'completed' })
      .getRawOne();

    const ccDeposits = await this.depositRepository
      .createQueryBuilder('deposit')
      .select('SUM(deposit.amount)', 'total')
      .where('deposit.assetType = :type', { type: 'CC' })
      .andWhere('deposit.status = :status', { status: 'completed' })
      .getRawOne();

    return {
      totalParties,
      totalDeposits,
      completedDeposits,
      failedDeposits,
      pendingDeposits: totalDeposits - completedDeposits - failedDeposits,
      totalUSDCIssued: parseFloat(usdcDeposits?.total || '0'),
      totalCCIssued: parseFloat(ccDeposits?.total || '0'),
    };
  }

  async clearDatabase() {
    console.log('Clearing database...');

    // Clear all deposits using query builder
    const depositsResult = await this.depositRepository
      .createQueryBuilder()
      .delete()
      .from(Deposit)
      .execute();
    console.log(`Deleted ${depositsResult.affected || 0} deposits`);

    // Clear all parties using query builder
    const partiesResult = await this.partyRepository
      .createQueryBuilder()
      .delete()
      .from(Party)
      .execute();
    console.log(`Deleted ${partiesResult.affected || 0} parties`);

    return {
      success: true,
      message: 'Database cleared successfully',
      deleted: {
        deposits: depositsResult.affected || 0,
        parties: partiesResult.affected || 0,
      },
    };
  }

  async cleanupInvalidParties() {
    console.log('Cleaning up invalid party IDs...');

    const validPartyIdRegex = /^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/;

    // Find all parties with invalid party IDs
    const allParties = await this.partyRepository.find();
    const invalidParties = allParties.filter(p => !validPartyIdRegex.test(p.partyId));

    let deletedCount = 0;

    // Delete invalid parties from parties table
    if (invalidParties.length > 0) {
      const idsToDelete = invalidParties.map(p => p.id);
      const result = await this.partyRepository.delete(idsToDelete);
      deletedCount = result.affected || 0;
      console.log(`Deleted ${deletedCount} invalid parties from parties table`);
    }

    // Also clean up invalid partyIds in users table (set to null)
    const usersResult = await this.partyRepository.query(
      `UPDATE users SET "partyId" = NULL WHERE "partyId" IS NOT NULL AND "partyId" !~ '^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$'`
    );

    return {
      success: true,
      message: `Cleaned up ${deletedCount} invalid party records and reset invalid user partyIds`,
      deleted: {
        parties: deletedCount,
        userPartyIdsReset: usersResult[1] || 0,
      },
      invalidParties: invalidParties.map(p => ({
        displayName: p.displayName,
        invalidPartyId: p.partyId,
      })),
    };
  }
}
