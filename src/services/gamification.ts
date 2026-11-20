import { prisma } from '../db.js';
import { XP_RULES } from '../shared/config.js';
export async function addXp(userId: string, amount: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true, level: true } });
  if (!user) return;
  const xp = user.xp + amount;
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
  await prisma.user.update({ where: { id: userId }, data: { xp, level } });
}
export async function unlock(userId: string, code: string) {
  const a = await prisma.achievement.findUnique({ where: { code } });
  if (!a) return false;
  const exists = await prisma.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId: a.id } },
  });
  if (exists) return false;
  await prisma.$transaction([
    prisma.userAchievement.create({ data: { userId, achievementId: a.id } }),
    prisma.user.update({ where: { id: userId }, data: { xp: { increment: a.xpReward } } }),
    prisma.notification.create({
      data: {
        recipientId: userId,
        type: 'ACHIEVEMENT',
        title: `Conquista desbloqueada: ${a.name}`,
        body: a.description,
        entityType: 'achievement',
        entityId: a.id,
      },
    }),
  ]);
  return true;
}
export { XP_RULES };
