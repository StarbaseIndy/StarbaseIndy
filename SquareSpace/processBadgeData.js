'use strict;'

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const BILLINGNAME_KEY = 'Billing Name';
const UNIFYING_EMAIL = 'Product Form: Email';
const UNIFYING_EMAIL2 = 'Product Form: Responsible Adult\'s Email';
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

function zeroPad(num) {
  return ("0000" + num).slice(-4);
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
    item[UNIFYING_EMAIL] = item[UNIFYING_EMAIL] || item[UNIFYING_EMAIL2]; // combine different form names for same information
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
    .then(files => Promise.each(files.sort().map(readCSV), p => p));
}

function mixinMetadata() {
  // Mixin the metadata to get new badge names, taglines, and departments
  getAllCacheItems().map(item => {
    const metaItem = metadata.find(entry => entry.sortKey === item.sortKey) || {};  
    item[BADGENAME_KEY] = metaItem.BadgeName || item[BADGENAME_KEY] || '';
    item.department = metaItem.Department;
    item.tagline = metaItem.Tagline;
  });
}

function verifyMetadata() {
  // Do validation on the metadata
  const allKeys = getAllCacheItems().map(item => item.sortKey);
  metadata
    .filter(entry => !entry.Note) // skip validation for entries with notes
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .map(entry => {
      // verify that all sortKey values in the metadata actually exist
      if (entry.Name && !entry.sortKey) {
        console.error(`WARNING: Metadata missing sortKey for name: ${entry.Name}`);
      } else if (!allKeys.find(sortKey => sortKey === entry.sortKey)) {
        console.error(`WARNING: Metadata invalid sortKey: ${entry.sortKey}`);
      }
    });
}

function readMetadata(file) {
  if (!file) return;

  console.log(`Reading additional metadata from '${file}'`);
  return readFile(file, { encoding: 'utf8' })
    .then(content => JSON.parse(content))
    .then(content => metadata.push(...content))
    .then(verifyMetadata)
    .then(mixinMetadata);
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
    .then(generateBadgeNumbers)
    .tap(() => readMetadata(metadataFile));
}
  

