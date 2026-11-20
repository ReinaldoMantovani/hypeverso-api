// Gera o SQL para criar o administrador SEM conectar no banco.
// Uso (PowerShell):
//   $env:ADMIN_NAME="Reinaldo"; $env:ADMIN_USERNAME="reinaldo"; $env:ADMIN_EMAIL="voce@email.com"; $env:ADMIN_PASSWORD="senha-forte-com-12+"
//   npm run admin:sql
// Copie o resultado e execute na aba SQL do phpMyAdmin.
import { hashPassword } from '../src/lib/password.js';
import { randomBytes } from 'node:crypto';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");

async function main() {
  const name = process.env.ADMIN_NAME;
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !username || !email || !password || password.length < 12) {
    console.error('Defina ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL e ADMIN_PASSWORD (12+ caracteres).');
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(password);
  const userId = 'admin_' + randomBytes(10).toString('hex');
  const subId = 'sub_' + randomBytes(10).toString('hex');
  console.log(`-- Administrador ${email}
INSERT INTO \`User\` (\`id\`, \`name\`, \`username\`, \`email\`, \`passwordHash\`, \`role\`, \`status\`, \`emailVerifiedAt\`, \`updatedAt\`)
VALUES ('${userId}', '${esc(name)}', '${esc(username)}', '${esc(email)}', '${esc(hash)}', 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE \`role\` = 'ADMIN', \`status\` = 'ACTIVE', \`passwordHash\` = VALUES(\`passwordHash\`), \`emailVerifiedAt\` = CURRENT_TIMESTAMP(3), \`updatedAt\` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO \`Subscription\` (\`id\`, \`userId\`, \`updatedAt\`)
SELECT '${subId}', \`id\`, CURRENT_TIMESTAMP(3) FROM \`User\` WHERE \`email\` = '${esc(email)}';`);
}
void main();
