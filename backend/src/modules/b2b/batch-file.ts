import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { BATCH_COLUMNS, matchBatchColumn, type BatchField } from '@levoja/shared';

export type BatchRow = Partial<Record<BatchField, string>>;

export interface ParsedBatchFile {
  rows: { row: number; data: BatchRow }[];
  /** Cabeçalhos ignorados (não reconhecidos). */
  ignoredHeaders: string[];
}

export const MAX_BATCH_FILE_BYTES = 2 * 1024 * 1024;
/** Limite de dados descompactados de uma planilha .xlsx (proteção contra "zip bomb"). */
const MAX_XLSX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

/** Separador mais provável na primeira linha (";" do Excel pt-BR, "," ou tabulação). */
function detectDelimiter(firstLine: string): string {
  const counts = [';', ',', '\t'].map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length - 1 }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : ';';
}

/** Parser CSV (RFC 4180): aspas, aspas duplicadas, quebras de linha dentro de campos, BOM. */
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^﻿/, '');
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

// -----------------------------------------------------------------------------
// Excel (.xlsx)
// -----------------------------------------------------------------------------

/** Soma os tamanhos descompactados declarados no diretório central do ZIP. */
export function zipUncompressedSize(buffer: Buffer): number {
  // Registro "End of central directory" (assinatura 0x06054b50) nos últimos 64 KB.
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= start; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new BadRequestException('Arquivo Excel inválido.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let entry = 0; entry < entries; entry++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new BadRequestException('Arquivo Excel inválido.');
    total += buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return total;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return value.result == null ? '' : String(value.result); // fórmula
    return '';
  }
  return String(value);
}

export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  if (buffer.subarray(0, 4).readUInt32LE(0) !== 0x04034b50) throw new BadRequestException('Envie um arquivo .xlsx (Excel) ou .csv.');
  if (zipUncompressedSize(buffer) > MAX_XLSX_UNCOMPRESSED_BYTES) throw new BadRequestException('Planilha grande demais. Divida em lotes menores.');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('Não foi possível ler a planilha. Salve como .xlsx e tente novamente.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('A planilha está vazia.');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // row.values começa no índice 1.
    rows.push(values.slice(1).map((value) => cellText(value).trim()));
  });
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
}

// -----------------------------------------------------------------------------
// Linhas → campos
// -----------------------------------------------------------------------------

/** Mapeia o cabeçalho (nomes em português, com ou sem acento) para os campos do lote. */
export function toBatchRows(table: string[][], maxRows: number): ParsedBatchFile {
  if (table.length < 2) throw new BadRequestException('A planilha precisa de um cabeçalho e ao menos uma linha.');
  const [header, ...body] = table;
  const mapping = header.map((title) => matchBatchColumn(title));
  const ignoredHeaders = header.filter((_, index) => !mapping[index] && header[index].trim());
  const missing = BATCH_COLUMNS.filter((column) => column.required && !mapping.includes(column.key)).map((column) => column.header);
  if (missing.length) throw new BadRequestException(`Colunas obrigatórias ausentes: ${missing.join(', ')}. Baixe o modelo para conferir.`);
  if (body.length > maxRows) throw new BadRequestException(`Máximo de ${maxRows} entregas por lote (a planilha tem ${body.length}).`);
  const rows = body.map((cells, index) => {
    const data: BatchRow = {};
    mapping.forEach((field, column) => {
      const value = (cells[column] ?? '').trim();
      if (field && value) data[field] = value.slice(0, 500);
    });
    return { row: index + 2, data };
  });
  return { rows, ignoredHeaders };
}

export async function parseBatchFile(file: { buffer: Buffer; originalname: string; size: number }, maxRows: number): Promise<ParsedBatchFile & { source: 'CSV' | 'XLSX' }> {
  if (!file?.buffer?.length) throw new BadRequestException('Arquivo obrigatório.');
  if (file.size > MAX_BATCH_FILE_BYTES) throw new BadRequestException('Arquivo maior que 2 MB. Divida em lotes menores.');
  const isXlsx = file.buffer.subarray(0, 4).length === 4 && file.buffer.readUInt32LE(0) === 0x04034b50;
  if (isXlsx) return { ...toBatchRows(await parseXlsx(file.buffer), maxRows), source: 'XLSX' };
  const text = file.buffer.toString('utf8');
  if (text.includes('\u0000')) throw new BadRequestException('Formato não reconhecido. Envie .csv ou .xlsx.');
  return { ...toBatchRows(parseCsv(text), maxRows), source: 'CSV' };
}

// -----------------------------------------------------------------------------
// Modelos para download
// -----------------------------------------------------------------------------

export function templateCsv(): string {
  const escape = (text: string) => (/[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const header = BATCH_COLUMNS.map((column) => column.header).join(';');
  const example = BATCH_COLUMNS.map((column) => escape(column.example)).join(';');
  return `﻿${header}\r\n${example}\r\n`;
}

export async function templateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LevoJá';
  const sheet = workbook.addWorksheet('Entregas');
  sheet.columns = BATCH_COLUMNS.map((column) => ({ header: column.header, key: column.key, width: Math.max(12, column.header.length + 4, column.example.length + 2) }));
  sheet.addRow(Object.fromEntries(BATCH_COLUMNS.map((column) => [column.key, column.example])));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const help = workbook.addWorksheet('Instruções');
  help.columns = [
    { header: 'Coluna', key: 'header', width: 20 },
    { header: 'Obrigatória', key: 'required', width: 12 },
    { header: 'Descrição', key: 'help', width: 90 },
  ];
  for (const column of BATCH_COLUMNS) help.addRow({ header: column.header, required: column.required ? 'Sim' : 'Não', help: column.help });
  help.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
