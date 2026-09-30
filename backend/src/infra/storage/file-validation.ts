import { BadRequestException } from '@nestjs/common';

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export type FileKind = 'image' | 'document';

const SIGNATURES: { mime: string; ext: string; kind: FileKind[]; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', kind: ['document'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    mime: 'image/png',
    ext: 'png',
    kind: ['image', 'document'],
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/jpeg', ext: 'jpg', kind: ['image', 'document'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    ext: 'webp',
    kind: ['image', 'document'],
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const MAX_BYTES: Record<FileKind, number> = {
  image: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
};

/**
 * Valida o arquivo pelo conteúdo (assinatura binária), não pela extensão ou
 * Content-Type informados pelo cliente — que podem ser forjados.
 */
export function validateUpload(file: UploadedFileLike | undefined, kind: FileKind): { mime: string; ext: string } {
  if (!file?.buffer?.length) throw new BadRequestException('Arquivo obrigatório.');
  if (file.size > MAX_BYTES[kind]) {
    throw new BadRequestException(`Arquivo excede o limite de ${MAX_BYTES[kind] / 1024 / 1024} MB.`);
  }
  const match = SIGNATURES.find((signature) => signature.kind.includes(kind) && signature.test(file.buffer));
  if (!match) {
    throw new BadRequestException(
      kind === 'image' ? 'Formato inválido. Envie PNG, JPEG ou WEBP.' : 'Formato inválido. Envie PDF, PNG, JPEG ou WEBP.',
    );
  }
  return { mime: match.mime, ext: match.ext };
}

export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim();
  return (cleaned || 'arquivo').slice(0, 120);
}
