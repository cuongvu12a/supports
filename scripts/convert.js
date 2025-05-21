const _ = require('lodash')
const csvtojson = require('csvtojson')
const Bluebird = require('bluebird')
const fs = require('fs')
const path = require('path')
const { mkdirp } = require('mkdirp')

const REAL_INPUT_SIDES = ['front', 'back', 'sleeves', 'hood']
const PRINT_SIDES_GENERATED = [
    'front',
    'back',
    'sleeveLeft',
    'sleeveRight',
    'hood',
    'sleeves',
]
const SUPPLIERS_APPLY_CONTAIN_X_ONLY = ['DFWUS']
const SIDES_APPLY_CONTAIN_X_ONLY = ['front', 'back']

const DPI = 300

;(async () => {
    try {
        const supplierPrefix = 'DFWUS'
        const jsonArray = await csvtojson().fromFile(
            path.join(__dirname, `./dimensions/${supplierPrefix}.csv`)
        )

        const variantGroupByProductType = {}
        const errors = []
        for (const [index, json] of Object.entries(jsonArray)) {
            const requiredFields = ['product_type', 'size']
            _.each(requiredFields, (field) => {
                if (!json[field]) {
                    errors.push(`Error line ${index + 1}: ${field} is required`)
                }
            })
            if (!_.some(REAL_INPUT_SIDES, (side) => !!json[side]))
                throw new Error(
                    `Error line ${index + 1}: At least one side is required`
                )

            if (_.size(errors)) continue

            variantGroupByProductType[_.get(json, 'product_type')] = [
                ...(variantGroupByProductType[_.get(json, 'product_type')] ||
                    []),
                {
                    ...json,
                    size: _.get(json, 'size').toUpperCase(),
                },
            ]
        }

        if (_.size(errors)) throw new Error(errors.join('\n'))

        for (const [productType, productVariants] of Object.entries(
            variantGroupByProductType
        )) {
            await processGenerateProductType({
                productType,
                productVariants,
                supplierPrefix,
            })
        }
    } catch (error) {
        console.log('🚀 ~ ; ~ error:', error)
        process.exit(1)
    } finally {
        process.exit(0)
    }
})()

const processGenerateProductType = async ({
    productType,
    productVariants,
    supplierPrefix,
}) => {
    const files = []
    const dimensionSides = {}
    const disrequire = {
        front: false,
        back: false,
        sleeves: false,
        hood: false,
    }
    _.each(productVariants, (variant) => {
        const generated = processVariant({ variant, supplierPrefix })

        files.push({
            [[
                supplierPrefix,
                `${_.get(variant, 'product_type')}`,
                `${_.get(variant, 'size')}`,
                `${_.get(variant, 'size')}.json`,
            ].join('/')]: {
                ..._.pick(generated, ['partials', 'layout']),
            },
        })

        _.each(_.get(generated, 'dimensions'), (dimension, side) => {
            const exists = _.get(dimensionSides, side, [])
            const vDimension = _.filter(
                dimension,
                (d) =>
                    !_.some(
                        exists,
                        (e) => e.width === d.width && e.height === d.height
                    )
            )

            dimensionSides[side] = [
                ..._.get(dimensionSides, side, []),
                ...vDimension,
            ]
        })

        _.each(_.get(generated, 'disrequire'), (side) => {
            disrequire[side] = true
        })
    })

    files.push({
        [[supplierPrefix, productType, 'default.json'].join('/')]: {
            dimensions: {
                disrequire: Object.keys(disrequire).filter(
                    (side) => disrequire[side]
                ),
                ...dimensionSides,
            },
        },
    })

    await Bluebird.map(
        files,
        async (file) =>
            await Bluebird.map(
                Object.entries(file),
                async ([fileName, content]) => {
                    return await createFile({
                        fileName,
                        content,
                    })
                }
            )
    )

    return true
}

