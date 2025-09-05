const { createMongoConnection } = require('@pf126/common').connectors
const createStore = require('@pf126/fulfillment-schemas')

const MONGODB_URI =
    'mongodb://you:VBAYz3J5xSS9O2qw@ip-172-7-3-244.ap-southeast-1.compute.internal,ip-172-7-9-12.ap-southeast-1.compute.internal:27017,ip-172-7-14-108.ap-southeast-1.compute.internal:27017/fulfillment?replicaSet=rs0&readPreference=primary'

const originConnection = createMongoConnection(MONGODB_URI, {
    poolSize: 10,
    debug: process.env.MONGODB_DEBUG === 'true',
})

module.exports = createStore(originConnection)
module.exports.getConnection().on('connected', () => {
    console.log('Connected MONGODB_URI')
})
module.exports.getConnection().on('disconnected', () => {
    console.log('Disconnected MONGODB_URI')
})
