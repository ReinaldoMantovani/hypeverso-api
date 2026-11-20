import os from 'node:os';
import path from 'node:path';

// Raiz do projeto (onde fica o package.json). Na Hostinger é a pasta do Web App.
export const API_DIR = process.cwd();
// Uploads antigos em disco (compatibilidade). Os novos ficam no MySQL (tabela MediaAsset),
// porque a Hostinger reconstrói a pasta da aplicação a cada deploy.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(API_DIR, 'uploads');
// Arquivos temporários de processamento (reencode/moderação) antes de irem para o banco.
export const TMP_DIR = path.join(os.tmpdir(), 'hypeverso-uploads');
