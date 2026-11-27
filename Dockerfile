FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/firebase-applet-config*.json ./
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
