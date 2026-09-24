import { Prisma } from '../generated/prisma/client';

/** Instante UTC como "timestamp sem fuso" (como o Prisma grava), independente do fuso da sessão. */
export const utcTimestamp = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Coluna de data/hora (gravada em UTC) convertida para o horário local do fuso. */
export const localTime = (column: Prisma.Sql, timeZone: string) => Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})`;
