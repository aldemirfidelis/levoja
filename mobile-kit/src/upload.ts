import { request } from './api';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
};

export interface LocalFile {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}

/** Arquivo local (câmera, galeria ou seletor de documentos) no formato de upload do React Native. */
export function toFormFile(file: LocalFile): Blob {
  const cleanUri = file.uri.split('?')[0];
  const fallbackName = cleanUri.substring(cleanUri.lastIndexOf('/') + 1) || 'arquivo';
  const name = file.name || fallbackName;
  const extension = name.includes('.') ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const type = file.mimeType || MIME[extension] || 'application/octet-stream';
  return { uri: file.uri, name, type } as unknown as Blob;
}

/** Envia um arquivo (multipart) com campos extras, usando a sessão e a renovação de token da API. */
export function upload<T>(path: string, field: string, file: LocalFile, fields: Record<string, string | undefined> = {}, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value);
  form.append(field, toFormFile(file));
  return request<T>(method, path, { body: form, timeoutMs: 120_000 });
}
