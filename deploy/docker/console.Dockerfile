# Console KayrosLab (P9) : build Vite puis nginx (/console/ + proxy /v1 → fastify).
FROM node:20-slim AS build
WORKDIR /src
COPY frontend/console-app/package.json frontend/console-app/package-lock.json frontend/console-app/
RUN cd frontend/console-app && npm ci
COPY frontend/console-app/ frontend/console-app/
COPY personas/catalog/ personas/catalog/
RUN cd frontend/console-app && npx vite build --outDir /out --emptyOutDir

FROM nginx:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html/console
EXPOSE 80
