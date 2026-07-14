require('dotenv').config()
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const _ = require('lodash')
const Bluebird = require('bluebird')

const { getModel } = require('../connections/database')

const History = getModel('History')
const FulfillmentItem = getModel('FulfillmentItem')
const RequestUpdate = getModel('RequestUpdate')

// ─── S3 CONFIG – lấy từ biến môi trường (.env) ────────────────────────────────
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY
const S3_SECRET_KEY = process.env.S3_SECRET_KEY
const S3_REGION = process.env.S3_REGION
const S3_BUCKET = process.env.S3_BUCKET
// ──────────────────────────────────────────────────────────────────────────────

const EXPIRE_SECONDS = 45 * 24 * 60 * 60 // 45 ngày
const PAGE_SIZE = 100
const CONCURRENCY = 5

const s3 = new AWS.S3({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    signatureVersion: 'v2',
})

// Trích xuất S3 key từ URL (hỗ trợ s3:// và https://)
function extractS3Key(url) {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('s3://')) {
        const withoutScheme = url.replace('s3://', '')
        const slashIdx = withoutScheme.indexOf('/')
        if (slashIdx < 0) return null
        return withoutScheme.slice(slashIdx + 1)
    }
    try {
        const parsed = new URL(url)
        // Bỏ query string trước khi parse key (URL có thể đã là presigned)
        if (parsed.hostname.endsWith('.amazonaws.com')) {
            const pathname = parsed.pathname.slice(1)
            // path-style: s3.region.amazonaws.com/bucket/key
            if (parsed.hostname.startsWith('s3.') || parsed.hostname.startsWith('s3-')) {
                const parts = pathname.split('/')
                parts.shift() // bỏ bucket
                return parts.join('/')
            }
            // virtual-hosted: bucket.s3.region.amazonaws.com/key
            return pathname
        }
    } catch (_e) {}
    return url
}

