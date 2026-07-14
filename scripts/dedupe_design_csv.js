const fs = require('fs')
const path = require('path')

const INPUT_FILE =
    process.argv[2] ||
    path.join(__dirname, '..', 'design_reexpire_2026-07-14T03-33-17.csv')

// Parse 1 dòng CSV theo cùng quy tắc escapeCsvField ở index.js (delimiter ",", quote bằng "")
function parseCsvLine(line) {
    const fields = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"'
                    i++
                } else {
                    inQuotes = false
                }
            } else {
                cur += ch
            }
        } else {
            if (ch === '"') {
                inQuotes = true
            } else if (ch === ',') {
                fields.push(cur)
                cur = ''
            } else {
                cur += ch
            }
        }
    }
    fields.push(cur)
    return fields
}

function escapeCsvField(value) {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes('"') || str.includes(',')) {
        return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
}

// Lấy phần nội dung file (bỏ query string sau dấu ?) để so sánh trùng lặp
function stripQuery(url) {
    if (!url) return ''
    const idx = url.indexOf('?')
    return idx < 0 ? url : url.slice(0, idx)
}

const raw = fs.readFileSync(INPUT_FILE, 'utf8')
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
const headers = parseCsvLine(lines[0])
const designCols = headers.slice(2) // design_front, design_back, design_sleeves, design_hood

const seen = new Set()
const outLines = [lines[0]]
let totalRows = 0
let keptRows = 0
let dupRows = 0

for (let i = 1; i < lines.length; i++) {
    totalRows++
    const fields = parseCsvLine(lines[i])
    const designValues = fields.slice(2, 2 + designCols.length)
    const signature = designValues.map(stripQuery).join('|')

    // Bỏ qua các dòng không có design nào (signature rỗng) khỏi việc dedupe
    if (signature.replace(/\|/g, '') === '') {
        outLines.push(lines[i])
        keptRows++
        continue
    }

    if (seen.has(signature)) {
        dupRows++
        continue
    }
    seen.add(signature)
    outLines.push(lines[i])
    keptRows++
}

const outputPath = INPUT_FILE.replace(/\.csv$/, '_deduped.csv')
fs.writeFileSync(outputPath, outLines.join('\n') + '\n', 'utf8')

console.log(`[INFO] Input: ${INPUT_FILE}`)
console.log(`[INFO] Tổng dòng dữ liệu: ${totalRows}`)
console.log(`[INFO] Giữ lại: ${keptRows}`)
console.log(`[INFO] Trùng lặp bỏ qua: ${dupRows}`)
console.log(`[DONE] Ghi file: ${outputPath}`)
