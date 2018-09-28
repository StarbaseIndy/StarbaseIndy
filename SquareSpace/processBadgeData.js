'use strict;'

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const BILLINGNAME_KEY = 'Billing Name';
const UNIFYING_EMAIL = 'Product Form: Email';
const LINEITEM_KEY = 'Lineitem name';
const REALNAME_KEY = 'Product Form: Real Name';
const BADGENAME_KEY = 'Product Form: Badge Name';
const DISCOUNTCODE_KEY = 'Discount Code';
const ADULTNAME_KEY = 'Product Form: Responsible Adult\'s Name';
const ADULTPHONE_KEY = 'Product Form: Responsible Adult\'s Phone Number';
const ADULTEMAIL_KEY = 'Product Form: Responsible Adult\'s Email';

const VENDORNAME_KEY = 'Business Name';
const VENDORNUMBADGES_KEY = '#Badges';

const ORDERID_KEY = 'Order ID';
const csvParse = Promise.promisify(csv.parse);
const csvStringify = Promise.promisify(csv.stringify);
const readDir = Promise.promisify(Fs.readdir);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);
const cache = {};
const summary = [];
const vendors = [];
const metadata = [];

// The unique ID generator needs to give us a unique sequence number for every order number
const uniqueIds = {};
function getSortKey(orderId) {
  uniqueIds[orderId] = uniqueIds[orderId] + 1 || 1;
  return `${orderId}#${uniqueIds[orderId]}`
}

function getRibbonName(discountCode) {
  const lookup = {
    SBI_GURU: 'Presenter',
    STARBASECREW: 'Volunteer',
    PRESS: 'Press',
    BBBS: 'Big Brothers/Sisters', 
    BBBS12: 'Big Brothers/Sisters', 
  };
  return lookup[discountCode];
}

function getAllCacheItems() {
  return [].concat(...Object.values(cache));
}

function processCSV(filename, group = [{}]) {
  // console.log('Processing CSV file', filename);
  const onlyUnique = (value, index, array) => array.indexOf(value) === index;
  const lineItems = group.map(item => item[LINEITEM_KEY]).filter(onlyUnique);

  // Look for the vendor CSV file.  It's a different format.
  if ((group[0] || {})[VENDORNAME_KEY]) {
    vendors.push(...group.filter(item => item[VENDORNAME_KEY] && item[VENDORNAME_KEY] !== 'Total'));
    return;
  }

  // Look for the summary CSV file.  It has multiple line items.
  if (lineItems.length > 1) {
    summary.push(...group);
    return;
  }

  // Update the cache
  group.map(item => {
    const orderId = parseInt(item[ORDERID_KEY], 10);
    item[ORDERID_KEY] = orderId; // make order ID numeric
    item.sortKey = getSortKey(orderId);
  });
  cache[lineItems[0] || filename] = group;
}

function readCSV(filename) {
  return readFile(filename, { encoding: 'utf8' })
    .then(content => csvParse(content, { columns: true }))
    .then(group => processCSV(filename, group))
    .catch(err => console.log('Error reading CSV file:', err));
}

function readSpreadsheets(folder) {
  console.log(`Reading CSV files from '${folder}'`);
  return readDir(folder)
    .then(files => files.filter(file => file.match(/\.csv$/)))
    .then(files => files.map(file => `${folder}/${file}`))
    .then(files => Promise.each(files.map(readCSV), p => p));
}

function readMetadata(file) {
  if (!file) return;

  console.log(`Reading additional metadata from '${file}'`);
  return readFile(file, { encoding: 'utf8' })
    .then(content => JSON.parse(content))
    .then(content => metadata.push(...content))
    .then(() => {
      // Do validation on the metadata
      const allKeys = getAllCacheItems().map(item => item.sortKey);
      metadata
        .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
        .map(entry => {
          // verify that all sortKey values in the metadata actually exist
          if (entry.Name && !entry.sortKey) {
            console.error(`WARNING: No sortKey specified for metadata name: ${entry.Name}`);
          } else if (!metadata.find(entry => allKeys.find(sortKey => sortKey === entry.sortKey))) {
            console.error(`WARNING: metadata invalid sortKey: ${entry.sortKey}`);
          }
        });
    });
}

function generateBadgeNumbers() {
  let badgeNum = 1;
  getAllCacheItems()
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .map(item => item.badgeNum = badgeNum++);
  return badgeNum;
}

