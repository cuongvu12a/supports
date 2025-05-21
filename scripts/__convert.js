const _ = require('lodash')
const csvtojson = require('csvtojson')
const Bluebird = require('bluebird')
const fs = require('fs')
const path = require('path')

const allSides = ['front', 'back', 'sleeves', 'hood']
const DPI = 300

;(async () => {
    try {
        const supplierPrefix = 'DFWUS'
        const jsonArray = await csvtojson().fromFile(path.join(__dirname, `./dimensions/${supplierPrefix}.csv`))

        const variantGroupByProductType = {}
        const errors = []
        for (const [index, json] of Object.entries(jsonArray)) {
            const requiredFields = ['product_type', 'size']
            _.each(requiredFields, field => {
                if (!json[field]) {
                    errors.push(`Error line ${index + 1}: ${field} is required`)
                }
            })
            if (!_.some(allSides, side => !!json[side])) throw new Error(`Error line ${index + 1}: At least one side is required`)

            if (_.size(errors)) continue

            variantGroupByProductType[_.get(json, 'product_type')] = [
                ...(variantGroupByProductType[_.get(json, 'product_type')] || []),
                {
                    ...json,
                    size: _.get(json, 'size').toUpperCase(),
                },
            ]
        }

        if (_.size(errors)) throw new Error(errors.join('\n'))

        for (const [productType, productVariants] of Object.entries(variantGroupByProductType)) {
            const { readme, ...processed } = await processGenerateProductType({
                productType,
                productVariants,
                supplierPrefix,
            })
            console.log('================Start================')
            console.log(JSON.stringify(processed, null, 2))
            console.log('=====Readme=====')
            console.log(readme)
            console.log('================End================')
        }
    } catch (error) {
        console.log('🚀 ~ ; ~ error:', error)
        process.exit(1)
    } finally {
        process.exit(0)
    }
})()

const processGenerateProductType = async ({ productType, productVariants, supplierPrefix }) => {
    const allowSizes = []
    const files = []
    const dimensionSides = {}
    const readmeJson = []
    const disrequire = {
        front: false,
        back: false,
        sleeves: false,
        hood: false,
    }
    _.each(productVariants, (variant, index) => {
        allowSizes.push(_.get(variant, 'size'))

        const generated = processVariant(variant)

        files.push({
            [[supplierPrefix, `${_.get(variant, 'product_type')}`, `${_.get(variant, 'size')}`, `${_.get(variant, 'size')}.json`].join('/')]: {
                ..._.pick(generated, ['partials', 'layout']),
            },
        })

        _.each(_.get(generated, 'dimensions'), (dimension, side) => {
            const exists = _.get(dimensionSides, side, [])
            const vDimension = _.filter(dimension, d => !_.some(exists, e => e.width === d.width && e.height === d.height))

            dimensionSides[side] = [..._.get(dimensionSides, side, []), ...vDimension]
        })

        _.each(_.get(generated, 'disrequire'), side => {
            disrequire[side] = true
        })

        const readmeVariant = getReadMeJson({
            index,
            variant,
            generated,
            supplierPrefix,
        })

        readmeJson.push(...readmeVariant)
    })

    const filesCreated = await Bluebird.map(
        files,
        async file =>
            await Bluebird.map(Object.entries(file), async ([fileName, content]) => {
                return await createFile({
                    fileName,
                    content,
                })
            })
    )

    const readme = [`# ${productType}`, `- Types: ${productType}`, `- Variant: ${productType}`, `- Output (${_.get(productVariants, '0.dpi', DPI)} DPI)`, '', jsonToMarkdownTable(readmeJson), '', '---'].join('\n')

    return {
        params: {
            type: productType,
            allowSizes,
            dimensions: {
                disrequire: Object.keys(disrequire).filter(side => disrequire[side]),
                ...dimensionSides,
            },
        },
        files: filesCreated,
        readme,
    }
}

