/* =========================================================
   우리 가족 보드게임 모음 - 허브 사이트 서버
   ========================================================= */
const path = require('path');
const http = require('http');
const express = require('express');
const attachSnakeServer = require('./snake-server');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));

const server = http.createServer(app);
attachSnakeServer(server);

server.listen(PORT, () => {
  console.log(`가족 게임 허브가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
