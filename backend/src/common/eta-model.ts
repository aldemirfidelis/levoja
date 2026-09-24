/**
 * Calibração do tempo de entrega aprendida com o histórico (registrada pelo módulo de
 * inteligência). Consulta síncrona sobre um cache em memória: pode ser usada ao montar respostas.
 */
export interface EtaCalibrationValue {
  /** Tempo real de trajeto ÷ tempo estimado pela rota. */
  transitFactor: number;
  /** Mediana (min) entre a atribuição e a coleta. */
  pickupMinutes: number | null;
  /** Mediana (min) entre o início da busca e a atribuição. */
  dispatchMinutes: number | null;
}

export interface EtaModel {
  calibration(input: { tenantId: string; city?: string | null; state?: string | null; vehicleType?: string | null; at?: Date }): EtaCalibrationValue | null;
}
