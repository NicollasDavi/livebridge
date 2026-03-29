import { fetchDistinct } from '../services/lessons.js';

export function registerCatalogRoutes(app) {
  app.get('/api/professores', async (req, res) => {
    res.json(await fetchDistinct('professores'));
  });
  app.get('/api/materias', async (req, res) => {
    res.json(await fetchDistinct('materias'));
  });
  app.get('/api/frentes', async (req, res) => {
    res.json(await fetchDistinct('frentes'));
  });
  app.get('/api/cursos', async (req, res) => {
    res.json(await fetchDistinct('cursos'));
  });
}
