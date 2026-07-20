# Vivienda Coruña

Monitor abierto de **cooperativas, promociones nuevas y vivienda protegida** en el área metropolitana de A Coruña.

La prioridad es detectar señales tempranas: constitución de cooperativas, búsqueda de socios, licencias y promociones que empiezan a moverse. La vivienda protegida se muestra por separado como seguimiento público.

## Qué cubre

El monitor trabaja con una lista geográfica explícita para evitar confundir la ciudad de A Coruña con toda la provincia:

- A Coruña
- Arteixo
- Culleredo y O Burgo
- Oleiros, Perillo y Santa Cruz
- Cambre
- Sada
- Bergondo
- Carral
- Abegondo

Ferrol, Santiago y el resto de la provincia quedan fuera deliberadamente.

## Qué encontrarás

| Señal | Para qué sirve | Procedencia |
| --- | --- | --- |
| **Cooperativas y promociones tempranas** | Detectar movimientos antes de que una promoción llegue a portales generalistas. | Alertas de prensa local, siempre marcadas como no oficiales. |
| **VPP / VPA, sorteos y adjudicaciones** | Seguir convocatorias y actividad pública de vivienda protegida. | IGVS, DOG y contratación pública gallega. |
| **Suelo y expedientes públicos** | Anticipar promociones o desarrollos que aún no se comercializan. | DOG y contratación pública gallega. |

Una alerta de prensa no garantiza que haya viviendas disponibles, ni que una promoción sea adecuada. Hay que comprobar precio, condiciones, plazos y entidad promotora en la fuente original.

## VPP, VPA y cooperativas

No son equivalentes:

- **VPP** (Vivienda de Promoción Pública): vivienda promovida o calificada por el IGVS y adjudicada mediante un procedimiento reglado.
- **VPA** (Vivienda de Protección Autonómica): vivienda protegida promovida por un agente público o privado. Tiene regímenes y límites de acceso distintos.
- **Cooperativa**: las personas socias promueven colectivamente la vivienda. Puede ser protegida o libre. Si se autopromueve para uso propio, la inscripción en el Registro de Demandantes no siempre es necesaria, aunque pueden aplicarse otros requisitos.

Consulta la información oficial antes de tomar una decisión:

- [Registro Único de Demandantes de Vivienda de Galicia](https://igvs.xunta.gal/es/registro-de-demandantes-de-vivienda-protegida)
- [Vivienda de Promoción Pública (VPP)](https://igvs.xunta.gal/es/vivienda-protegida/vivienda-de-promocion-publica-vpp)
- [Vivienda protegida del IGVS](https://igvs.xunta.gal/es/vivienda-protegida)

## Fuentes

- IGVS: adjudicaciones y sorteos de vivienda protegida.
- Perfiles de contratación del IGVS y de la Consellería de Vivenda.
- Diario Oficial de Galicia (DOG), vivienda y territorio.
- Contratos Públicos de Galicia.
- Google News RSS para alertas locales de cooperativas y promociones. Esta única fuente no oficial se identifica en la interfaz como **“Alerta de mercado · verificar”**.

## Arquitectura

```text
Fuentes públicas / RSS / listado IGVS
                ↓
scripts/fetch-rss.mjs
                ↓
src/data/monitor.json
                ↓
Astro estático
                ↓
GitHub Pages
```

El refresco diario se ejecuta en GitHub Actions. Si cambian los datos, el workflow confirma `monitor.json` y dispara el despliegue.

## Desarrollo

Requisitos: Node.js 22 o superior.

```bash
npm ci
npm test          # reglas geográficas, clasificación y deduplicación
npm run refresh   # consulta fuentes y actualiza src/data/monitor.json
npm run dev       # desarrollo local
npm run build     # build estático en dist/
```

## Principios del proyecto

- **Señal antes que volumen:** una lista corta y verificable es mejor que anuncios duplicados.
- **Geografía precisa:** se filtra por municipios incluidos, no por la provincia.
- **Fuentes diferenciadas:** lo oficial y las alertas de mercado nunca se presentan como lo mismo.
- **Sin backend ni cuentas:** HTML estático, sin cuentas ni JavaScript de cliente para el funcionamiento normal.
- **Contribuciones pequeñas y testeadas:** añade una prueba si cambias municipios, patrones de clasificación o reglas de deduplicación.

## Limitaciones

No existe un registro público único de todas las cooperativas privadas ni de todas las promociones de obra nueva. Por eso este monitor no sustituye la comprobación directa con la cooperativa, promotora o administración responsable.

No ofrece asesoramiento legal, hipotecario ni de elegibilidad para vivienda protegida.

## Licencia

[MIT](LICENSE)
