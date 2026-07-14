require('dotenv').config()
const AWS = require('aws-sdk')

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY
const S3_SECRET_KEY = process.env.S3_SECRET_KEY
const S3_REGION = process.env.S3_REGION
const S3_BUCKET = process.env.S3_BUCKET
const EXPIRE_SECONDS = 45 * 24 * 60 * 60

const s3 = new AWS.S3({
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
    region: S3_REGION,
    signatureVersion: 'v2',
})

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
        if (parsed.hostname.endsWith('.amazonaws.com')) {
            const pathname = parsed.pathname.slice(1)
            if (parsed.hostname.startsWith('s3.') || parsed.hostname.startsWith('s3-')) {
                const parts = pathname.split('/')
                parts.shift()
                return parts.join('/')
            }
            return pathname
        }
    } catch (_e) {}
    return url
}

async function reExpireS3Link(url) {
    const key = extractS3Key(url)
    console.log('Key extracted:', key)

    const signed = await s3.getSignedUrlPromise('getObject', {
        Bucket: S3_BUCKET,
        Key: key,
        Expires: EXPIRE_SECONDS,
    })
    return signed
}

;(async () => {
    const testUrl = 'https://merchize-artworks.s3.us-west-1.amazonaws.com/w1fegjx/artworks/6a38fb474b65b34ef26652ed/order-items/6a38fb484b65b3eadb665309/26/06/05o8cx48yrdq.png?AWSAccessKeyId=AKIAWYYRKM2QFT2QVQH3&Expires=1789896635&Signature=lpv8qCSOz0Z%2FNZUiumsrKLq0Wjs%3D'

    console.log('Input URL:', testUrl)
    const result = await reExpireS3Link(testUrl)
    console.log('\nSigned URL:', result)
})()