function processInputData(folder, metadataFile) {
  return readSpreadsheets(folder)
    .then(() => readMetadata(metadataFile))
    .then(generateBadgeNumbers);
}
  

function printBadgeCounts() {
  console.log('\nBadges sold (by type):');
  Object.keys(cache).sort().forEach(key => {
    console.log(`  ${key}: ${cache[key].length}`);
  });

  console.log(`  Vendors: ${vendors.length}`);

}

function printDiscountCodeCounts() {
  // TODO: This code assumes that there is only one discount code in the DISCOUNTCODE_KEY field.
  // If discount codes can stack, then this code will report stacked discount codes as their own category.
  const codeUsages = getAllCacheItems().map(item => ({ [item[ORDERID_KEY]]: item[DISCOUNTCODE_KEY] }));
  const deDuplicatedCodes = Object.assign({}, ...codeUsages);
  const discountCodes = Object.values(deDuplicatedCodes)
    .filter(Boolean)
    .reduce((acc, val) => (acc[val] = acc[val] + 1 || 1, acc), {});

  console.log('\nDiscount codes used:');
  Object.keys(discountCodes).sort().forEach(key => {
    console.log(`  ${key}: ${discountCodes[key]}`);
  });
}

function writeMailMergeFile(filename, records, columns) {
  const options = {
    columns,
    header: true,
    quotedString: true,
    delimiter: '\t',
  };
  
  return csvStringify(records, options)
   .then(data => writeFile(filename, '\uFEFF' + data, { encoding: 'utf16le' }));
}

function generateVendorMailMerge(startingBadgeNum = 800) {
  const columns = ['Order ID', 'Badge Number', 'Company Name', 'Title'];
  const records = vendors
    .map(item => {
      const numBadges = parseInt(item[VENDORNUMBADGES_KEY], 10);
      return [...Array(numBadges)].map(() => 
        ['none', startingBadgeNum++, item[VENDORNAME_KEY], 'Vendor']);
    })
    .reduce((acc, badges) => (acc.push(...badges), acc), []);
  
  if (!records.length) return;
  return writeMailMergeFile('Mailmerge Vendor.tab', records, columns);
};

function generateBadgeMailMerge(filename, group) {
  const columns = ['Order ID', 'Badge Number', 'Badge Name', 'Department', 'Tagline'];
  const records = group
    .sort((a,b) => a.badgeNum - b.badgeNum)
    .map(item => {
      const { [ORDERID_KEY]: orderId, [BADGENAME_KEY]: badgeName, [REALNAME_KEY]: realName, badgeNum, sortKey } = item;
      const metaItem = metadata.find(entry => entry.sortKey === sortKey) || {};
      const newBadgeName =
        metaItem.BadgeName ||
        badgeName ||
        (console.error(`WARNING: Order ${sortKey} has no badge name! Update the metadata.json file.`), '');
		
      if (newBadgeName.match(/[^ -~]+/g)) {
        console.error(`WARNING: Non-printable name for badge #${badgeNum} (order ${sortKey}): ${newBadgeName}`);
      }
      
  
      return [sortKey, badgeNum, newBadgeName, metaItem.Department || '', metaItem.Tagline || ''];
    });

  if (!records.length) return;
  return writeMailMergeFile(`Mailmerge ${filename}.tab`, records, columns);
}

function generateChildBadgeMailMerge(filename, group) {
  const columns = ['Order ID', 'Badge Number', 'Adult Name', 'Adult Phone', 'Adult Email'];
  const records = group
    .sort((a,b) => a.badgeNum - b.badgeNum)
    .map(item => {
      const { 
        badgeNum,
        [ORDERID_KEY]: orderId,
        [ADULTNAME_KEY]: adultName,
        [ADULTPHONE_KEY]: adultPhone,
        [ADULTEMAIL_KEY]: adultEmail
      } = item;
      return [orderId, badgeNum, adultName, adultPhone.trim(), adultEmail];
    });
  
  if (!records.length) return;
  return writeMailMergeFile(`Mailmerge ${filename} BACK.tab`, records, columns);
}

