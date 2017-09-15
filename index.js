const aws = require('aws-sdk');
const Promise = require('bluebird');
const { generate } = require('./invoice');

const s3 = new aws.S3({ region: 'us-east-1' });
const getObject = Promise.promisify(s3.getObject, { context: s3 });
const bucket = process.env.AWS_INVOICE_BUCKET || 'scottbouloutian-dev';

// Download the configuration from s3
function downloadConfig() {
    return getObject({
        Bucket: bucket,
        Key: 'aws-invoice/config.json',
    }).then(body => JSON.parse(body.Body));
}

downloadConfig()
    .then(config => Promise.map(config.invoices, invoice => generate(invoice, config)))
