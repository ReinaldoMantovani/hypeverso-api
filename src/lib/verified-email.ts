import { prisma } from '../db.js';
import { emailVerificationRequired } from '../config/env.js';

/** Bloqueia ações públicas (comentar, publicar, avaliar) de contas sem e-mail confirmado. */
export async function assertVerifiedEmail(userId: string) {
  if (!emailVerificationRequired) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, role: true } });
  if (user?.emailVerifiedAt || (user && user.role !== 'USER')) return;
  const error = new Error('Confirme seu e-mail para participar. Reenvie o link em Conta › Privacidade.') as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 403;
  error.code = 'EMAIL_NOT_VERIFIED';
  throw error;
}
