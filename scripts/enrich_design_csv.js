const fs = require('fs')
const path = require('path')
const _ = require('lodash')

const { getModel } = require('../connections/database')

const FulfillmentItem = getModel('FulfillmentItem')

const INPUT_FILE =
    process.argv[2] ||
    path.join(
        __dirname,
        '..',
        'design_reexpire_2026-07-14T03-33-17_deduped.csv',
    )

const SUPPLIER_1C = '5cf099aa3b7f1e3d46b7ae73'
const CHUNK_SIZE = 200

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

;(async () => {
    try {
        const raw = fs.readFileSync(INPUT_FILE, 'utf8')
        const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
        const headers = parseCsvLine(lines[0])
        const rows = lines.slice(1).map((line) => {
            const fields = parseCsvLine(line)
            const row = {}
            headers.forEach((h, i) => (row[h] = fields[i]))
            return row
        })

        const infoById = {}
        const idChunks = _.chunk(
            rows.map((r) => r.item_id),
            CHUNK_SIZE,
        )
        let processed = 0
        for (const idChunk of idChunks) {
            const items = await FulfillmentItem.find({ _id: { $in: idChunk } })
                .select('supplier variant_data.product_type namespace')
                .lean()
            for (const item of items) {
                infoById[item._id.toString()] = {
                    supplier_name:
                        _.get(item, 'supplier', '').toString() ===
                        SUPPLIER_1C
                            ? '1C'
                            : 'MCVN',
                    product_type: _.get(item, 'variant_data.product_type', ''),
                    namespace: _.get(item, 'namespace', ''),
                }
            }
            processed += idChunk.length
            console.log(`[INFO] Đã tra cứu: ${processed}/${rows.length}`)
        }

        const NEW_HEADERS = [
            ...headers,
            'supplier_name',
            'product_type',
            'namespace',
        ]
        const outLines = [NEW_HEADERS.join(',')]
        for (const row of rows) {
            const info = infoById[row.item_id] || {
                supplier_name: '',
                product_type: '',
                namespace: '',
            }
            outLines.push(
                NEW_HEADERS.map((h) =>
                    escapeCsvField(row[h] !== undefined ? row[h] : info[h]),
                ).join(','),
            )
        }

        const outputPath = INPUT_FILE.replace(/\.csv$/, '_enriched.csv')
        fs.writeFileSync(outputPath, outLines.join('\n') + '\n', 'utf8')
        console.log(`[DONE] Ghi file: ${outputPath}`)
    } catch (err) {
        console.error('[ERROR]', err)
    } finally {
        process.exit(0)
    }
})()
