const aws = require('aws-sdk');
const Promise = require('bluebird');
const { exec } = require('child_process');
const { generate } = require('./lib/invoice');

// Constant declarations
const s3 = new aws.S3({ region: 'us-east-1' });
const getObject = Promise.promisify(s3.getObject, { context: s3 });
const bucket = process.env.AWS_INVOICE_BUCKET;
const execPromise = Promise.promisify(exec);
const binPath = `${process.env.LAMBDA_TASK_ROOT}/bin`;
process.env.PATH = `${process.env.PATH}:/tmp/bin`;

// Download the configuration from s3
function downloadConfig() {
    return getObject({
        Bucket: bucket,
        Key: 'aws-invoice/config.json',
    }).then(body => JSON.parse(body.Body));
}

// Lambda interface
exports.handler = (event, context, callback) => {
    execPromise(`cp -r ${binPath} /tmp`)
        .then(() => execPromise('chmod 755 /tmp/bin/wkhtmltopdf'))
        .then(() => downloadConfig())
        .then(config => Promise.map(config.invoices, invoice => generate(invoice, config)))
        .then(() => callback(null, 'Done'))
        .catch(error => callback(error));
};
