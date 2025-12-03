const { getModel } = require('../connections/database')
const FulfillmentItem = getModel('FulfillmentItem')
const History = getModel('History')

;(async () => {
    const items = await FulfillmentItem.find({
        'variant_data.product_type': 'GLASS_ORN_US',
        created: {
            $gte: new Date('2025-11-11T00:00:00Z'),
            $lt: new Date('2025-11-26T00:00:00Z'),
        },
    }).lean()
    console.log(`Found ${items.length} items`)

    for (const item of items) {
        const histories = await History.find({
            object_id: item._id,
            event: 'WORKER_GENERATE_PRINTING_FILE',
        }).sort({ created: 1 })

        const isPrintingGenerated = histories.some((history) =>
            history.user.startsWith('[CONSUMER_SUP')
        )
        if (!isPrintingGenerated) {
            console.log(item.name)
        }
    }
})()
