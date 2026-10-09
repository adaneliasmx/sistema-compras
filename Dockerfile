FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["sh", "-c", "node scripts/init-db.js && node --max-old-space-size=1024 --expose-gc backend/src/server.js"]
