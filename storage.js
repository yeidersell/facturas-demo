import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'expenses.json')

let expenses = []

export function initStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8')
  } else {
    try {
      expenses = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    } catch {
      expenses = []
      fs.writeFileSync(DATA_FILE, '[]', 'utf8')
    }
  }
}

export function addExpense(record) {
  expenses.push(record)
  fs.writeFileSync(DATA_FILE, JSON.stringify(expenses, null, 2), 'utf8')
  return record
}

export function getExpenses() {
  return [...expenses]
}

export function createRecord({ from, buffer, mimeType, extractedData }) {
  return {
    id: crypto.randomUUID(),
    from,
    timestamp: new Date().toISOString(),
    imagePreview: `data:${mimeType};base64,${buffer.toString('base64')}`,
    extractedData,
  }
}
