'use strict;'

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const LINEITEM_KEY = 'Lineitem name';
const csvParse = Promise.promisify(csv.parse);
const readDir = Promise.promisify(Fs.readdir);
const readFile = Promise.promisify(Fs.readFile);
const cache = {};

function readCSV(filename) {
  const defaultItem = { [LINEITEM_KEY]: filename };
  
  return readFile(filename)
    .then(content => csvParse(content, { columns: true })) // relax_column_count
    .then(group => cache[(group[0] || defaultItem)[LINEITEM_KEY]] = group);
}

function generateBadgeNumbers() {
  let badgeNum = 1;
  // Assume that all of the entries are sorted by order # already, as they are in the CSV
  [].concat(...Object.values(cache))
    .sort((a,b) => a['Order ID'] - b['Order ID'])
    .map(item => item.badgeNum = badgeNum++);

  // console.log('Badge numbers:', Object.values(cache).map(group => group.map(item => item.badgeNum)));
  console.log('Total badges sold:', badgeNum);
}

function printCounts() {
  Object.keys(cache).sort().forEach(key => {
    console.log(`${key}: ${cache[key].length}`);
  });
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
.then(generateBadgeNumbers)
// TODO: organize packet report based on the FORM email address
// TODO: generate mail merge input file 
.then(printCounts)
.then(() => console.log('Done!'))
.catch((err) => console.log('Error!', err));