function printBadgeCounts() {
  console.log('\nBadges sold (by type):');
  Object.keys(cache).sort().forEach(key => {
    console.log(`  ${key}: ${cache[key].length}`);
  });
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

// function generateVendorMailMerge(startingBadgeNum = 800) {
  // const columns = ['Order ID', 'Badge Number', 'Badge Name', 'Department', 'Tagline'];
  // const records = vendors
    // .map(item => {
      // const numBadges = parseInt(item[VENDORNUMBADGES_KEY], 10);
      // return [...Array(numBadges)].map(() => 
        // ['none', zeroPad(startingBadgeNum++), item[VENDORNAME_KEY], 'Vendor', '']);
    // })
    // .reduce((acc, badges) => (acc.push(...badges), acc), []);
  
  // if (!records.length) return;
  // return writeMailMergeFile('Mailmerge Vendor.tab', records, columns);
// };

function generateBadgeMailMerge(filename, group, sortFn = (a,b) => a.badgeNum - b.badgeNum) {
  const columns = ['Order ID', 'Badge Number', 'Badge Name', 'Department', 'Tagline'];
  const records = group
    .sort(sortFn)
    .map(item => {
      const { 
        [BADGENAME_KEY]: badgeName,
        department,
        tagline,
        badgeNum,
        sortKey } = item;
        
      if (!badgeName) {
        console.error(`WARNING: Order ${sortKey} has no badge name! Update the metadata.json file.`);
      }
  
      if (badgeName.match(/[^ -~]+/g)) {
        // Read more e.g. at: https://www.compart.com/en/unicode/U+30C4
        const unicode = badgeName
          .split('')
          .map(x => x.codePointAt(0))
          .filter(x => x > 0x7f)
          .map(x => `U+${x.toString(16).toUpperCase()}`);
          
        console.error(`WARNING: Non-printable name for badge #${badgeNum} (order ${sortKey}): ${badgeName}`);
        console.error('         Unicode characters:', unicode);
      }
       
      return [sortKey, zeroPad(badgeNum), badgeName, department, tagline];
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
      return [orderId, zeroPad(badgeNum), adultName, adultPhone.trim(), adultEmail];
    });
  
  if (!records.length) return;
  return writeMailMergeFile(`Mailmerge ${filename} BACK.tab`, records, columns);
}

function generateEnvelopeMailMerge(filename, group) {
  // Front of Packets:

  // DPM TODO: Billing name won't help anyone if the badge was purchased as a gift.
  // The top information (name, email) needs to uniquely identify who can pick up the packet.
  // This may make more sense as [ADULTNAME_KEY]||[REALNAME_KEY], and include only one badge per packet.
  //   We could then allow someone to pick up all packets with the same unifying email (assuming they know the names on the other envelopes).

  // Billing name: <Last Name>, <First Name>  
  // UNIFYING FORM Email: <.com>

  // Badge 1: <Type> <Badge Name>
  // Badge 2: <Type> <Badge Name>
  // Etc…

  // Fan Experiences: 
  // DWTS
  // PhotoOp

  // DPM TODO: It's unclear how many of each ribbon to put in each packet, because discount codes are tied to orders, and not to badges.
  // Ribbons needed will be ascertained by the presence of the following discount codes:
  // SBI_GURU, STARBASECREW, PRESS, BBBS, BBBS12

  // Work with full data set
  // Reorganize data set to be keyed on [BILLINGNAME_KEY], then by [UNIFYING_EMAIL]
  //   Top two lines:
  //     [BILLINGNAME_KEY].split(' ').reverse()  (Note: warn if more than one billing name is ever found)
  //     [UNIFYING_EMAIL]
  //   For every purchased item, print out a line: (Note: one column of the mailmerge)
  //     [LINEITEM_KEY]: [BADGENAME_KEY]
  //   TODO: Need to get photo ops and DWTS into the store to see what those transactions look like.
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
        acc.Badges = [acc.Badges, `${badgeType}: ${badgeName}`].filter(Boolean).join('\n');
        acc.Ribbons = [acc.Ribbons, getRibbonName(discountCode)].filter(Boolean).join('\n');
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

function getVendorGroup(startingBadgeNum = 800) {
  return vendors
    .map(item => {
      const numBadges = parseInt(item[VENDORNUMBADGES_KEY], 10);
      return [...Array(numBadges)].map(() => 
       ({
         sortKey: 'none',
         badgeNum: startingBadgeNum++,
         [BADGENAME_KEY]: item[VENDORNAME_KEY],
         department: 'Vendor', 
         tagline: '',
       }));
    })
    .reduce((acc, badges) => (acc.push(...badges), acc), []);
}

function generateMailMergeFiles() {
  console.log(''); // output a newline

  // Export Saturday|Sunday|Weekend|Star|Student (not Children|Shopping)
  const generalBadgesPromise = generateBadgeMailMerge('General Admission',
    getAllCacheItems()
      .filter(item => !item[LINEITEM_KEY].match(/Children|Shopping/))
      .filter(item => !item.department && !item.tagline)
      .map(item => {
        const extra = {};
        if (item[LINEITEM_KEY].match(/Saturday/)) {
          extra.department = 'Sat + Sun';
        }
        if (item[LINEITEM_KEY].match(/Sunday/)) {
          extra.department = 'Sunday Only';
        }
        return Object.assign({}, item, extra);
      }));

  // Export staff badges
  const staffSortFn = (a,b) => (a.department || '').localeCompare(b.department);
  const staffBadgesPromise = generateBadgeMailMerge('Adorned',
    getAllCacheItems()
      .filter(item => !item[LINEITEM_KEY].match(/Children|Shopping/))
      .filter(item => item.department || item.tagline)
      .concat(getVendorGroup()),
    staffSortFn);
  
  // Export child badges (front AND back)
  const childPromises = Object.keys(cache)
    .filter(key => key.match(/Children/))
    .map(key => 
      generateChildBadgeMailMerge(key, cache[key])
        .then(() => generateBadgeMailMerge(key, cache[key])));

  promises = [
    generalBadgesPromise,
    staffBadgesPromise,
    ...childPromises,
    // generateVendorMailMerge(),
    generateEnvelopeMailMerge(),
  ];

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
        .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
        .filter(item => item[REALNAME_KEY].match(new RegExp(name, 'i')))
        .map(item => console.log(`${item.sortKey}: ${item[REALNAME_KEY]}: ${item.badgeNum}: ${item[BADGENAME_KEY]}: ${item[UNIFYING_EMAIL]}`)));

    return;
  }

  processInputData(folder, metadataFile)
    .then(numBadges => console.log('\nTotal badges sold:', numBadges))
    .then(printBadgeCounts)
    .then(() => console.log(`\nVendor count: ${vendors.length}`))
    .then(printDiscountCodeCounts)
    .then(generateMailMergeFiles)
    .then(() => console.log('\nDone!'))
    .catch((err) => console.log('Error!', err));
}

// Do the work
main();
