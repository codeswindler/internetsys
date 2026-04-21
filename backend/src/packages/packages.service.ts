import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package } from '../entities/package.entity';
import { Subscription } from '../entities/subscription.entity';
import { Voucher } from '../entities/voucher.entity';

type PackageRemoveResult =
  | { action: 'deleted'; packageId: string }
  | {
      action: 'archived';
      package: Package;
      packageId: string;
      subscriptions: number;
      vouchers: number;
    };

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private packageRepo: Repository<Package>,
    @InjectRepository(Subscription)
    private subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Voucher)
    private voucherRepo: Repository<Voucher>,
  ) {}

  async create(createDto: Partial<Package>): Promise<Package> {
    const pkg = this.packageRepo.create(createDto);
    return this.packageRepo.save(pkg);
  }

  async findAll(activeOnly = true): Promise<Package[]> {
    if (activeOnly) {
      return this.packageRepo.find({ where: { isActive: true } });
    }
    return this.packageRepo.find();
  }

  async findOne(id: string): Promise<Package> {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException(`Package ${id} not found`);
    return pkg;
  }

  async update(id: string, updateDto: Partial<Package>): Promise<Package> {
    const pkg = await this.findOne(id);
    Object.assign(pkg, updateDto);
    return this.packageRepo.save(pkg);
  }

  async remove(id: string): Promise<PackageRemoveResult> {
    const pkg = await this.findOne(id);

    const [subscriptions, vouchers] = await Promise.all([
      this.subscriptionRepo.count({ where: { package: { id } } }),
      this.voucherRepo.count({ where: { package: { id } } }),
    ]);

    if (subscriptions > 0 || vouchers > 0) {
      pkg.isActive = false;
      const archived = await this.packageRepo.save(pkg);
      return {
        action: 'archived',
        package: archived,
        packageId: id,
        subscriptions,
        vouchers,
      };
    }

    await this.packageRepo.remove(pkg);
    return { action: 'deleted', packageId: id };
  }
}
