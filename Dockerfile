FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --production

COPY . .

# Default to Discord. Override with PLATFORM=whatsapp
ENV PLATFORM=discord

CMD ["node", "src/start.js"]
