FROM node:24-alpine
RUN apk add --no-cache git
WORKDIR /home/container
RUN chown node:node /home/container
COPY package*.json ./
RUN npm install --omit=dev --package-lock=false
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "scripts/start.js"]
