require('dotenv').config()
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const Bluebird = require('bluebird')
const _ = require('lodash')

const { getModel } = require('./connections/database')
const fulfillments = require('./fulfillments.json')

const FulfillmentItem = getModel('FulfillmentItem')

// ─── S3 CONFIG – lấy từ biến môi trường (.env) ────────────────────────────────
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY
const S3_SECRET_KEY = process.env.S3_SECRET_KEY
const S3_REGION = process.env.S3_REGION
const S3_BUCKET = process.env.S3_BUCKET
// ──────────────────────────────────────────────────────────────────────────────

const EXPIRE_SECONDS = 90 * 24 * 60 * 60 // 90 ngày
const CONCURRENCY = 5

const s3 = new AWS.S3({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    signatureVersion: 'v2',
})

const DESIGN_FIELDS = [
    'design_front',
    'design_back',
    'design_sleeves',
    'design_hood',
]

// Parse URL, tự thêm scheme https:// nếu chuỗi thiếu scheme (vd: "merchize-artworks.s3...amazonaws.com/key")
function parseUrlLoose(url) {
    try {
        return new URL(url)
    } catch (_e) {}
    try {
        return new URL(`https://${url}`)
    } catch (_e) {
        return null
    }
}

// Trích xuất S3 key từ URL (hỗ trợ s3:// và https://, kể cả thiếu scheme)
function extractS3Key(url) {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('s3://')) {
        const withoutScheme = url.replace('s3://', '')
        const slashIdx = withoutScheme.indexOf('/')
        if (slashIdx < 0) return null
        return withoutScheme.slice(slashIdx + 1)
    }
    const parsed = parseUrlLoose(url)
    if (parsed && parsed.hostname.endsWith('.amazonaws.com')) {
        const pathname = parsed.pathname.slice(1)
        // path-style: s3.region.amazonaws.com/bucket/key
        if (
            parsed.hostname.startsWith('s3.') ||
            parsed.hostname.startsWith('s3-')
        ) {
            const parts = pathname.split('/')
            parts.shift() // bỏ bucket
            return parts.join('/')
        }
        // virtual-hosted: bucket.s3.region.amazonaws.com/key
        return pathname
    }
    return null
}

// Kiểm tra 1 URL có phải là link S3 hay không (https://bucket.s3.region.amazonaws.com/key, không cần start bằng s3://)
function isS3Link(url) {
    if (!url || typeof url !== 'string') return false
    if (url.startsWith('s3://')) return true
    const parsed = parseUrlLoose(url)
    return !!parsed && parsed.hostname.endsWith('.amazonaws.com')
}

// Trích xuất tên bucket từ URL (hỗ trợ s3://, path-style và virtual-hosted style)
function extractS3Bucket(url) {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('s3://')) {
        const withoutScheme = url.replace('s3://', '')
        const slashIdx = withoutScheme.indexOf('/')
        return slashIdx < 0 ? withoutScheme : withoutScheme.slice(0, slashIdx)
    }
    const parsed = parseUrlLoose(url)
    if (!parsed || !parsed.hostname.endsWith('.amazonaws.com')) return null
    // path-style: s3.region.amazonaws.com/bucket/key
    if (parsed.hostname.startsWith('s3.') || parsed.hostname.startsWith('s3-')) {
        const pathname = parsed.pathname.slice(1)
        return pathname.split('/')[0] || null
    }
    // virtual-hosted: bucket.s3.region.amazonaws.com/key
    return parsed.hostname.split('.s3')[0] || null
}

// Gia hạn 1 link S3 lên 45 ngày bằng Signature V2 (chỉ gia hạn nếu cùng bucket với S3_BUCKET)
async function reExpireS3Link(url) {
    if (!url || typeof url !== 'string') return url
    const key = extractS3Key(url)
    if (!key) return url
    const bucket = extractS3Bucket(url)
    if (bucket !== S3_BUCKET) {
        console.warn(`[SKIP] Bucket khác (${bucket}), giữ nguyên link: ${url}`)
        return url
    }
    try {
        return await s3.getSignedUrlPromise('getObject', {
            Bucket: S3_BUCKET,
            Key: key,
            Expires: EXPIRE_SECONDS,
        })
    } catch (e) {
        console.warn(`[WARN] Không thể gia hạn link: ${url} – ${e.message}`)
        return url
    }
}

// Thoát field cho CSV dùng , làm delimiter; newline trong nội dung thay bằng \n literal
function escapeCsvField(value) {
    if (value === null || value === undefined) return ''
    const str = String(value)
    const normalized = str
        .replace(/\r\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\n/g, '\\n')
    if (normalized.includes('"') || normalized.includes(',')) {
        return '"' + normalized.replace(/"/g, '""') + '"'
    }
    return normalized
}

;(async () => {
    try {
        const HEADERS = ['item_id', 'name_item_number', ...DESIGN_FIELDS]

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19)
        const outputPath = path.join(
            __dirname,
            `design_reexpire_${timestamp}.csv`,
        )
        fs.writeFileSync(outputPath, HEADERS.join(',') + '\n', 'utf8')
        console.log(`[INFO] Ghi file: ${outputPath}`)
        let totalRows = 0
        let lastId = null
        while (true) {
            const query = {
                created: { $gte: '2026-07-13', $lt: '2026-07-14' },
                supplier: {
                    $in: [
                        '5cf099aa3b7f1e3d46b7ae73',
                        '66dad3efcdd92285af643843',
                    ],
                },
            }
            if (lastId) query._id = { $gt: lastId }

            const items = await FulfillmentItem.find(query)
                .sort({ _id: 1 })
                .limit(100)
                .lean()

            if (_.size(items) == 0) break

            for (const item of items) {
                const row = {
                    item_id: item._id.toString(),
                    name_item_number: `${item.name}_${item.item_number}`,
                }

                for (const field of DESIGN_FIELDS) {
                    const value = item[field]
                    row[field] = isS3Link(value)
                        ? await reExpireS3Link(value)
                        : value || ''
                }

                fs.appendFileSync(
                    outputPath,
                    HEADERS.map((h) => escapeCsvField(row[h])).join(',') + '\n',
                    'utf8',
                )
                totalRows++
            }

            lastId = _.last(items)?._id
            console.log(
                `totalRows: ${totalRows}, lastId: ${lastId}, lastCreatedDate:`,
                _.last(items)?.created,
            )
        }

        console.log(`\n[DONE] Xuất ${totalRows} bản ghi ra: ${outputPath}`)
    } catch (err) {
        console.error('[ERROR]', err)
    } finally {
        process.exit(0)
    }
})()
