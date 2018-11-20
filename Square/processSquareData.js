'use strict;'

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

// common key for item and transaction CSV files
// 'Customer ID',
// 'Customer Name',
// 'Customer Reference ID',
// 'Date',
// 'Details',
// 'Device Name',
// 'Dining Option',
// 'Discounts',
// 'Event Type',
// 'Gross Sales',
// 'Location',
// 'Net Sales',
// 'Payment ID',
// 'Tax',
// 'Time',
// 'Time Zone',
// 'Transaction ID'
const TRANSACTION_ID = 'Transaction ID';
const DATE = 'Date';
const TIME = 'Time';
const DEVICE_NAME = 'Device Name';
const GROSS_SALES = 'Gross Sales';
const DISCOUNTS = 'Discounts';
const NET_SALES = 'Net Sales';
const EVENT_TYPE = 'Event Type'; // 'Payment' or 'Refund'

// from transaction CSV
const CARD_ENTRY_METHOD = 'Card Entry Methods'; // 'N/A', 'Keyed', or 'Swiped'
const DESCRIPTION = 'Description'; // text description of items sold.  X-ref item CSV to get individual records
const DEVICE_NICKNAME = 'Device Nickname';
const FEES = 'Fees';
const FEE_PERCENTAGE = 'Fee Percentage Rate';
const FEE_FIXED = 'Fee Fixed Rate';
const LOCATION = 'Location';
const NET_TOTAL = 'Net Total'; // This can be negative
const TOTAL_COLLECTED = 'Total Collected'; // This can be negative
const CASH = 'Cash'; // Amount of cash in the transaction
const CARD = 'Card'; // Amount charged to credit card
const OTHER_TENDER = 'Other Tender';

// from item CSV
const ITEM = 'Item'; // Item description
const CATEGORY = 'Category';
const QUANTITY = 'Qty';
const SKU = 'SKU';
const MODIFIERS = 'Modifiers Applied';

const csvParse = Promise.promisify(csv.parse);
const csvStringify = Promise.promisify(csv.stringify);
const readDir = Promise.promisify(Fs.readdir);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);

const transactions = {};

function getTransactions() {
  return Object.values(transactions);
}

function formatCurrency(value) {
  return value.toFixed(2).toString().padStart(8, ' ');
}

function processCSV(filename, group ) {
  if (!group || !group.length) {
    console.log('Notice: Skipping empty file:', filename);
    return;
  }

  if (group[0][ITEM]) {
    // process detailed item CSV
    console.log('Reading detailed items from:', filename);
    group.forEach(item => {
      const id = item[TRANSACTION_ID];
      transactions[id] = transactions[id] || { items: [] };
      transactions[id].items.push(item);
    });
  }

  if (group[0][DESCRIPTION]) {
    // process transaction CSV
    console.log('Reading transactions from:  ', filename);
    group.forEach(item => {
      const id = item[TRANSACTION_ID];
      transactions[id] = Object.assign({ items: [] }, transactions[id], item);
    });
  }
}

function readCSV(filename) {
  return readFile(filename, { encoding: 'utf8' })
    .then(content => csvParse(content, { columns: true }))
    .then(group => processCSV(filename, group))
    .catch(err => console.log('Error reading CSV file:', err));
}

function convertDollarAmounts(ary) {
  ary.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        convertDollarAmounts(value);
      } else if (value.match(/^\$/)) {
        item[key] = +value.slice(1);
      } else if ([QUANTITY, FEE_PERCENTAGE, FEE_FIXED].includes(key)) {
        item[key] = +value;
      }
    });
  });
}

function readSpreadsheets(folder) {
  console.log(`Reading CSV files from '${folder}'`);
  return readDir(folder)
    .then(files => files.filter(file => file.match(/^(transactions|items).*\.csv$/)))
    .then(files => files.map(file => `${folder}/${file}`))
    .then(files => Promise.each(files.sort().map(readCSV), p => p))
    .then(() => convertDollarAmounts(getTransactions()));
}

function processInputData(folder) {
  return readSpreadsheets(folder);
}

