import { prisma } from '../db.js';

// Triagem comunitária: usuários experientes votam em denúncias. Votos somados
// (com peso pela reputação) podem ocultar um comentário de forma provisória;
// a decisão final é sempre da equipe, que recalibra a reputação de quem votou.
export const COMMUNITY_MOD = {
  minLevel: 5,
  minAccountDays: 14,
  minReputation: -10,
  hideThreshold: 4,
  rewardCorrect: 2,
  penaltyWrong: 3,
};

export function voteWeight(reputation: number) {
  return Math.min(3, Math.max(1, 1 + Math.floor(reputation / 20)));
}

export async function moderationEligibility(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      level: true,
      createdAt: true,
      emailVerifiedAt: true,
      moderationReputation: true,
    },
  });
  if (!user) return { eligible: false, reasons: ['Usuário não encontrado'], reputation: 0, weight: 0 };
  if (user.role !== 'USER')
    return { eligible: true, staff: true, reasons: [], reputation: user.moderationReputation, weight: 3 };
  const reasons: string[] = [];
  if (user.status !== 'ACTIVE') reasons.push('Conta inativa');
  if (user.level < COMMUNITY_MOD.minLevel) reasons.push(`Alcance o nível ${COMMUNITY_MOD.minLevel}`);
  if (!user.emailVerifiedAt) reasons.push('Confirme seu e-mail');
  const days = (Date.now() - user.createdAt.getTime()) / 86400000;
  if (days < COMMUNITY_MOD.minAccountDays) reasons.push(`Conta com pelo menos ${COMMUNITY_MOD.minAccountDays} dias`);
  if (user.moderationReputation < COMMUNITY_MOD.minReputation) reasons.push('Reputação de moderação muito baixa');
  return {
    eligible: reasons.length === 0,
    staff: false,
    reasons,
    reputation: user.moderationReputation,
    weight: voteWeight(user.moderationReputation),
  };
}

/** Reavalia a denúncia depois de cada voto. */
export async function evaluateReport(reportId: string) {
  const votes = await prisma.reportVote.findMany({ where: { reportId }, select: { verdict: true, weight: true } });
  const violates = votes.filter(v => v.verdict === 'VIOLATES').reduce((s, v) => s + v.weight, 0);
  const ok = votes.filter(v => v.verdict === 'OK').reduce((s, v) => s + v.weight, 0);
  const report = await prisma.commentReport.findUnique({
    where: { id: reportId },
    select: { commentId: true, status: true },
  });
  if (!report || report.status !== 'OPEN') return { violates, ok, action: 'none' as const };
  if (violates >= COMMUNITY_MOD.hideThreshold && violates > ok) {
    await prisma.$transaction([
      prisma.comment.update({
        where: { id: report.commentId },
        data: { hiddenAt: new Date(), hiddenReason: 'community-triage' },
      }),
      prisma.commentReport.update({ where: { id: reportId }, data: { status: 'REVIEWED' } }),
    ]);
    return { violates, ok, action: 'hidden' as const };
  }
  if (ok >= COMMUNITY_MOD.hideThreshold && ok > violates) {
    // A comunidade entende que não há violação: sai da fila e aguarda confirmação da equipe.
    await prisma.commentReport.update({ where: { id: reportId }, data: { status: 'REVIEWED' } });
    return { violates, ok, action: 'kept' as const };
  }
  return { violates, ok, action: 'pending' as const };
}

/** Decisão final da equipe (RESOLVED = violação confirmada; DISMISSED = sem violação). */
export async function applyStaffDecision(
  reportId: string,
  status: 'REVIEWED' | 'RESOLVED' | 'DISMISSED',
  staffId: string,
) {
  if (status === 'REVIEWED') return;
  const report = await prisma.commentReport.findUnique({
    where: { id: reportId },
    select: { commentId: true, votes: { select: { userId: true, verdict: true } } },
  });
  if (!report) return;
  const violation = status === 'RESOLVED';
  await prisma.comment.update({
    where: { id: report.commentId },
    data: violation
      ? { hiddenAt: new Date(), hiddenReason: `staff:${staffId}` }
      : { hiddenAt: null, hiddenReason: null },
  });
  const correct = report.votes.filter(v => (v.verdict === 'VIOLATES') === violation).map(v => v.userId);
  const wrong = report.votes.filter(v => (v.verdict === 'VIOLATES') !== violation).map(v => v.userId);
  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: { in: correct } },
      data: { moderationReputation: { increment: COMMUNITY_MOD.rewardCorrect } },
    }),
    prisma.user.updateMany({
      where: { id: { in: wrong } },
      data: { moderationReputation: { decrement: COMMUNITY_MOD.penaltyWrong } },
    }),
  ]);
}
