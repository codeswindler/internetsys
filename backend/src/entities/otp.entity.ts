import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OtpType {
  ADMIN_LOGIN = 'admin_login',
  USER_RECOVERY = 'user_recovery',
}

@Entity('otps')
export class Otp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  phone: string;

  @Column()
  code: string; // 4-digit code

  @Column({
    type: 'enum',
    enum: OtpType,
    default: OtpType.USER_RECOVERY,
  })
  type: OtpType;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ default: false })
  isUsed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