const processVariant = variant => {
    const partials = {}
    const layout = {}
    const dimensions = {}
    const readmeDimensions = {}
    const disrequire = {
        front: false,
        back: false,
        sleeves: false,
        hood: false,
    }

    const normalSides = ['front', 'back', 'sleeveLeft', 'sleeveRight', 'hood', 'sleeves']
    _.each(normalSides, side => {
        const { success, data, readme, error } = processGenerateSide({
            side,
            variant,
        })

        if (!success) {
            throw new Error(error)
        }

        if (!data) return

        if (allSides.includes(side)) disrequire[side] = true

        if (side === 'sleeves') {
            if (!_.get(data, 'location.width') || !_.get(data, 'location.height')) return

            dimensions['sleeves'] = [
                ..._.get(dimensions, 'sleeves', []),
                {
                    width: _.get(data, 'location.width'),
                    height: _.get(data, 'location.height'),
                },
            ]
            return
        }

        partials[side] = [data]
        readmeDimensions[side] = readme
        const addLayout = validateAddLayout({ data, layout, side })
        if (addLayout) {
            _.assign(layout, addLayout)
        }
    })

    return {
        partials,
        layout,
        dimensions,
        disrequire: Object.keys(disrequire).filter(side => disrequire[side]),
        readme: readmeDimensions,
    }
}

const processGenerateSide = ({ variant, side }) => {
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
        })
    }

    return processNormal({ variant, side })
}

const processNormal = ({ variant, side, overlay, crop, defaultValue, addFields }) => {
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

    return {
        success: true,
        data: {
            artwork: side,
            overlay: `${overlay || side}.png`,
            crop: crop || false,
            location: {
                gravity: 'center',
                fit: 'contain',
                width,
                height,
            },
            ...(addFields || {}),
        },
        readme: {
            pixels: `${width} x ${height}`,
            inches: `${_.get(rest, 'inches.width')} x ${_.get(rest, 'inches.height')}`,
            cm: `${_.get(rest, 'cm.width')} x ${_.get(rest, 'cm.height')}`,
        },
    }
}

