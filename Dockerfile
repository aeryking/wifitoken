FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY gateway ./gateway
USER node
EXPOSE 19080
CMD ["node", "gateway/server.js"]
