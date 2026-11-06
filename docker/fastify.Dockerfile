# API Fastify KayrosLab (P9). Contexte de build : racine du dépôt.
FROM node:20-slim
WORKDIR /app
COPY backend/fastify/package.json backend/fastify/package-lock.json backend/fastify/
RUN cd backend/fastify && npm ci --omit=dev
COPY core/ core/
COPY backend/adapters/ backend/adapters/
COPY backend/fastify/ backend/fastify/
COPY personas/ personas/
ENV NODE_ENV=production PORT=8787 KAYROS_HARNESS_MODE=enforce KAYROS_PERSONAS_DIR=/app/personas
USER node
EXPOSE 8787
CMD ["node", "backend/fastify/index.mjs"]
