import { query } from './mysql.js';
import { DbName } from '../config.js';

export type Lado = 'dg' | 'dcm';

export interface HuerfanaRow {
  cara_id: number;
  idquote: string | null;
  articulo: string | null;
  formato: string | null;
  ciudad: string | null;
  caras: number | null;
  tarifa_publica: number | null;
  costo: number | null;
  bonificacion: number | null;
  autorizacion_dg: string | null;
  autorizacion_dcm: string | null;
  created_at: string | null;
  solicitud_id: number | null;
  propuesta_id: number | null;
  lado: Lado;
}

export interface HuerfanasReport {
  db: DbName;
  dg: HuerfanaRow[];
  dcm: HuerfanaRow[];
  total: number;
  consultedAt: string;
}

function mapRow(r: any, lado: Lado): HuerfanaRow {
  return {
    cara_id: Number(r.cara_id ?? r.id),
    idquote: r.idquote ?? null,
    articulo: r.articulo ?? null,
    formato: r.formato ?? null,
    ciudad: r.ciudad ?? null,
    caras: r.caras == null ? null : Number(r.caras),
    tarifa_publica: r.tarifa_publica == null ? null : Number(r.tarifa_publica),
    costo: r.costo == null ? null : Number(r.costo),
    bonificacion: r.bonificacion == null ? null : Number(r.bonificacion),
    autorizacion_dg: r.autorizacion_dg ?? null,
    autorizacion_dcm: r.autorizacion_dcm ?? null,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    solicitud_id: r.solicitud_id == null ? null : Number(r.solicitud_id),
    propuesta_id: r.propuesta_id == null ? null : Number(r.propuesta_id),
    lado,
  };
}

// Caras con autorizacion_<lado>='pendiente' que NO tienen ninguna tarea
// (Autorización <X> ni Filtro Autorización <X>) para la solicitud/propuesta
// a la que pertenecen. Son "huerfanas": alguien espera una decisión que
// nadie puede tomar porque la tarea no existe.
async function fetchLado(db: DbName, lado: Lado): Promise<HuerfanaRow[]> {
  const col = lado === 'dg' ? 'autorizacion_dg' : 'autorizacion_dcm';
  const tipoFinal = lado === 'dg' ? 'Autorización DG' : 'Autorización DCM';
  const tipoFiltro = lado === 'dg' ? 'Filtro Autorización DG' : 'Filtro Autorización DCM';

  const rows = await query<any>(
    db,
    `
      SELECT
        sc.id AS cara_id,
        sc.idquote,
        sc.articulo,
        sc.formato,
        sc.ciudad,
        sc.caras,
        sc.tarifa_publica,
        sc.costo,
        sc.bonificacion,
        sc.autorizacion_dg,
        sc.autorizacion_dcm,
        sc.created_at,
        pr.solicitud_id,
        pr.id AS propuesta_id
      FROM solicitudCaras sc
      LEFT JOIN propuesta pr ON pr.id = CAST(sc.idquote AS UNSIGNED)
      WHERE sc.${col} = 'pendiente'
        AND NOT EXISTS (
          SELECT 1
          FROM tareas t
          WHERE t.tipo IN (?, ?)
            AND (
              (pr.solicitud_id IS NOT NULL AND t.id_solicitud = CAST(pr.solicitud_id AS CHAR))
              OR
              (pr.id IS NOT NULL AND t.id_propuesta = CAST(pr.id AS CHAR))
            )
        )
      ORDER BY sc.created_at DESC
      LIMIT 500
    `,
    [tipoFinal, tipoFiltro]
  );

  return rows.map((r) => mapRow(r, lado));
}

export async function fetchHuerfanas(db: DbName): Promise<HuerfanasReport> {
  const [dg, dcm] = await Promise.all([fetchLado(db, 'dg'), fetchLado(db, 'dcm')]);
  return {
    db,
    dg,
    dcm,
    total: dg.length + dcm.length,
    consultedAt: new Date().toISOString(),
  };
}
