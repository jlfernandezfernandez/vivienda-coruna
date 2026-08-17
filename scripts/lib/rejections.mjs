// Rechazos revisados de falsos positivos. Cada entrada es [id, motivo].
//
// La reconciliación (scripts/reconcile-entities.mjs) persiste un tombstone
// '__rejected__' en entity_aliases y borra la fila de forma transaccional.
// La computación de candidatos (listCurationCandidates) excluye estos IDs
// para que un falso positivo ya revisado no bloquee la curación semanal:
// sin esta exclusión, un registro de basura pendiente de borrado impide
// lanzar `curate` (curation_incomplete) mientras las revisiones staged
// impiden lanzar `fast`/`deep` (curation_in_progress) — un deadlock.
//
// Este módulo es puro (sin efectos secundarios) para poder importarse tanto
// desde el script de reconciliación como desde la librería de curación.

export const rejectedOpportunities = [
  ['5f56a42bd5813ce9', 'Agregador EstateNearMe; no es fuente primaria ni aporta proyecto verificable'],
  ['d6eb6d2bfc0f1f85', 'Agregador EstateNearMe; Residencial Anceis requiere fuente oficial'],
  ['8fc5d00f7e1f57b6', 'Agregador EstateNearMe; Granxa da Torre requiere fuente oficial'],
  ['45576787635966eb', 'Artículo general de política de vivienda sin oportunidad, convocatoria ni proyecto accionable'],
  ['16f236ba4b44c6b8', 'Portal índice viviendasnuevas.com; listado de promociones, no una oportunidad accionable'],
  ['ff88fd98889e5cee', 'Agregador de subastas subastasdelboe.com; no es fuente primaria ni oportunidad de vivienda'],
  ['e57e6e05321e86fe', 'Página de trámites municipales tramitesayuntamiento.com; formulario administrativo, no oportunidad'],
];

export const rejectedPromotions = [
  ['promo:metrovacesa:abelia-residencial', 'Abelia Residencial está en Alicante'],
  ['promo:galivivienda:residencial-os-casta-os', 'Residencial Os Castaños está en Santiago de Compostela'],
  ['promo:galivivienda:residencial-pinos-altos', 'Residencial Pinos Altos está en Cadalso de los Vidrios (Madrid)'],
  ['promo:galivivienda:atalayas-de-la-dehesa-torres-i-y-ii', 'Atalayas de la Dehesa está en Madrid'],
  ['promo:galivivienda:torre-flor', 'Torre Flor está en Madrid'],
  ['promo:outra-forma-de-vivenda:la-borda', 'La Borda está en Barcelona y era una experiencia citada'],
  ['promo:outra-forma-de-vivenda:cooperativa-de-consumo-responsable-zocami-oca', 'Zocamiñoca es cooperativa de consumo, no promoción de vivienda'],
  ['promo:outra-forma-de-vivenda:cooperativa-de-vivendas-en-cesi-n-de-uso', 'Texto genérico, no nombre de promoción; el proyecto real es As Lavandeiras'],
  ['promo:amma-promocion:canido-fase-2', 'Canido está en Ferrol'],
  ['promo:casado:pr-xima-promoci-n-en-pedre-a', 'Pedreña está en Cantabria; el nombre indica ubicación fuera del área'],
  ['promo:gestlex:panti-obre-residencial', 'Pantiñobre no está en el área metropolitana monitorizada'],
  ['promo:carlos-luxury-realty:la-obra-nueva-en-culleredo-se-ampl-a-con-cuatro-viviendas-de-lujo-modulares-la', 'Titular de prensa convertido erróneamente en promoción; Carlos Luxury Realty es una agencia'],
];