const processVariant = ({ variant, supplierPrefix }) => {
    const partials = {}
    const layout = {}
    const dimensions = {}
    const disrequire = {
        front: false,
        back: false,
        sleeves: false,
        hood: false,
    }

    _.each(PRINT_SIDES_GENERATED, (side) => {
        const { success, data, error } = processGenerateSide({
            side,
            variant,
            supplierPrefix,
        })

        if (!success) {
            throw new Error(error)
        }

        if (!data) return

        if (REAL_INPUT_SIDES.includes(side)) disrequire[side] = true

        if (side === 'sleeves') {
            width =
                _.get(data, 'location.width') || _.get(data, 'steps.0.width')
            height =
                _.get(data, 'location.height') || _.get(data, 'steps.0.height')

            if (!width || !height) return

            dimensions['sleeves'] = [
                ..._.get(dimensions, 'sleeves', []),
                {
                    width,
                    height,
                },
            ]
            return
        }

        partials[side] = [data]
        const addLayout = validateAddLayout({ data, layout, side })
        if (addLayout) {
            _.assign(layout, addLayout)
        }
    })

    return {
        partials,
        layout,
        dimensions,
        disrequire: Object.keys(disrequire).filter((side) => disrequire[side]),
    }
}

const processGenerateSide = ({ variant, side, supplierPrefix }) => {
    const cutSleeve = {
        sleeveLeft: {
            overlay: 'left',
            crop: {
                grid: '2x1',
                position: 1,
            },
            addFields: {
                ignoreTransparent: true,
            },
        },
        sleeveRight: {
            overlay: 'right',
            crop: {
                grid: '2x1',
                position: 0,
            },
            addFields: {
                ignoreTransparent: true,
            },
        },
    }

    if (cutSleeve[side]) {
        const resize = getWidthHeight({
            variant,
            side,
        })

        return processNormal({
            variant,
            side: 'sleeves',
            ...cutSleeve[side],
            defaultValue: {
                ...resize,
                is_cut_sleeve: true,
            },
            supplierPrefix,
        })
    }

    return processNormal({ variant, side, supplierPrefix })
}

const processNormal = ({
    variant,
    side,
    overlay,
    crop,
    defaultValue,
    addFields,
    supplierPrefix,
}) => {
    const { ignore, width, height, error, ...rest } = getWidthHeight({
        variant,
        side,
        defaultValue,
    })

    if (error)
        return {
            success: false,
            error,
        }

    if (ignore) return { success: true }

    let location = {}
    const steps = []
    if (
        SUPPLIERS_APPLY_CONTAIN_X_ONLY.includes(supplierPrefix) &&
        SIDES_APPLY_CONTAIN_X_ONLY.includes(side)
    ) {
        steps.push({
            name: 'resizeV2',
            fit: 'contain-x-only',
            width,
            height,
        })
        location = {
            gravity: 'north',
        }
    } else {
        location = {
            gravity: 'center',
            fit: 'contain',
            width,
            height,
        }
    }

    return {
        success: true,
        data: {
            artwork: side,
            overlay: `${overlay || side}.png`,
            crop: crop || false,
            location,
            ...(addFields || {}),
            ...(_.size(steps) ? { steps } : {}),
        },
    }
}

