# AEGIS v6.9 — Client Build + Static Serve
# Multi-stage: build with Vite, serve with nginx

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps && npm cache clean --force
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npx vite build

FROM nginx:alpine

# Create non-root user for nginx (CIS Docker Benchmark)
RUN addgroup -S app && adduser -S app -G app && \
    chown -R app:app /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && chown app:app /var/run/nginx.pid

COPY --from=build --chown=app:app /app/dist /usr/share/nginx/html
COPY --chown=app:app nginx.conf /etc/nginx/conf.d/default.conf

USER app
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
