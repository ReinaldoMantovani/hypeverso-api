import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const categories = [
  ['Cinema', 'cinema', 'Filmes, bastidores e lançamentos', 'Clapperboard'],
  ['Séries', 'series', 'Séries, streaming e TV', 'Tv'],
  ['Games', 'games', 'Jogos, consoles e eSports', 'Gamepad2'],
  ['Anime', 'anime', 'Animes e cultura otaku', 'Sparkles'],
  ['Mangás', 'mangas', 'Mangás e light novels', 'BookOpen'],
  ['HQs', 'hqs', 'Quadrinhos, Marvel, DC e independentes', 'PanelsTopLeft'],
  ['Tecnologia', 'tecnologia', 'Tecnologia, IA e inovação', 'Cpu'],
  ['Cultura Pop', 'cultura-pop', 'Universo geek e cultura pop', 'Orbit'],
];
const achievements = [
  ['FIRST_COMMENT', 'Primeira Voz', 'Publique seu primeiro comentário', 'MessageCircle', 25],
  ['FIRST_POST', 'Sinal Aberto', 'Publique no feed da comunidade', 'Radio', 40],
  ['COLLECTOR', 'Colecionador', 'Salve 10 conteúdos nos favoritos', 'Bookmark', 75],
];
async function main() {
  for (const [name, slug, description, icon] of categories)
    await prisma.category.upsert({
      where: { slug },
      update: { name, description, icon },
      create: { name, slug, description, icon },
    });
  for (const [code, name, description, icon, xpReward] of achievements)
    await prisma.achievement.upsert({
      where: { code: String(code) },
      update: { name: String(name), description: String(description), icon: String(icon), xpReward: Number(xpReward) },
      create: {
        code: String(code),
        name: String(name),
        description: String(description),
        icon: String(icon),
        xpReward: Number(xpReward),
      },
    });
}
main().finally(() => prisma.$disconnect());
