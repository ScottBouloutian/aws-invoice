const s3Lib = require('s3');
const csvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const mustache = require('mustache');
const pdf = require('wkhtmltopdf');
const ld = require('lodash');
const aws = require('aws-sdk');
const MailComposer = require('nodemailer/lib/mail-composer');
const Promise = require('bluebird');
const path = require('path');
const moment = require('moment');

const client = s3Lib.createClient();
const ses = new aws.SES({ region: 'us-east-1' });
const sendRawEmail = Promise.promisify(ses.sendRawEmail, { context: ses });

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

const downloadFile = (bucket, file, filePath) => {
    const downloader = client.downloadFile({
        localFile: filePath,
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

const generate = (options, config) => {
    const { bucket, sender, recipient, title, resources } = options;
    const date = moment().subtract(1, 'month');
    const year = date.year().toString();
    const month = (date.month() + 1).toString();
    const id = ld.uniqueId();
    return listObjects(bucket)
        .then((objects) => {
            console.log('Listed billing bucket');
            const file = objects
                .map(object => object.Key)
                .find((key) => {
                    const match = key.match(/\d+-aws-cost-allocation-(\d{4})-(\d{2})\.csv/);
                    const paddedMonth = month.length === 1 ? `0${month}` : month;
                    return match && match[1] === year && match[2] === paddedMonth;
                });
            if (!file) {
                throw new Error(`Billing info not found for month ${month} and year ${year}`);
            }
            return downloadFile(bucket, file, `/tmp/data${id}.csv`);
        })
        .then(() => {
            console.log('Downloaded billing information');
            const file = fs.readFileSync(`/tmp/data${id}.csv`, 'utf-8');
            fs.unlinkSync(`/tmp/data${id}.csv`);
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
                            new RegExp(value).test(row[columnIndices[key]])
                        ))
                    ))
                ))
                .filter(row => (
                    !options.excludes.some(exclude => (
                        ld.every(exclude, (value, key) => (
                            new RegExp(value).test(row[columnIndices[key]])
                        ))
                    ))
                ))
                .map(row => columnLabels.map(label => row[columnIndices[label]]));
            const templatePath = path.resolve(__dirname, 'invoice.html');
            const invoiceTemplate = fs.readFileSync(templatePath, 'utf-8');
            const total = data
                .map(row => row[row.length - 1])
                .reduce((cost, nextCost) => cost + nextCost, 0);
            const html = mustache.render(invoiceTemplate, {
                sender,
                recipient,
                data,
                title,
                date: new Date().toDateString(),
                labels: ['Product', 'Description', 'Type', 'Quantity', 'Cost'],
                total: Math.ceil(total * 100) / 100,
            });
            const mailOptions = {
                from: config.notification.from,
                to: config.notification.email,
                subject: title,
                text: 'This invoice was auto-generated by aws-invoice. See attached:',
                attachments: [
                    {
                        filename: 'invoice.pdf',
                        content: pdf(html, { pageSize: 'letter' }),
                    },
                ],
            };
            const mail = new MailComposer(mailOptions).compile();
            const build = Promise.promisify(mail.build, { context: mail });
            return build();
        })
        .then(message => (
            sendRawEmail({
                RawMessage: {
                    Data: message,
                },
                Destinations: [
                    config.notification.email,
                ],
                FromArn: config.notification.arn,
            })
        ));
};

module.exports = { generate };
