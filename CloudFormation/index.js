'use strict';

const wreck = require('@hapi/wreck');
const fs = require('fs');

const [endpoint, configFile] = process.argv.slice(2);

Promise.resolve(configFile)
  .then(file => endpoint ? file : Promise.reject('Must specify the configuration endpoint URL'))
  .then(file => file ? fs.readFileSync(configFile, { encoding: 'utf8' }) : Promise.reject('Must specify a JSON configuration file'))
  .then(contents => JSON.parse(contents))
  .then(payload => wreck.post(endpoint, { payload }))
  .then(response => console.log(response.payload.toString()))
  .catch(err => {
    console.error('Error:', err.message || err);
    process.exit(-1);
  });


