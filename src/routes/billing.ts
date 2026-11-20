import type { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../db.js';
import { authenticate } from '../lib/auth.js';
import { env } from '../config/env.js';
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const billingRoutes: FastifyPluginAsync = async app => {
  app.post(
    '/billing/checkout',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!stripe || !env.STRIPE_PREMIUM_PRICE_ID)
        return reply.code(503).send({ error: 'Stripe ainda não configurado' });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.authUser!.id },
        include: { subscription: true },
      });
      let customerId = user.subscription?.stripeCustomerId;
      if (!customerId) {
        const c = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
        customerId = c.id;
        await prisma.subscription.upsert({
          where: { userId: user.id },
          create: { userId: user.id, stripeCustomerId: customerId },
          update: { stripeCustomerId: customerId },
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
        success_url: `${env.PUBLIC_WEB_URL}/premium?success=1`,
        cancel_url: `${env.PUBLIC_WEB_URL}/premium?canceled=1`,
        metadata: { userId: user.id },
      });
      return { url: session.url };
    },
  );
  app.post('/billing/webhook', { config: { rawBody: true } }, async (req, reply) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: 'Stripe não configurado' });
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) return reply.code(400).send({ error: 'Assinatura ausente' });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.code(400).send({ error: 'Webhook inválido' });
    }
    if (
      ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(
        event.type,
      )
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = String(sub.customer);
      const status =
        sub.status === 'active' || sub.status === 'trialing'
          ? 'ACTIVE'
          : sub.status === 'past_due'
            ? 'PAST_DUE'
            : sub.status === 'canceled'
              ? 'CANCELED'
              : 'FREE';
      await prisma.subscription.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          stripeSubscriptionId: sub.id,
          status: status as any,
          currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
        },
      });
    }
    return { received: true };
  });
};
export default billingRoutes;
