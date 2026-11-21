// Corrige erros comuns ao colar a DATABASE_URL no painel da Hostinger:
// aspas em volta, espaços, "DATABASE_URL=" repetido dentro do valor e mariadb://.
export function normalizeDatabaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  for (let i = 0; i < 3; i++) {
    v = v.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim();
  }
  v = v.replace(/^(mysql|mariadb):\/\//i, 'mysql://');
  return v;
}

// Mostra o começo da URL sem a senha, para diagnosticar sem vazar segredo.
export function describeDatabaseUrl(v: string): string {
  const masked = v.replace(/(:\/\/[^:/@]*:)[^@]*@/, '$1****@');
  return `começa com "${masked.slice(0, 40)}" (${v.length} caracteres)`;
}

export function applyDatabaseUrlFix() {
  const fixed = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (fixed === undefined) return;
  process.env.DATABASE_URL = fixed;
  if (!fixed.startsWith('mysql://')) {
     
    console.error(
      `[config] DATABASE_URL inválida: precisa começar com mysql://. Valor recebido ${describeDatabaseUrl(fixed)}.`,
    );
  }
}
