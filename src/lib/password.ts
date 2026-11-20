// Hash de senhas com Argon2id em WebAssembly (hash-wasm).
// Não usamos o pacote nativo "argon2": o binário dele exige GLIBC 2.34 e o
// servidor da Hostinger (hospedagem compartilhada) tem uma glibc mais antiga,
// o que derrubava a API na inicialização (503).
// O formato gerado é o mesmo do pacote nativo ($argon2id$v=19$m=...,t=...,p=...$salt$hash),
// então hashes antigos continuam válidos.
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

export type HashOptions = { memoryCost?: number; timeCost?: number; parallelism?: number };

export function hashPassword(password: string, opts: HashOptions = {}) {
  return argon2id({
    password,
    salt: randomBytes(16),
    memorySize: opts.memoryCost ?? 19456,
    iterations: opts.timeCost ?? 2,
    parallelism: opts.parallelism ?? 1,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
