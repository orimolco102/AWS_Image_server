FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV = development
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . /app
RUN chown -R node:node /app
USER node
CMD [ "npm", "run", "dev" ]


FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV = production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean -force
COPY . ./
EXPOSE 3000
RUN chown -R node:node /app
USER node
CMD [ "node", "app.js" ]