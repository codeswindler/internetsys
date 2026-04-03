import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Voucher } from '../entities/voucher.entity';
import { Package } from '../entities/package.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class VouchersService {
  constructor(
    @InjectRepository(Voucher) private voucherRepo: Repository<Voucher>,
    @InjectRepository(Package) private packageRepo: Repository<Package>,
  ) {}

  async generateBatch(packageId: string, count: number): Promise<Voucher[]> {
    const pkg = await this.packageRepo.findOne({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException('Package not found');

    const vouchers: Voucher[] = [];
    for (let i = 0; i < count; i++) {
      // Generate a random 10-character alphanumeric code
      const code =
        Math.random().toString(36).substring(2, 7) +
        Math.random().toString(36).substring(2, 7);

      const voucher = this.voucherRepo.create({
        code: code.toUpperCase(),
        package: pkg,
      });
      vouchers.push(voucher);
    }

    return this.voucherRepo.save(vouchers);
  }

  async findAll(): Promise<Voucher[]> {
    return this.voucherRepo.find({
      relations: ['package', 'redeemedByUser'],
      order: { createdAt: 'DESC' },
    });
  }

  async redeem(
    code: string,
    user: User,
    routerId: string,
    subscriptionsService: any,
  ): Promise<any> {
    const voucher = await this.voucherRepo.findOne({
      where: { code },
      relations: ['package'],
    });
    if (!voucher) throw new NotFoundException('Invalid voucher code');
    if (voucher.isRedeemed)
      throw new BadRequestException('Voucher has already been redeemed');

    // Purchase using SubscriptionsService
    const sub = await subscriptionsService.purchase(
      user.id,
      voucher.package.id,
      routerId,
    );

    // Activate immediately
    const activated = await subscriptionsService.activate(
      sub.id,
      'voucher',
      voucher.code,
    );

    // Mark as redeemed
    voucher.isRedeemed = true;
    voucher.redeemedByUser = user;
    voucher.redeemedAt = new Date();
    await this.voucherRepo.save(voucher);

    return activated;
  }
}
