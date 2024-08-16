FROM node:latest

WORKDIR /app

COPY src/express.js /app/express.js
COPY src/public* /app/public
COPY src/package.json /app/package.json
COPY src/package-lock.json /app/package-lock.json

RUN npm install

EXPOSE 3000

CMD ["node", "express.js"]