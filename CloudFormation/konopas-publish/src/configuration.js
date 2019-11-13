'use strict';

const AWS = require('aws-sdk');

const docClient = new AWS.DynamoDB.DocumentClient({ params: { TableName: process.env.TABLE_NAME } });

exports.lambdaHandler = async (event) => {
  const promise = Promise.resolve(event.body)
    .then(body => JSON.parse(body))
    .then(config => [`${config.github.reponame}/${config.repository.subdir}`, config])
    .then(([id, value]) => docClient.put({ Item: { id, value } }).promise())
    .then(() => 'Configuration written!');

  return promise
    .catch(err => `ERROR: ${err.message || err}`)
    .then(result => ({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      body: result,
    }));
};
