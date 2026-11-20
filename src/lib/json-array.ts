/**
 * MySQL não tem colunas de lista (String[] do Postgres): essas listas ficam em
 * colunas JSON. Este helper lê o JSON com segurança e sempre devolve string[].
 */
export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      return stringList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}
