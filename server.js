/* =========================================================
   우리 가족 보드게임 모음 - 허브 사이트 서버
   ========================================================= */
const path = require('path');
const http = require('http');
const express = require('express');
const attachSnakeServer = require('./snake-server');
const attachMetaWorldServer = require('./metaworld-server');

const app = express();
const PORT = process.env.PORT || 4000;

// 게임 파일을 고치면 바로 반영되도록 html·js·css는 매번 최신본을 확인하게 한다
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/healthz', (req, res) => res.send('ok'));

const server = http.createServer(app);
attachSnakeServer(server);
attachMetaWorldServer(server);

server.listen(PORT, () => {
  console.log(`가족 게임 허브가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
