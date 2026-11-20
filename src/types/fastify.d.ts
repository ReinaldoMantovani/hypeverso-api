import 'fastify';
declare module 'fastify' {
  interface FastifyRequest {
    authUser?: { id: string; role: 'USER' | 'MODERATOR' | 'EDITOR' | 'ADMIN'; email: string; mfa?: boolean };
  }
}
