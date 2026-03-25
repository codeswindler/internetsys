import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionMethod, TransactionStatus } from '../entities/transaction.entity';
import { User } from '../entities/user.entity';
import { Package } from '../entities/package.entity';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
  ) {}

  async log(data: {
    user: User;
    package: Package;
    amount: number;
    method: TransactionMethod;
    reference?: string;
    status?: TransactionStatus;
    notes?: string;
  }): Promise<Transaction> {
    const tx = this.transactionRepo.create({
      user: data.user,
      package: data.package,
      amount: data.amount,
      method: data.method,
      reference: data.reference,
      status: data.status || TransactionStatus.COMPLETED,
      notes: data.notes,
    });
    
    return this.transactionRepo.save(tx);
  }

  async findAll(): Promise<Transaction[]> {
    return this.transactionRepo.find({
      relations: ['user', 'package'],
      order: { createdAt: 'DESC' },
    });
  }
}
