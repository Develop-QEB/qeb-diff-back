import { query } from './mysql.js';
import { DbName } from '../config.js';

export interface CampanaColgada {
  campania_id: number;
  nombre: string | null;
  status: string | null;
  fecha_aprobacion: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  reservadas_colgadas: number;
  propuesta_id: number | null;
}

export interface CarasColgadasReport {
  db: DbName;
  campanas: CampanaColgada[];
  total_campanas: number;
  total_caras: number;
  consultedAt: string;
}

// Campanas ya vendidas (fecha_aprobacion NOT NULL + status activo) que tienen
// reservas en 'Reservado' colgadas — el patron del caso Oral B 30-oct-2026:
// caras agregadas al modal de propuesta post-pase-a-ventas nacen tentativas y
// nadie las promueve a Vendido, quedando invisibles para los candados anti-choque.
// Meta: 0.
export async function fetchCarasColgadas(db: DbName): Promise<CarasColgadasReport> {
  const rows = await query<any>(
    db,
    `
      SELECT
        c.id AS campania_id,
        c.nombre,
        c.status,
        c.fecha_aprobacion,
        c.fecha_inicio,
        c.fecha_fin,
        c.cotizacion_id,
        cot.id_propuesta AS propuesta_id,
        COUNT(r.id) AS reservadas_colgadas
      FROM reservas r
      JOIN solicitudCaras sc ON r.solicitudCaras_id = sc.id
      JOIN cotizacion cot ON CAST(sc.idquote AS UNSIGNED) = cot.id_propuesta
      JOIN campania c ON c.cotizacion_id = cot.id
      WHERE r.estatus = 'Reservado'
        AND r.deleted_at IS NULL
        AND c.fecha_aprobacion IS NOT NULL
        AND c.status NOT IN ('Cancelada', 'Rechazada', 'cancelada', 'rechazada')
      GROUP BY c.id, c.nombre, c.status, c.fecha_aprobacion, c.fecha_inicio, c.fecha_fin, c.cotizacion_id, cot.id_propuesta
      HAVING reservadas_colgadas > 0
      ORDER BY reservadas_colgadas DESC
      LIMIT 200
    `,
    []
  );

  const campanas: CampanaColgada[] = rows.map((r: any) => ({
    campania_id: Number(r.campania_id),
    nombre: r.nombre ?? null,
    status: r.status ?? null,
    fecha_aprobacion: r.fecha_aprobacion ? new Date(r.fecha_aprobacion).toISOString() : null,
    fecha_inicio: r.fecha_inicio ? new Date(r.fecha_inicio).toISOString() : null,
    fecha_fin: r.fecha_fin ? new Date(r.fecha_fin).toISOString() : null,
    reservadas_colgadas: Number(r.reservadas_colgadas),
    propuesta_id: r.propuesta_id == null ? null : Number(r.propuesta_id),
  }));

  return {
    db,
    campanas,
    total_campanas: campanas.length,
    total_caras: campanas.reduce((sum, c) => sum + c.reservadas_colgadas, 0),
    consultedAt: new Date().toISOString(),
  };
}
