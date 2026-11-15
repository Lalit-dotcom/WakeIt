FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs app.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.mjs"]
