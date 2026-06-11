#!/usr/bin/env node
/**
 * Script para baixar o CSV do Tesouro Transparente e gerar um JSON leve
 * com apenas os dados do dia mais recente.
 * 
 * Executado pelo GitHub Actions diariamente.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const TESOURO_CSV_URL = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'tesouro-latest.json');

function parseCsvLine(line) {
  return line.split(';').map(c => c.trim());
}

function parseBrazilianNumber(value) {
  if (!value) return 0;
  const clean = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function dateToSortable(dateStr) {
  const [d, m, y] = dateStr.split('/');
  return `${y}-${m}-${d}`;
}

function downloadCsv() {
  return new Promise((resolve, reject) => {
    console.log('Baixando CSV do Tesouro Transparente...');
    
    const req = https.get(TESOURO_CSV_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 120000,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`CSV baixado: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
        resolve(data);
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function processCsv(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV vazio');
  }
  
  // Encontra a data mais recente em todo o CSV
  let maxDate = '';
  const allRows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 8) continue;
    
    const sortable = dateToSortable(cols[2]);
    if (sortable > maxDate) maxDate = sortable;
    
    allRows.push({
      tipoTitulo: cols[0],
      dataVencimento: cols[1],
      dataBase: cols[2],
      taxaCompra: cols[3],
      taxaVenda: cols[4],
      puCompra: parseBrazilianNumber(cols[5]),
      puVenda: parseBrazilianNumber(cols[6]),
      puBase: parseBrazilianNumber(cols[7]),
      sortable: sortable,
    });
  }
  
  if (!maxDate) {
    throw new Error('Não foi possível encontrar data mais recente');
  }
  
  // Filtra apenas a data mais recente
  const latestRows = allRows
    .filter(r => r.sortable === maxDate)
    .map(({ tipoTitulo, dataVencimento, dataBase, taxaCompra, taxaVenda, puCompra, puVenda, puBase }) => ({
      tipoTitulo, dataVencimento, dataBase, taxaCompra, taxaVenda, puCompra, puVenda, puBase
    }));
  
  console.log(`Processado: ${latestRows.length} títulos na data ${maxDate}`);
  
  return {
    lastDate: maxDate,
    rows: latestRows,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  try {
    // Garante que o diretório data existe
    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Baixa e processa
    const csvText = await downloadCsv();
    const result = await processCsv(csvText);
    
    // Salva o JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log(`JSON salvo em: ${OUTPUT_FILE}`);
    console.log(`Tamanho do JSON: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }
}

main();