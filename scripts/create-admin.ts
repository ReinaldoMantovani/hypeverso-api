try {
  process.loadEnvFile?.('.env');
} catch {}
import { hashPassword } from '../src/lib/password.js';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const name = process.env.ADMIN_NAME;
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !username || !email || !password || password.length < 12) {
    console.error('Defina ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL e ADMIN_PASSWORD (12+ caracteres).');
    process.exitCode = 1;
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    await prisma.user.upsert({
      where: { email },
      update: {
        name,
        username,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
      create: {
        name,
        username,
        email,
        passwordHash,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        subscription: { create: {} },
      },
    });
    console.log(`Administrador ${email} criado/atualizado.`);
  } catch (error) {
    console.error('Falha ao criar/atualizar administrador.', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
