/**
 * Singleton do Prisma Client para evitar múltiplas instâncias
 */

import { PrismaClient } from '@prisma/client';
import './db-init'; // Inicializa banco em background

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

