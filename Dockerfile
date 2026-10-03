FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --production

COPY . .

# Default to Discord. Override with PLATFORM=whatsapp
ENV PLATFORM=discord

# Transaction dates and the daily reminder use local time. Override with TZ in .env
ENV TZ=Asia/Jakarta

CMD ["node", "src/start.js"]
