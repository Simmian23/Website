import { startServer } from './web-app.js';

const requestedPort = Number.parseInt(process.env.PORT || '3000', 10);

startServer(requestedPort).then(({ port }) => {
  console.log(`UpKept server ready on http://localhost:${port}`);
});
