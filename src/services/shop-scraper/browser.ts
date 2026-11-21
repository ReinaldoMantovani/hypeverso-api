// Versão do worker da Shop (Docker, sem navegador instalado): a leitura com
// Edge/Chrome só existe no CMS. Aqui o preview usa leitura direta + "prévia de link".
export type RenderedPage = { finalUrl: string; html: string; hops: string[]; imageUrls: string[]; jsonBodies: string[] };
export function browserDisabled() {
  return true;
}
export function browserLastError() {
  return 'Navegador indisponível no worker';
}
export async function renderPage(_url: string): Promise<RenderedPage> {
  throw new Error('Navegador indisponível no worker da Shop');
}
