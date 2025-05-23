FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# COPY .env ./

EXPOSE 4000

CMD ["npm", "start"]