const getWidthHeight = ({ variant, side, defaultValue }) => {
    if (_.get(defaultValue, 'width') && _.get(defaultValue, 'height'))
        return {
            ..._.pick(defaultValue, ['width', 'height', 'pixels', 'inches', 'cm']),
        }

    const regex = /^\s*(?<width>[\d\.]*)\s*(?:(px)|(cm)|(inch)|(in)|(mm)?)\s*x\s*(?<height>[\d\.]*)\s*(?<unit>(px)|(cm)|(inch)|(in)|(mm)?)\s*$/

    const dimensionSide = _.get(variant, side, '')
    if (!dimensionSide) return { ignore: true }

    const match = dimensionSide.match(regex)
    const unit = formatUnit(_.get(match.groups, 'unit') || _.get(variant, 'unit'))
    if (!match || !unit)
        return {
            error: `Dimension ${JSON.stringify(variant)} is invalid side ${side}`,
        }

    const { width, height } = match.groups

    const widthInPixel = convertUnitToPixel({
        value: parseFloat(_.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width),
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
                value: parseFloat(_.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width),
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
                value: parseFloat(_.get(defaultValue, 'is_cut_sleeve') ? width / 2 : width),
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
    const width = _.get(data, 'location.width')
    const height = _.get(data, 'location.height')
    const layoutWidth = _.get(layout, 'width')
    const layoutHeight = _.get(layout, 'height')

    if (!width || !height || (layoutWidth === width && layoutHeight === height)) {
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

    await new Promise((resolve, reject) => {
        require('mkdirp')(folder, function (err) {
            if (err) return reject(err)

            return resolve(true)
        })
    })

    await new Promise((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(content, null, 2), error => {
            if (error) {
                reject(error)
            }

            resolve()
        })
    })

    return filePath
}

const getReadMeJson = ({ index, variant, generated, supplierPrefix }) => {
    const size = _.get(variant, 'size')
    const supplierCustomMapping = {
        SPUS: {
            hood: 'Neck',
        },
    }
    const mappingSide = {
        front: 'Front',
        back: 'Back',
        sleeveLeft: 'Left',
        sleeveRight: 'Right',
        hood: 'Hood',
        ...supplierCustomMapping[supplierPrefix],
    }

    const subRows = []
    _.each(_.get(generated, 'readme'), (readme, side) => {
        const sideName = mappingSide[side]

        subRows.push({
            Index: '',
            Size: '',
            Side: sideName,
            Pixels: _.get(readme, 'pixels', ''),
            Inches: _.get(readme, 'inches', ''),
            Centimeters: _.get(readme, 'cm', ''),
        })
    })

    return [
        {
            ..._.first(subRows),
            Index: index + 1,
            Size: size,
        },
        ..._.tail(subRows),
    ]
}

function jsonToMarkdownTable(jsonData) {
    const rows = []

    const lengthCol = {
        index: 7,
        size: 7,
        side: 7,
        pixels: 15,
        inches: 17,
        centimeters: 17,
    }

    jsonData.forEach(item => {
        const lengthIndex = getItemLengthCol({ item, field: 'Index' })
        const lengthSize = getItemLengthCol({ item, field: 'Size' })
        const lengthSide = getItemLengthCol({ item, field: 'Side' })
        const lengthPixels = getItemLengthCol({ item, field: 'Pixels' })
        const lengthInches = getItemLengthCol({ item, field: 'Inches' })
        const lengthCentimeters = getItemLengthCol({
            item,
            field: 'Centimeters',
        })

        lengthCol.index = Math.max(lengthCol.index, lengthIndex)
        lengthCol.size = Math.max(lengthCol.size, lengthSize)
        lengthCol.side = Math.max(lengthCol.side, lengthSide)
        lengthCol.pixels = Math.max(lengthCol.pixels, lengthPixels)
        lengthCol.inches = Math.max(lengthCol.inches, lengthInches)
        lengthCol.centimeters = Math.max(lengthCol.centimeters, lengthCentimeters)
    })

    jsonData.forEach((item, index) => {
        if (item.Index && index !== 0) {
            rows.push(
                formatRow({
                    index: getSeparator({
                        length: _.get(lengthCol, 'index'),
                    }),
                    size: getSeparator({
                        length: _.get(lengthCol, 'size'),
                    }),
                    side: getSeparator({
                        length: _.get(lengthCol, 'side'),
                    }),
                    pixels: getSeparator({
                        length: _.get(lengthCol, 'pixels'),
                    }),
                    inches: getSeparator({
                        length: _.get(lengthCol, 'inches'),
                    }),
                    centimeters: getSeparator({
                        length: _.get(lengthCol, 'centimeters'),
                    }),
                    lengthCol,
                })
            )
        }
        rows.push(
            formatRow({
                index: _.get(item, 'Index'),
                size: _.get(item, 'Size'),
                side: _.get(item, 'Side'),
                pixels: _.get(item, 'Pixels'),
                inches: _.get(item, 'Inches'),
                centimeters: _.get(item, 'Centimeters'),
                lengthCol,
            })
        )
    })

    const headers = formatRow({
        index: 'Index',
        size: 'Size',
        side: 'Side',
        pixels: 'Pixels',
        inches: 'Inches',
        centimeters: 'Centimeters',
        lengthCol,
    })
    const separator = formatRow({
        index: getSeparator({
            length: _.get(lengthCol, 'index'),
            isHeader: true,
        }),
        size: getSeparator({
            length: _.get(lengthCol, 'size'),
            isHeader: true,
        }),
        side: getSeparator({
            length: _.get(lengthCol, 'side'),
            isHeader: true,
        }),
        pixels: getSeparator({
            length: _.get(lengthCol, 'pixels'),
            isHeader: true,
        }),
        inches: getSeparator({
            length: _.get(lengthCol, 'inches'),
            isHeader: true,
        }),
        centimeters: getSeparator({
            length: _.get(lengthCol, 'centimeters'),
            isHeader: true,
        }),
        lengthCol,
    })

    return [headers, separator, ...rows].join('\n')
}

const getSeparator = ({ length, isHeader }) => {
    const prefix = isHeader ? ':' : '-'

    return `${prefix}${'-'.repeat(length - 4)}${prefix}`
}

const getItemLengthCol = ({ item, field }) => (`${_.get(item, field)}`.length % 2 === 0 ? `${_.get(item, field)}`.length + 2 : `${_.get(item, field)}`.length + 3)
const formatRow = ({ index, size, side, pixels, inches, centimeters, lengthCol }) => {
    return [``, `${centerString(index, _.get(lengthCol, 'index'))}`, `${centerString(size, _.get(lengthCol, 'size'))}`, `${centerString(side, _.get(lengthCol, 'side'))}`, `${centerString(pixels, _.get(lengthCol, 'pixels'))}`, `${centerString(inches, _.get(lengthCol, 'inches'))}`, `${centerString(centimeters, _.get(lengthCol, 'centimeters'))}`, ``].join('|')
}

const formatUnit = unit => {
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
