FROM node:24-alpine
WORKDIR /home/container
COPY package*.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
