'use strict;'

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const LINEITEM_KEY = 'Lineitem name';
const csvParse = Promise.promisify(csv.parse);
const readDir = Promise.promisify(Fs.readdir);
const readFile = Promise.promisify(Fs.readFile);
const cache = {};

function printCounts() {
  Object.keys(cache).sort().forEach(key => {
    console.log(`${key}: ${cache[key].length}`);
  });
}

function readCSV(filename) {
  return readFile(filename)
  .then(content => csvParse(content, { columns: true })) // relax_column_count
  .then(data => data.map(item => {
    // Organize all data based on the 'Lineitem name' key
    cache[item[LINEITEM_KEY]] = cache[item[LINEITEM_KEY]] || [];
    cache[item[LINEITEM_KEY]].push(item);
  }));
}

if (process.argv.length < 3) {
  console.error('You must specify a folder path, where the CSV files can be found.');
  process.exit(-1);
}


const folder = process.argv[2];
console.log(`Reading CSV files from '${folder}'`);

readDir(folder)
.then(files => files.filter(file => file.match(/\.csv$/)))
.then(files => files.map(file => `${folder}/${file}`))
.then(files => Promise.all(files.map(readCSV)))
.then(printCounts)
.then(() => console.log('Done!'))
.catch((err) => console.log('Error!', err));


