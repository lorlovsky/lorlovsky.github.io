FROM node:24-slim
ENV NODE_ENV=production NOTCHDROP_HOST=0.0.0.0 PORT=8083 \
    NOTCHDROP_MYSQL_HOST=mysql NOTCHDROP_MYSQL_PORT=3306 NOTCHDROP_MYSQL_USER=notchdrop NOTCHDROP_MYSQL_DATABASE=notchdb
# Supply NOTCHDROP_MYSQL_PASSWORD at runtime (docker run -e / secrets); never bake it into the image.
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.cjs index.html styles.css auth.css app.js peer.js music.js auth.js accounts.js config.js ./
COPY database/schema.sql ./database/schema.sql
COPY desktop/dashboard.js desktop/spotify-ui.js ./desktop/
USER node
EXPOSE 8083
CMD ["node", "server.cjs"]