// function generateChildBadgeMailMerge(filename, group) {
  // const columns = ['Order ID', 'Badge Number', 'Adult Name', 'Adult Phone', 'Adult Email'];
  // const records = group
    // .sort((a,b) => a.badgeNum - b.badgeNum)
    // .map(item => {
      // const {
        // badgeNum,
        // [ORDERID_KEY]: orderId,
        // [ADULTNAME_KEY]: adultName,
        // [ADULTPHONE_KEY]: adultPhone,
        // [ADULTEMAIL_KEY]: adultEmail
      // } = item;
      // return [orderId, zeroPad(badgeNum), adultName, adultPhone.trim(), adultEmail];
    // });

  // if (!records.length) return;
  // return writeMailMergeFile(`Mailmerge ${filename} BACK.tab`, records, columns);
// }

function printSummary() {
  const baseFee = (getTransactions().find(t => t[CARD_ENTRY_METHOD] === 'Swiped') || {})[FEE_PERCENTAGE] || 2.75;
  const totals = getTransactions().reduce((acc, transaction) => {
    const {
      [TOTAL_COLLECTED]: total,
      [FEES]: fees,
      [CARD]: card,
      [CASH]: cash,
      [OTHER_TENDER]: other,
      [FEE_PERCENTAGE]: percentage,
      [FEE_FIXED]: fixed,
    } = transaction;
    const diffFee = percentage ? percentage - baseFee : 0;

    acc.total = acc.total + total;
    acc.fees = acc.fees + fees;
    acc.card = acc.card + card;
    acc.cash = acc.cash + cash;
    acc.other = acc.other + other;
    acc.keyedFees = acc.keyedFees - (fixed + (total * diffFee / 100));
    return acc;
  }, { total: 0, card: 0, fees: 0, cash: 0, other: 0, keyedFees: 0 });

  console.log(
    '\nSummary:',
    '\n  Transactions:',       Object.keys(transactions).length,
    '\n  Total:             ', formatCurrency(totals.total),
    '\n  Other tender total:', formatCurrency(totals.other),
    '\n  Cash total:        ', formatCurrency(totals.cash),
    '\n  Credit total:      ', formatCurrency(totals.card),
    '\n  Fees total:        ', formatCurrency(totals.fees), `(keyed fees: ${ formatCurrency(totals.keyedFees) })`,
  );
}

function printFanExperienceReport() {
  const typeRegex = /Photo|Autograph|Selfie/;
  const fanXPFilter = (item) => item[ITEM].match(typeRegex) && ['Fan Experience', 'Guest Handler'].includes(item[CATEGORY]);
  const fanXPSales = getTransactions().reduce((acc, transaction) => {
    const fanXPItems = transaction.items.filter(fanXPFilter);
    fanXPItems.map(item => {
      const count = +item[QUANTITY];
      const modifiers = item[MODIFIERS].split(', ');

      modifiers.map(mod => {
        const type = (item[ITEM].match(typeRegex) || ['?'])[0];
        const key = [item[ITEM], mod].filter(Boolean).join('/');
        acc[key] = (acc[key] || 0) + count;
        acc[`Total ${type}s`] = (acc[`Total ${type}s`] || 0) + count;
      });
    });
    return acc;
  }, {});

  console.log('\nFan Experience sales:');
  Object.entries(fanXPSales)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .filter(([type]) => !type.match(/^total/))
    .forEach(([type, count]) => {
      console.log(`  ${type}:`, count);
    });

  // Print totals
  Object.entries(fanXPSales)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .filter(([type]) => type.match(/^total/))
    .forEach(([type, count]) => {
      console.log(`  ${type}:`, count);
    });
}

