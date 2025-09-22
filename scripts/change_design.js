const _ = require('lodash')
const csvtojson = require('csvtojson')
const path = require('path')
const Bluebird = require('bluebird')

const { getModel } = require('../connections/database')

const Order = getModel('Order')
const OrderItem = getModel('OrderItem')
const Fulfillment = getModel('Fulfillment')
const FulfillmentItem = getModel('FulfillmentItem')
const Supplier = getModel('Supplier')

;(async () => {
    try {
        const jsonArray = await csvtojson().fromFile(
            path.join(__dirname, `./dimensions/data.csv`)
        )

        const groupItemByOrder = {}
        const results = []
        for (const [index, json] of Object.entries(jsonArray)) {
            const order_number = _.get(json, 'order_number', '').trim()
            const order_item_id = _.get(json, 'order_item_id', '').trim()
            const design_front = _.get(json, 'imported_design', '').trim()

            if (!order_number || !order_item_id || !design_front) {
                results.push({
                    index,
                    order_number,
                    order_item_id,
                    design_front,
                    status: 'skipped',
                    reason: 'missing data',
                })
                continue
            }

            if (_.get(groupItemByOrder, [order_number, order_item_id])) {
                results.push({
                    index,
                    order_number,
                    order_item_id,
                    design_front,
                    status: 'skipped',
                    reason: 'duplicate entry',
                })
                continue
            }

            groupItemByOrder[order_number] = {
                ...(groupItemByOrder[order_number] || {}),
                [order_item_id]: design_front,
            }
        }

        // const suppliersById = {}
        // const suppliers = await Supplier.find({}).lean()
        // for (const supplier of suppliers) {
        //     suppliersById[supplier._id.toString()] = supplier.sku_prefix
        // }

        // const groupPackageBySupplier = {}
        // for (const [order_number, items] of Object.entries(groupItemByOrder)) {

        // }
        await Bluebird.mapSeries(
            Object.entries(groupItemByOrder),
            async ([order_number, items]) => {
                const order = await Order.findOne({
                    id: order_number,
                }).lean()

                if (!order) {
                    results.push({
                        order_number,
                        status: 'skipped',
                        reason: 'order not found',
                    })
                    return
                }

                const fulfillments = await Fulfillment.find({
                    order: order._id,
                }).lean()

                if (!fulfillments.length) {
                    results.push({
                        order_number,
                        status: 'skipped',
                        reason: 'no fulfillments found',
                    })
                    return
                }

                for (const fulfillment of fulfillments) {
                    const supplier = _.get(fulfillment, 'supplier')
                    if (
                        !supplier ||
                        supplier.toString() !== '66e0065b9bd01fa00fef6074'
                    ) {
                        // skip Printify
                        results.push({
                            order_number,
                            fulfillment: fulfillment._id,
                            status: 'skipped',
                            reason: 'not Printify fulfillment',
                        })
                        continue
                    }

                    // groupPackageBySupplier[suppliersById[supplier]] =
                    //     (groupPackageBySupplier[suppliersById[supplier]] || 0) + 1
                    const fulfillmentItems = await FulfillmentItem.find({
                        fulfillment: fulfillment._id,
                    }).lean()

                    for (const fulfillmentItem of fulfillmentItems) {
                        const design_back = _.get(
                            fulfillmentItem,
                            'design_back'
                        )
                        const design_sleeves = _.get(
                            fulfillmentItem,
                            'design_sleeves'
                        )
                        const design_hood = _.get(
                            fulfillmentItem,
                            'design_hood'
                        )
                        if (design_back || design_sleeves || design_hood) {
                            results.push({
                                fulfillmentItem: fulfillmentItem._id,
                                status: 'skipped',
                                reason: 'back/sleeves/hood design already exists',
                            })
                            continue
                        }

                        const order_item = _.get(fulfillmentItem, 'order_item')
                        const orderItem = await OrderItem.findOne({
                            _id: order_item,
                        }).lean()

                        const order_item_id = _.get(orderItem, 'order_item_id')

                        const design_front = _.get(groupItemByOrder, [
                            order_number,
                            order_item_id,
                        ])

                        if (!design_front) {
                            results.push({
                                fulfillmentItem: fulfillmentItem._id,
                                order_item_id,
                                status: 'skipped',
                                reason: 'no design found for this item',
                            })
                            continue
                        }

                        await FulfillmentItem.updateOne(
                            { _id: fulfillmentItem._id },
                            { $set: { design_front, status: 'retry' } }
                        )

                        results.push({
                            fulfillmentItem: fulfillmentItem._id,
                            order_item_id,
                            design_front,
                            status: 'updating',
                        })
                    }
                }
            },
            { concurrency: 10 }
        )

        console.table(results)
    } catch (error) {
        console.error('Error updating designs:', error)
    } finally {
        process.exit(0)
    }
})()