function generateEnvelopeMailMerge(filename, group) {
  // Front of Packets:

  // Billing name: <Last Name>, <First Name>
  // UNIFYING FORM Email: <.com>

  // Badge 1: <Type> <Badge Name>
  // Badge 2: <Type> <Badge Name>
  // Etc…

  // Fan Experiences: 
  // DWTS
  // PhotoOp

  // Ribbons needed will be ascertained by the presence of the following discount codes:
  // SBI_GURU: Presenter
  // STARBASECREW: Corestaff
  // PRESS: Press
  // BBBS, BBBS12: Big Brothers / Big Sisters

  // Work with full data set
  // Reorganize data set to be keyed on [BILLINGNAME_KEY], then by [UNIFYING_EMAIL]
  //   Top two lines:
  //     [BILLINGNAME_KEY].split(' ').reverse()  (Note: warn if more than one billing name is ever found)
  //     [UNIFYING_EMAIL]
  //   For every purchased item, print out a line: (Note: one column of the mailmerge)
  //     [LINEITEM_KEY]: [BADGENAME_KEY]
  //   TODO: Need to get photo ops and DWTS into the store to see what those transations look like.
  //   For each ['Discount Code'], print the associated ribbon type (Note: one column of the mailmerge)
  //     TODO: can discount codes stack?  If so, what does that look like?
  
  let lastBillingName = '';
  const envelopes = getAllCacheItems()
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .reduce((acc, item) => {
      const billing = item[BILLINGNAME_KEY].split(' ').reverse().join(' ') || lastBillingName; // last name first
      lastBillingName = billing;
      const email = item[UNIFYING_EMAIL];
      acc[billing] = acc[billing] || {};
      acc[billing][email] = acc[billing][email] || [];
      acc[billing][email].push(item);
      return acc;
    }, {});
    
  // Now that we have the envelopes organized by billing => email, generate the mailmerge data
  const records = Object.keys(envelopes).map(billing => 
    Object.keys(envelopes[billing]).map(email => 
      Object.values(envelopes[billing][email]).reduce((acc, item) => {
        const { [LINEITEM_KEY]: badgeType, [BADGENAME_KEY]: badgeName, [DISCOUNTCODE_KEY]: discountCode} = item;
        // TODO: we will need to distinguish between badges and tickets.
        
        acc.BillingName = acc.BillingName || billing;
        acc.Email = acc.Email || email;
        acc.Badges = [acc.Badges || '', `${badgeType}: ${badgeName}`].filter(Boolean).join('\n');
        acc.Ribbons = [acc.Ribbons || '', getRibbonName(discountCode)].filter(Boolean).join('\n');
        return acc;
      }, {})));

  const flattenedRecords = [].concat(...records);
  // console.log('Records:', flattenedRecords);
  
  // TODO: may need to store ribbons as an array, so we can reduce them to a count.
  const options = {
    header: true,
    quotedString: true,
    delimiter: '\t',
  };
  
  return csvStringify(flattenedRecords, options)
   .then(data => writeFile('Mailmerge Envelope.tab', '\uFEFF' + data, { encoding: 'utf16le' }));
}

function generateMailMergeFiles() {
  // Export mail merge for all badge types
  const promises = Object.keys(cache).map(key => generateBadgeMailMerge(key, cache[key]));
  
  // Export the mail merge for the BACK of the children's badge too!
  const childPromises = Object.keys(cache)
    .filter(key => key.match(/Children/))
    .map(key => generateChildBadgeMailMerge(key, cache[key]));

  promises.push(
    ...childPromises,
    generateVendorMailMerge(),
    generateEnvelopeMailMerge(),
  );

  return Promise.each(promises, p => p)
    .then(() => console.log(`\nWrote mailmerge files to ${process.cwd()}.  You're welcome.`));
}

function main() {
  if (process.argv.length < 3) {
    console.error('You must specify a folder path, where the input CSV files can be found.');
    process.exit(-1);
  }

  const [folder, metadataFile] = process.argv.slice(2);

  const lookup = process.argv.indexOf('-l')
  if (lookup !== -1) {
    const name = process.argv[lookup + 1];
    
    processInputData(folder, metadataFile).then(() =>
      getAllCacheItems()
        .filter(item => item[REALNAME_KEY].match(new RegExp(name, 'i')))
        .map(item => console.log(`${item.sortKey}: ${item[REALNAME_KEY]}`)));

    return;
  }

  processInputData(folder, metadataFile)
    .then((numBadges) => console.log('\nTotal badges sold:', numBadges))
    .then(printBadgeCounts)
    .then(printDiscountCodeCounts)
    .then(generateMailMergeFiles)
    .then(() => console.log('\nDone!'))
    .catch((err) => console.log('Error!', err));
}

// Do the work
main();
