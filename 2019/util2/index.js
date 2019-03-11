'use strict;'

const csv = require('csv');
const Wreck = require('wreck');
const Fs = require('fs');
const Promise = require('bluebird');

const key = '1Qe_AiFvB7wAiCXkb2jhXAN6kA8tBbY0_FTpJz2rXXhs';
const config = [
  {
    key,
    gid: 0,
    path: '../data',
    name: 'program',
  },
  {
    key,
    gid: 958660582,
    path: '../data',
    name: 'people',
  }
];

// ====================================================================
// No need to touch anything below this line
// ====================================================================

// TODO: Use Google APIs to read the spreadsheet directly, and not download/parse the CSV

const fsWriteFile = Promise.promisify(Fs.writeFile);
const csvParse = Promise.promisify(csv.parse);

function getUri(key, gid) {
  return `https://docs.google.com/spreadsheets/d/${key}/export?format=csv&gid=${gid}`;
};

function checkForValidPayload(payload) {
  const regex = new RegExp('<html.*<head.*</head>.*<body.*</body>.*</html>', 'si');
  if (regex.test(payload.toString('utf8'))) {
    throw('ERROR: CSV content appears to be an HTML page.\n' + 
          'Please set document permissions to be publicly accessible via link without any username or password.');
  }
}

function processPage(key, gid, processFn) {
  const parseOptions = {
    relax_column_count: true,
    columns: (ary) => ary.map((value) => value.match(/^\d+$/) ? false : value),
  };

  return Promise.resolve(Wreck.get(getUri(key, gid)))
    .tap((response) => console.log('Response status:', response.res.statusCode))
    .then((response) => response.payload)
    .tap((payload) => checkForValidPayload(payload))
    .then((payload) => csvParse(payload, parseOptions))
    .then((data) => processFn(data));
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
  return Promise.resolve(data.filter(row => Object.keys(row).includes('id')));
}

function processSheet(config) {
  const promises = [];
  const replacerFn = (key, val) => val == null ? '' : val;
  config.forEach((item) => {
    const promise = processPage(item.key, item.gid, processCSV)
      .then((data) => fsWriteFile(
        `${item.path}/${item.name}.js`, `var ${item.name} = ${JSON.stringify(data, replacerFn)};`));
    promises.push(promise);
  });

  return Promise.all(promises);
}

function updateAppCache(filename) {
  const content = Fs.readFileSync(filename, 'utf8');
  const now = (new Date()).toISOString().slice(0,19).replace('T', ' ');
  const output = content.replace(/[\n\r]+#.*/, `\n# ${now}`);
  Fs.writeFileSync(filename, output);
}

// do the work
processSheet(config)
  .then(() => updateAppCache('../konopas.appcache'))
  .then(() => { console.log('Done!'); })
  .catch((err) => { console.log('Error:', err); });
