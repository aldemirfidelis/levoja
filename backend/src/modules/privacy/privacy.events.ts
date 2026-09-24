/** Evento emitido antes da anonimização — módulos com dados próprios podem vetar ou complementar. */
export const USER_ANONYMIZING = 'privacy.user.anonymizing';

/** Evento emitido depois da anonimização — módulos removem o conteúdo pessoal que guardam. */
export const USER_ANONYMIZED = 'privacy.user.anonymized';

/** Evento emitido na exportação — módulos acrescentam os dados do titular que guardam. */
export const USER_EXPORTING = 'privacy.user.exporting';

export interface AnonymizationBlockers {
  userId: string;
  reasons: string[];
}

export interface UserAnonymizedEvent {
  userId: string;
}

export interface UserExportCollector {
  userId: string;
  sections: Record<string, unknown>;
}
