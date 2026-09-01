FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY engine.js server.js telemetry.js app.js index.html styles.css words.txt ./

ENV NODE_ENV=production
ENV PORT=5173
ENV TELEMETRY_DIR=/tmp/word-grid-telemetry
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