// Gia hạn 1 link S3 lên 45 ngày bằng Signature V2
async function reExpireS3Link(url) {
    if (!url || typeof url !== 'string') return url
    const key = extractS3Key(url)
    if (!key) return url
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

// Gia hạn toàn bộ các link trong artworks object
async function reExpireArtworks(artworks) {
    if (!artworks || typeof artworks !== 'object') return artworks
    const result = {}
    for (const [k, v] of Object.entries(artworks)) {
        result[k] = typeof v === 'string' ? await reExpireS3Link(v) : v
    }
    return result
}

// Thoát field cho CSV dùng , làm delimiter; newline trong nội dung thay bằng \n literal
function escapeCsvField(value) {
    if (value === null || value === undefined) return ''
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
    const normalized = str.replace(/\r\n/g, '\\n').replace(/\r/g, '\\n').replace(/\n/g, '\\n')
    if (normalized.includes('"') || normalized.includes(',')) {
        return '"' + normalized.replace(/"/g, '""') + '"'
    }
    return normalized
}

// Tìm History với event chỉ định đứng trước gần nhất so với targetId (theo vị trí trong mảng đã sort)
function findPrevHistoryByEvent(sortedHistories, targetId, event) {
    const targetIdx = sortedHistories.findIndex(
        (h) => h._id.toString() === targetId.toString()
    )
    if (targetIdx < 0) return null
    for (let i = targetIdx - 1; i >= 0; i--) {
        if (sortedHistories[i].event === event) return sortedHistories[i]
    }
    return null
}

// Trích xuất thông tin artwork/image từ 1 WORKER history
async function extractWorkerInfo(workerHistory) {
    if (!workerHistory) return { artworks: null, image: null, preview_image: null }
    const rawArtworks = _.get(workerHistory, 'meta.artworks')
    const artworks = rawArtworks ? await reExpireArtworks(rawArtworks) : null
    const updated = JSON.parse(_.get(workerHistory, 'meta.updated'))
    const image = _.get(updated, 'set.image') || null
    const previewImage = _.get(updated, 'set.preview_image') || null
    return { artworks, image, preview_image: previewImage }
}

;(async () => {
    try {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - 75)

        const HEADERS = [
            'history_id',
            'request_id',
            'request_content',
            'artworks',
            'prev_image',
            'prev_preview_image',
            'after_artworks',
            'after_new_image',
            'after_preview_image',
            'mock_up',
            'product_type',
            'size',
        ]

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const outputPath = path.join(__dirname, `../request_update_design_${timestamp}.csv`)
        fs.writeFileSync(outputPath, HEADERS.join(',') + '\n', 'utf8')
        console.log(`[INFO] Ghi file: ${outputPath}`)

        let totalRows = 0
        let lastId = null
        let pageNum = 0

        console.log(`[INFO] Bắt đầu query từ ${cutoffDate.toISOString()}`)

        // ── Bước 1: Phân trang qua toàn bộ History thoả mãn điều kiện ──────────
        while (true) {
            pageNum++
            const baseQuery = {
                _id: '69d8bf9031a15b1b8dd52f7b',
                object_type: 'FulfillmentItem',
                event: 'request_update_design',
                created_at: { $gte: cutoffDate },
            }
            if (lastId) {
                baseQuery._id = { $gt: lastId }
                delete baseQuery.created_at
            }

            const page = await History.find(baseQuery)
                .sort({ _id: 1 })
                .limit(PAGE_SIZE)
                .lean()

            if (!page.length) break
            console.log(`[INFO] Page ${pageNum}: lấy được ${page.length} History`)
            lastId = page[page.length - 1]._id

            // ── Bước 2: Xử lý song song từng History trong page ────────────────
            await Bluebird.mapSeries(
                page,
                async (history) => {
                    const requestId = _.get(history, 'meta.requestId')
                    const itemId = history.object_id

                    if (!requestId || !itemId) {
                        console.warn(`[WARN] Bỏ qua history ${history._id}: thiếu requestId hoặc object_id`)
                        return
                    }

                    // Kiểm tra supplier trước, bỏ qua nếu không khớp
                    const item = await FulfillmentItem.findOne({ _id: itemId }).lean()
                    if (!item || item.supplier?.toString() !== '66dad3efcdd92285af643843') {
                        console.warn(`[WARN] Bỏ qua item ${itemId}: không đúng supplier`)
                        return
                    }

                    // Lấy toàn bộ histories của item, sort theo created_at tăng dần
                    const itemHistories = await History.find({
                        object_type: 'FulfillmentItem',
                        object_id: itemId,
                    })
                        .sort({ created_at: 1 })
                        .lean()
                    console.log("🚀 ~ itemHistories:", itemHistories)

                    // prev: WORKER đứng trước history gốc (request_update_design)
                    const prevWorker = findPrevHistoryByEvent(
                        itemHistories,
                        history._id,
                        'WORKER_GENERATE_PRINTING_FILE'
                    )
                    console.log("🚀 ~ prevWorker:", prevWorker)
                    const { artworks: prevArtworks, image: prevImage, preview_image: prevPreviewImage } =
                        await extractWorkerInfo(prevWorker)

                    // after: tìm history cuối cùng có event + description thoả mãn
                    let afterWorker = null
                    for (let i = itemHistories.length - 1; i >= 0; i--) {
                        const h = itemHistories[i]
                        if (
                            h.event === 'update_item_printing_file_status' &&
                            h.description === "Updated item's printing file status to done"
                        ) {
                            afterWorker = findPrevHistoryByEvent(
                                itemHistories,
                                h._id,
                                'WORKER_GENERATE_PRINTING_FILE'
                            )
                            break
                        }
                    }
                    console.log("🚀 ~ afterWorker:", afterWorker)
                    const { artworks: afterArtworks, image: afterImage, preview_image: afterPreviewImage } =
                        await extractWorkerInfo(afterWorker)

                    // Lấy FulfillmentItem
                    const productType = _.get(item, 'variant_data.product_type') || ''
                    const size = _.get(item, 'variant_data.size') || ''
                    const mockUp = _.get(item, 'mock_up') || ''

                    // Lấy RequestUpdate
                    const requestUpdate = await RequestUpdate.findOne({ _id: requestId }).lean()
                    const content = _.get(requestUpdate, 'content') || ''

                    const row = {
                        history_id: history._id.toString(),
                        request_id: requestId.toString(),
                        request_content: content,
                        artworks: prevArtworks != null ? JSON.stringify(prevArtworks) : '',
                        prev_image: prevImage || '',
                        prev_preview_image: prevPreviewImage || '',
                        after_artworks: afterArtworks != null ? JSON.stringify(afterArtworks) : '',
                        after_new_image: afterImage || '',
                        after_preview_image: afterPreviewImage || '',
                        mock_up: mockUp,
                        product_type: productType,
                        size: size,
                    }
                    fs.appendFileSync(outputPath, HEADERS.map((h) => escapeCsvField(row[h])).join(',') + '\n', 'utf8')
                    totalRows++
                },
                { concurrency: CONCURRENCY }
            )

            console.log(`[INFO] Page ${pageNum}: đã ghi ${totalRows} bản ghi tổng cộng`)
            if (page.length < PAGE_SIZE) break

            break
        }

        console.log(`\n[DONE] Xuất ${totalRows} bản ghi ra: ${outputPath}`)
    } catch (err) {
        console.error('[ERROR]', err)
    } finally {
        process.exit(0)
    }
})()
