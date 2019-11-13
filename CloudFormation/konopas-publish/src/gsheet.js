'use strict';

const csv = require('csv');
const Wreck = require('@hapi/wreck');
const { promisify } = require('util');

async function processPage(key, gid) {
  const parseOptions = {
    relax_column_count: true,
    columns: (ary) => ary.map((value) => value.match(/^\d+$/) ? false : value),
  };

  const response = await Wreck.get(`https://docs.google.com/spreadsheets/d/${key}/export?format=csv&gid=${gid}`);
  console.log('Response status:', response.res.statusCode);
  const payload = response.payload;

  const regex = new RegExp('<html.*<head.*</head>.*<body.*</body>.*</html>', 'si');
  if (regex.test(payload.toString('utf8'))) {
    throw('ERROR: CSV content appears to be an HTML page.\n' + 
          'Please set document permissions to be publicly accessible via link without any username or password.');
  }

  const csvParse = promisify(csv.parse);
  return csvParse(payload, parseOptions);
}

function processCSV(data) {
  const init = (obj, key, value) => obj[key] = obj[key] || value;

  data.forEach((row) => {
    const meta = {};
    Object.entries(row).forEach(([name, value]) => {
      value = value.trim();
      if (name.includes('.')) {
        const nameSegments = name.match(/^([^.]+)\.([^.]+)(\.([^.]+))?$/);
        if (value && nameSegments) {
          const [_skip, column, index, _wrap, field] = nameSegments;
          const isIndexed = index.match(/^\d+$/);
          const item = init(row, column, isIndexed ? [] : {});
          
          if (nameSegments.length >= 5 && field) {
            // Calculate the next index, to keep arrays sequential.
            // This allows the spreadsheet to be more user-friendly by allowing gaps.
            meta[column] = meta[column] || {};
            meta[column][index] = meta[column][index] || `${item.length}`; // Note: '0' is truthy
            init(item, +meta[column][index], {})[field] = value;
          } else {
            isIndexed ? item.push(value) : item[index] = value;
          }
        }
        delete row[name];
      } else if (!value) {
        delete row[name];
      } else {
        row[name] = value;
      }
    });
  });
  return data.filter(row => Object.keys(row).includes('id'));
}

async function processGoogleSheets(config) {
  // NOTE: config.forEach(async (item) => {}) this would not make the parent function wait for all async iterations to complete
  for (const item of config.filter(item => item.key)) {
    const csvData = await processPage(item.key, item.gid);
    const data = processCSV(csvData);
    const replacerFn = (_key, val) => val == null ? '' : val;
    item.content = `var ${item.jsvar} = ${JSON.stringify(data, replacerFn)};`;
  }
}

module.exports = {
  processGoogleSheets,
}
