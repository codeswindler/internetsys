import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Package } from './package.entity';
import { User } from './user.entity';

@Entity('vouchers')
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @ManyToOne(() => Package, (pkg) => pkg.vouchers)
  package: Package;

  @ManyToOne(() => User, (user) => user.redeemedVouchers, { nullable: true })
  redeemedByUser: User;

  @Column({ default: false })
  isRedeemed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  redeemedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
