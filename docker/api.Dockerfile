# Imagem usada no SEU PC para os workers de IA (e, no modo dev, para a API).
# Na Hostinger não há Docker: lá a API roda como Node.js Web App (npm run build / dist/server.js).
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate && npx tsup
ENV NODE_ENV=production
EXPOSE 4000 4010 4020
CMD ["node", "dist/server.js"]
