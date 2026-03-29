import { createApp, logStartupHints } from './app.js';

const PORT = process.env.PORT || 3000;
const app = createApp();
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
  logStartupHints();
});
