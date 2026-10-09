FROM node:24-slim
ENV NODE_ENV=production NOTCHDROP_HOST=0.0.0.0 PORT=8083 NOTCHDROP_DATABASE=/data/notchdrop.sqlite
WORKDIR /app
COPY server.cjs index.html styles.css auth.css app.js peer.js music.js auth.js accounts.js config.js ./
COPY database/schema.sql ./database/schema.sql
COPY desktop/dashboard.js desktop/spotify-ui.js ./desktop/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8083
CMD ["node", "server.cjs"]
