import ExcelJS from 'exceljs';
import { parseBatchFile, parseCsv, templateCsv, templateXlsx, toBatchRows, zipUncompressedSize } from './batch-file';

describe('Arquivos de lote', () => {
  it('lê CSV com ";" ou ",", aspas, quebras de linha e BOM', () => {
    expect(parseCsv('﻿a;b;c\r\n1;"x;y";"com ""aspas"""\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', 'com "aspas"'],
    ]);
    expect(parseCsv('a,b\n"linha\nquebrada",2\n\n')).toEqual([
      ['a', 'b'],
      ['linha\nquebrada', '2'],
    ]);
  });

  it('reconhece cabeçalhos em português (com ou sem acento) e exige as colunas obrigatórias', () => {
    const parsed = toBatchRows(
      [
        ['Destinatário', 'Rua', 'Número', 'Cidade', 'UF', 'Peso (kg)', 'Coluna estranha'],
        ['Ana', 'Rua A', '10', 'São Paulo', 'SP', '1,5', 'x'],
      ],
      10,
    );
    expect(parsed.rows).toEqual([{ row: 2, data: { recipientName: 'Ana', street: 'Rua A', number: '10', city: 'São Paulo', state: 'SP', weightKg: '1,5' } }]);
    expect(parsed.ignoredHeaders).toEqual(['Coluna estranha']);
    expect(() => toBatchRows([['destinatario', 'rua'], ['a', 'b']], 10)).toThrow(/obrigatórias ausentes: numero, cidade, uf/);
    expect(() => toBatchRows([['destinatario', 'rua', 'numero', 'cidade', 'uf'], ...Array.from({ length: 3 }, () => ['a', 'b', '1', 'c', 'SP'])], 2)).toThrow(/Máximo de 2/);
  });

  it('modelo CSV e Excel voltam a ser lidos sem erros', async () => {
    const csv = await parseBatchFile({ buffer: Buffer.from(templateCsv(), 'utf8'), originalname: 'modelo.csv', size: 1000 }, 10);
    expect(csv.source).toBe('CSV');
    expect(csv.rows[0].data).toMatchObject({ recipientName: 'Maria Souza', state: 'SP', weightKg: '0,5', costCenter: 'MKT' });
    const xlsxBuffer = await templateXlsx();
    expect(zipUncompressedSize(xlsxBuffer)).toBeGreaterThan(0);
    const xlsx = await parseBatchFile({ buffer: xlsxBuffer, originalname: 'modelo.xlsx', size: xlsxBuffer.length }, 10);
    expect(xlsx.source).toBe('XLSX');
    expect(xlsx.rows[0].data).toMatchObject({ recipientName: 'Maria Souza', city: 'São Paulo' });
  });

  it('lê valores numéricos e de texto de planilhas Excel', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Entregas');
    sheet.addRow(['destinatario', 'rua', 'numero', 'cidade', 'uf', 'latitude', 'longitude']);
    sheet.addRow(['João', 'Av. Brasil', 1500, 'Rio de Janeiro', 'RJ', -22.9, -43.2]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseBatchFile({ buffer, originalname: 'lote.xlsx', size: buffer.length }, 10);
    expect(parsed.rows[0].data).toEqual({ recipientName: 'João', street: 'Av. Brasil', number: '1500', city: 'Rio de Janeiro', state: 'RJ', lat: '-22.9', lng: '-43.2' });
  });

  it('recusa arquivos inválidos e grandes demais', async () => {
    await expect(parseBatchFile({ buffer: Buffer.from('PK\u0003\u0004lixo'), originalname: 'x.xlsx', size: 10 }, 10)).rejects.toThrow();
    await expect(parseBatchFile({ buffer: Buffer.alloc(10), originalname: 'x.csv', size: 3 * 1024 * 1024 }, 10)).rejects.toThrow(/2 MB/);
  });
});
