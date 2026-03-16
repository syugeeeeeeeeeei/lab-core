FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

CMD ["node", "dist/index.js"]