function printBadgeCount() {
  // TODO: lookup a regexp based on the year of the transaction date:
  // TODO: add regular expressions for years 2012-2016
  // 2017 data: search for Weekend, Friday, Saturday, Sunday
  // 2018 data: search for Badge
  const badgeSales = getTransactions().reduce((acc, transaction) => {
    const badgeItems = transaction.items.filter(item => item[CATEGORY] === 'Badges');
    badgeItems.map(item => {
      const count = +item[QUANTITY];
      acc[item[ITEM]] = (acc[item[ITEM]] || 0) + count;
      acc.total += count;
    });
    return acc;
  }, { total: 0 });

  console.log('\nBadge sales:');
  Object.entries(badgeSales)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .filter(([type]) => type !== 'total')
    .forEach(([type, count]) => {
      console.log(`  ${type}:`, count);
    });
  console.log('  Total:', badgeSales.total);
}

function calculateTimestamps() {
  getTransactions().forEach(transaction => {
    const [month, day, year] = transaction[DATE].split('/').map(v => parseInt(v, 10));
    const dateArgs = [year + 2000, month - 1, day, ...transaction[TIME].split(':').map(v => parseInt(v, 10))];
    transaction.timestamp = new Date(...dateArgs)
  });
}

function getDateAndTime(date) {
  return [
    [
      date.getFullYear(),
      ('0' + (date.getMonth() + 1)).slice(-2),
      ('0' + date.getDate()).slice(-2),
    ].join('-'),
    date.toTimeString().slice(0,8)
  ];
}

function generateShiftReport(title, dataset = getTransactions(), key = TOTAL_COLLECTED) {
  const getName = (transaction = {}) => [transaction[DEVICE_NICKNAME], transaction[DEVICE_NAME]].filter(Boolean).join('/') || '<unknown>';

  // 1. Sort by Device Nickname | Device Name first, then date/time
  // 2. Create new group whenever transaction has item of SKU=SHIFT_START (and discard transaction), or
  //    Create new group whenever the device name changes
  // 3. Sum TOTAL_COLLECTED per group
  // 4. Calculate start-end date/time per group
  // 5. Print group data
  const groups = dataset
    .sort((a,b) => getName(a).localeCompare(getName(b)) || a.timestamp - b.timestamp)
    .reduce((acc, transaction) => {
      if (transaction.items.some(item => item[SKU].match(/^SHIFT_START/))) {
        acc.unshift([]);
      } else if (getName(acc[0][0]) !== getName(transaction)) {
        acc.unshift([transaction]);
      } else {
        acc[0].push(transaction);
      }
      return acc;
    }, [[]]);


  const summary = groups
    .filter(group => group.length)
    .map(group => group.reduce((acc, transaction) => {
      const timestamp = transaction.timestamp;
      if ((acc.start || timestamp) >= timestamp) { acc.start = timestamp; }
      if ((acc.end   || timestamp) <= timestamp) { acc.end = timestamp; }
      acc.amount = acc.amount + transaction[key];
      acc.device = getName(transaction);
      return acc;
    }, { amount: 0 }));

  console.log(`\nShift report: ${title}:`);
  summary
    .sort((a,b) => a.start - b.start)
    .forEach(group => {
      const { start, end, amount, device } = group;
      const [startDate, startTime] = getDateAndTime(start);
      let [endDate, endTime] = getDateAndTime(end);

      if (startDate === endDate) {
        endDate = ' '.repeat(endDate.length);
      }

      console.log('  ',
                  startDate, startTime,
                  '-',
                  endDate, endTime,
                  'Total:', formatCurrency(amount),
                  `'${device}'`);

      // TODO: Consider writing this group data to CSV file
    });
}

function generateShiftTotalReport() {
  generateShiftReport('All transactions', getTransactions(), TOTAL_COLLECTED);
}

function generateShiftCashReport() {
  generateShiftReport('Cash transactions', getTransactions().filter(t => t[CASH] !== '$0.00'), CASH);
}

function main() {
  if (process.argv.length < 3) {
    console.error('You must specify a folder path, where the input CSV files can be found.');
    process.exit(-1);
  }

  const [folder] = process.argv.slice(2);

  processInputData(folder)
    .then(calculateTimestamps)
    .then(printSummary)
    .then(printBadgeCount)
    .then(printFanExperienceReport)
    .then(generateShiftTotalReport)
    .then(generateShiftCashReport)
    .then(() => console.log('\nDone!'))
    .catch((err) => console.log('Error!', err));
}

// Do the work
main();
