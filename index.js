const s3 = require('s3');
const csvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const mustache = require('mustache');
const pdf = require('html-pdf');
const ld = require('lodash');

const client = s3.createClient();

const listObjects = (bucket) => {
    const lister = client.listObjects({
        s3Params: {
            Bucket: bucket,
        },
    });
    let objects = [];
    lister.on('data', (data) => {
        objects = objects.concat(data.Contents);
    });
    return new Promise((resolve, reject) => {
        lister.on('error', error => reject(error));
        lister.on('end', () => resolve(objects));
    });
};

const downloadFile = (bucket, file) => {
    const downloader = client.downloadFile({
        localFile: 'data.csv',
        s3Params: {
            Bucket: bucket,
            Key: file,
        },
    });
    return new Promise((resolve, reject) => {
        downloader.on('error', error => reject(error));
        downloader.on('end', () => resolve());
    });
};

const generatePDF = (html) => {
    const options = { format: 'Letter' };
    return new Promise((resolve, reject) => (
        pdf.create(html, options).toFile('invoice.pdf', error =>
            (error ? reject(error) : resolve()))
    ));
};

const generate = (options) => {
    const { bucket, year, month, sender, recipient, title, resources } = options;
    return listObjects(bucket).then((objects) => {
        const file = objects
            .map(object => object.Key)
            .find((key) => {
                const match = key.match(/\d+-aws-cost-allocation-(\d{4})-(\d{2})\.csv/);
                const paddedMonth = month.length === 1 ? `0${month}` : month;
                return match && match[1] === year && match[2] === paddedMonth;
            });
        return downloadFile(bucket, file);
    }).then(() => {
        const file = fs.readFileSync('data.csv', 'utf-8');
        fs.unlinkSync('data.csv');
        const fileData = file.substring(file.indexOf('\n') + 1);
        const parsed = csvParse(fileData, { auto_parse: true });
        const columns = parsed[0];
        const columnLabels = [
            'ProductName',
            'ItemDescription',
            'UsageType',
            'UsageQuantity',
            'TotalCost',
        ];
        const columnIndices = columns.reduce((acc, val, index) => {
            acc[val] = index;
            return acc;
        }, { });
        const data = parsed.slice(1)
            .filter(row => (
                resources.some(resource => (
                    ld.every(resource, (value, key) => (
                        (row[columnIndices[key]] === value)
                    ))
                ))
            ))
            .map(row => columnLabels.map(label => row[columnIndices[label]]));
        const invoiceTemplate = fs.readFileSync('invoice.html', 'utf-8');
        const total = data
            .map(row => row[row.length - 1])
            .reduce((cost, nextCost) => cost + nextCost);
        const html = mustache.render(invoiceTemplate, {
            sender,
            recipient,
            data,
            title,
            date: new Date().toDateString(),
            labels: ['Product', 'Description', 'Type', 'Quantity', 'Cost'],
            total: Math.ceil(total * 100) / 100,
        });
        return generatePDF(html);
    });
};

module.exports = { generate };
