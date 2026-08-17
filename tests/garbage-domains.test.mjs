import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedOpportunityUrl } from '../scripts/lib/monitor.mjs';

test('bloquea portales/agregadores de ruido por dominio, no solo por título', () => {
  const blocked = [
    'https://viviendasnuevas.com/lacoruna/a-coruna-la-coruna',
    'https://www.subastasdelboe.com/subastas-publicas-de-viviendas-cualquier-estado-en-la-coru%C3%B1a-culleredo/',
    'https://tramitesayuntamiento.com/sada/vivienda-y-rehabilitacion',
    'https://www.idealista.com/pisos/a-coruna/',
    'https://www.fotocasa.es/es/comprar/viviendas/a-coruna/1',
  ];
  for (const url of blocked) {
    assert.equal(isTrustedOpportunityUrl(url), false, url);
  }
});

test('acepta fuentes primarias y prensa legítima', () => {
  const allowed = [
    'https://www.laopinioncoruna.es/gran-coruna/2026/06/16/obra-nueva-culleredo-amplia-cuatro-131467358.html',
    'https://www.lavozdegalicia.es/noticia/coruna/2026/08/10/san-jose-construira-48-millones-264-viviendas-publicas-xuxan-coruna/00031786351135300225701.htm',
    'https://inmobiliariamarten.com/property/obra-nueva-en-arteixo/',
    'https://igvs.xunta.gal/es/areas/vivienda/construcciones-vpp/arteixo-14-viviendas-de-promocion-publica',
  ];
  for (const url of allowed) {
    assert.equal(isTrustedOpportunityUrl(url), true, url);
  }
});
