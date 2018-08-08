var csv = require('csv');
var Wreck = require('wreck');
var Fs = require('fs');
var Promise = require('bluebird');

const key = '107zQ3ozkJuck4KQQnOXRGu4hQGpGVIClXgKNNCot7ds';
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
  const regex = new RegExp('<html.*<head.*</head>.*<body.*</body>.*</html>', 's');
  if (regex.test(payload.toString('utf8'))) {
    throw('ERROR: CSV content appears to be an HTML page.\n' + 
          'Please set document permissions to be  publically accessible via link without any username or password.');
  }
}

function processPage(key, gid, processFn) {
  const parseOptions = {
    relax_column_count: true,
    columns: (ary) => ary.map((value) => value.match(/^\d+$/) ? false : value),
  };

  // TODO: this isn't giving us a 304 return value
  const wreckOptions = {
    headers: { 'If-Modified-Since': 'Sun, 12 Feb 2018 01:16:45 GMT' },
  };
  return Promise.resolve(Wreck.get(getUri(key, gid), wreckOptions))
    .tap((response) => console.log('Response status:', response.res.statusCode))
    .then((response) => response.payload)
    .tap((payload) => checkForValidPayload(payload))
    .then((payload) => csvParse(payload, parseOptions))
    .then((data) => processFn(gid, data));
}

function dummyFn(gid, data) {
  // console.log(`data ${gid}:`, data);
  return Promise.resolve(gid);
}

function processCSV(gid, data) {
  const init = (obj, key, value) => obj[key] = obj[key] || value;

  data.forEach((row) => {
    const meta = {};
    // console.log('ROW:', row);
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
            item[index] = value;
          }
        }
        delete row[name];
      } else if (!value) {
        delete row[name];
      } else {
        row[name] = value;
      }
    });
    // console.log('ROW:', row);
  });
  return Promise.resolve(data);
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
