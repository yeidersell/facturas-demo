import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

const EXTRACTION_PROMPT = `Analiza esta imagen de factura, recibo o ticket. Extrae los datos contables y devuelve ÚNICAMENTE un objeto JSON válido, sin texto adicional, sin markdown, sin explicaciones. Usa null para campos que no puedas determinar con certeza. Los valores monetarios deben expresarse en la moneda original del documento; si es Colombia usa COP.

{
  "tipo": "factura|recibo|ticket",
  "proveedor": "nombre del emisor",
  "nif_proveedor": "NIT/RUT/NIF o null",
  "numero_factura": "número o null",
  "fecha": "YYYY-MM-DD o null",
  "items": [{"descripcion": "", "cantidad": 0, "precio_unitario": 0, "total": 0}],
  "subtotal": 0,
  "iva_porcentaje": 19,
  "iva_importe": 0,
  "total": 0,
  "moneda": "COP",
  "metodo_pago": "efectivo|tarjeta|transferencia|desconocido",
  "categoria": "alimentacion|transporte|servicios|material|alojamiento|otros",
  "confianza": "alta|media|baja",
  "notas": "observaciones relevantes o cadena vacía"
}`

const FALLBACK = {
  tipo: 'ticket',
  proveedor: null,
  nif_proveedor: null,
  numero_factura: null,
  fecha: null,
  items: [],
  subtotal: 0,
  iva_porcentaje: 0,
  iva_importe: 0,
  total: 0,
  moneda: 'COP',
  metodo_pago: 'desconocido',
  categoria: 'otros',
  confianza: 'baja',
  notas: 'No se pudo extraer información de la imagen',
}

export async function extractInvoiceData(buffer, mimeType = 'image/jpeg') {
  const imagePart = {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType,
    },
  }

  const result = await model.generateContent([imagePart, { text: EXTRACTION_PROMPT }])
  const raw = result.response.text()

  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    console.error('Gemini JSON parse error. Raw response:', raw.slice(0, 300))
    return { ...FALLBACK }
  }
}