const getWidthHeight = ({ variant, side, defaultValue }) => {
    if (_.get(defaultValue, 'width') && _.get(defaultValue, 'height'))
        return {
            ..._.pick(defaultValue, [
                'width',
                'height',
                'pixels',
                'inches',
                'cm',
            ]),
        }

    const regex =
        /^\s*(?<width>[\d\.]*)\s*(?:(px)|(cm)|(inch)|(in)|(mm)?)\s*x\s*(?<height>[\d\.]*)\s*(?<unit>(px)|(cm)|(inch)|(in)|(mm)?)\s*$/

    const dimensionSide = _.get(variant, side, '')
    if (!dimensionSide) return { ignore: true }

    const match = dimensionSide.match(regex)
    const unit = formatUnit(
        _.get(match.groups, 'unit') || _.get(variant, 'unit')
    )
    if (!match || !unit)
        return {
            error: `Dimension ${JSON.stringify(
                variant
            )} is invalid side ${side}`,
        }

    const { width, height } = match.groups

    const widthInPixel = convertUnitToPixel({
        value: parseFloat(
            _.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width
        ),
        unit,
        dpi: _.get(variant, 'dpi'),
    })
    const heightInPixel = convertUnitToPixel({
        value: parseFloat(height),
        unit,
        dpi: _.get(variant, 'dpi'),
    })

    return {
        width: widthInPixel,
        height: heightInPixel,
        pixels: {
            width: widthInPixel,
            height: heightInPixel,
        },
        inches: {
            width: convertUnitToUnit({
                value: parseFloat(
                    _.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width
                ),
                unitIn: unit,
                unitOut: 'inch',
                dpi: _.get(variant, 'dpi'),
            }),
            height: convertUnitToUnit({
                value: parseFloat(height),
                unitIn: unit,
                unitOut: 'inch',
                dpi: _.get(variant, 'dpi'),
            }),
        },
        cm: {
            width: convertUnitToUnit({
                value: parseFloat(
                    _.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width
                ),
                unitIn: unit,
                unitOut: 'cm',
                dpi: _.get(variant, 'dpi'),
            }),
            height: convertUnitToUnit({
                value: parseFloat(height),
                unitIn: unit,
                unitOut: 'cm',
                dpi: _.get(variant, 'dpi'),
            }),
        },
    }
}

const validateAddLayout = ({ layout, side, data }) => {
    const width = _.get(data, 'location.width') || _.get(data, 'steps.0.width')
    const height = _.get(data, 'location.height') || _.get(data, 'steps.0.height')
    const layoutWidth = _.get(layout, 'width')
    const layoutHeight = _.get(layout, 'height')

    if (
        !width ||
        !height ||
        (layoutWidth === width && layoutHeight === height)
    ) {
        return null
    }

    if (!layoutWidth && !layoutHeight) {
        return {
            width,
            height,
        }
    }

    return {
        [side]: {
            width,
            height,
        },
    }
}

const createFile = async ({ fileName, content }) => {
    const filePath = path.join(__dirname, `dimensions/${fileName}`)
    const folder = filePath.split('/').slice(0, -1).join('/')

    await mkdirp(folder)

    await new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(content, null, 2), (error) => {
            if (error) {
                reject(error)
            }

            resolve()
        })
    })

    return filePath
}

const formatUnit = (unit) => {
    switch (unit) {
        case 'in':
            return 'inch'
        default:
            return unit
    }
}

const convertUnitToPixel = ({ value, unit, dpi }) => {
    const vDpi = dpi || DPI
    if (unit === 'px') return value

    if (['inch', 'in'].includes(unit)) return value * vDpi

    if (unit === 'cm') return Math.round((value * vDpi) / 2.54)

    if (unit === 'mm') return Math.round(((value / 10) * vDpi) / 2.54)
}

const convertUnitToUnit = ({ value, unitIn, unitOut, dpi }) => {
    const vUnitIn = formatUnit(unitIn)
    const vUnitOut = formatUnit(unitOut)

    if (vUnitIn === vUnitOut) return value

    if (vUnitOut === 'px') {
        return convertUnitToPixel({
            value,
            unit: vUnitIn,
            dpi,
        })
    }

    if (vUnitOut === 'inch') {
        switch (vUnitIn) {
            case 'px':
                return roundToTwo(value / dpi)
            case 'cm':
                return roundToTwo(value / 2.54)
            case 'mm':
                return roundToTwo(value / 10 / 2.54)
        }
    }

    if (vUnitOut === 'cm') {
        switch (vUnitIn) {
            case 'px':
                return roundToTwo((value / dpi) * 2.54)
            case 'inch':
                return roundToTwo(value * 2.54)
            case 'mm':
                return roundToTwo(value / 10)
        }
    }
}

function roundToTwo(num) {
    return Math.round(num * 100) / 100
}

function centerString(input, totalLength) {
    const strInput = `${input}`
    const inputLength = strInput.length

    if (totalLength <= inputLength) {
        return strInput
    }

    const totalPadding = totalLength - inputLength

    const paddingLeft = Math.ceil(totalPadding / 2)
    const paddingRight = totalPadding - paddingLeft

    return ' '.repeat(paddingLeft) + strInput + ' '.repeat(paddingRight)
}
