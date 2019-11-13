'use strict';

const AWS = require('aws-sdk');
const { updateKonopasFiles } = require('./konopas-git');

const docClient = new AWS.DynamoDB.DocumentClient({ params: { TableName: process.env.TABLE_NAME } });

exports.lambdaHandler = async (event) => {
  // pull the configuration for the convention & year provided in the query parameters
  event.queryStringParameters = event.queryStringParameters || {};
  const { convention, year } = event.queryStringParameters;
  const id = `${convention}/${year}`;

  const promise = Promise.resolve()
    .then(() => convention && year ? '' : Promise.reject('You must specify query params "convention" and "year"'))
    .then(() => docClient.get({ Key: { id } })
      .promise()
      .then(result => result.Item.value)
      .catch(() => Promise.reject(`Could not find configuration for ${id}. Email dpmott@gmail.com for help!`))
    )    
    .then(config => updateKonopasFiles(config))
    .then(() => 'KnoOpas metadata files have been written to your github repository.');

  return promise
    .catch(err => `ERROR: ${err.message || err}`)
    .then(result => ({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      body: result,
    }));
};
