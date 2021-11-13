'use strict';

const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const DepartmentColors = {
  'Vendor': { department: 'Vendor', departmentColor: 'Yellow' },
  'VIP': { department: 'VIP', departmentColor: 'Red' },
  'Entertainer': { department: 'VIP', departmentColor: 'Red' },
  'Presenter': { department: 'Presenter', departmentColor: 'Red' },
  'GeneralAdorned': { department: '', departmentColor: 'Blue' },
  'General': { department: '', departmentColor: 'Blue' },
};

const BADGENAME_MAX_LEN = 30;

const BILLINGNAME_KEY = 'Billing Name';
const BILLINGEMAIL_KEY = 'Email';
const UNIFYING_EMAIL = 'Product Form: Email';
const UNIFYING_EMAIL2 = 'Product Form: Responsible Adult\'s Email';
const LINEITEM_KEY = 'Lineitem name';
const LINEITEM_PRICE = 'Lineitem price';
const LINEITEM_VARIANT = 'Lineitem variant';
const REALNAME_KEY = 'Product Form: Real Name';
const BADGENAME_KEY = 'Product Form: Badge Name';
const DISCOUNTCODE_KEY = 'Discount Code';
const DISCOUNTAMOUNT_KEY = 'Discount Amount';
const ADULTNAME_KEY = 'Product Form: Responsible Adult\'s Name';
const ADULTPHONE_KEY = 'Product Form: Responsible Adult\'s Phone Number';
const ADULTEMAIL_KEY = 'Product Form: Responsible Adult\'s Email';
const PRIVATE_NOTES = 'Private Notes';
const ORDER_TOTAL = 'Total'; // only appears once per order

// 2018 vendor keys
const VENDORNAME_KEY = 'Business Name';
const VENDORNUMBADGES_KEY = '#Badges';
// 2019 vendor keys
const VENDORNAME2_KEY = 'Company Name';
const VENDORCONFIRMED_KEY = 'Confirmed';
// 2021 vendor keys
const VENDORCONFIRMED2_KEY = 'Confirmed?';
const VENDORBADGECOUNT_KEY = 'How many badges do you need';

const ORDERID_KEY = 'Order ID';
const PAIDAT_KEY = 'Paid at';
const csvParse = Promise.promisify(csv.parse);
const csvStringify = Promise.promisify(csv.stringify);
const readDir = Promise.promisify(Fs.readdir);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);
const cache = {};
const summary = [];
const vendors = []; // sourced separately
const metadata = [];

const fanExperienceRegex = /(Dinner|T-Shirt|V-Neck|Hoodie|Tank Top|Photo|Mask)/;
const badgeRegex = /(Child|Saturday|Shopping|Star|Student|Sunday|Weekend).*Badge/;
const childBadgeRegex = /Child.*Badge/;

// The unique ID generator needs to give us a unique sequence number for every order number
const uniqueIds = {};
function getSortKey(orderId, itemType) {
  // Provide a lookup table of suffixes that will cause the items to sort the way we want for envelope printing.
  const fanXPLookup = {
    'Dinner':   '#1D',
    'Photo':    '#2P',
    'Hoodie':   '#3H',
    'T-Shirt':  '#4T',
    'V-Neck':   '#5V',
    'Tank Top': '#6TT',
    'Mask':     '#7M',
  };

  // Make badge items sort deterministically so we can traverse all badge types in a given order deterministically while assigning badge numbers.
  // This removes coupling on the input file names, but adds coupling to the names of the merchandise in the store.
  const badgeLookup = {
    'Child':    'A',
    'Saturday': 'B',
    'Shopping': 'C',
    'Star':     'D',
    'Student':  'E',
    'Sunday':   'F',
    'Weekend':  'G', // no suffix for weekend badges
  };

  const fanXPMatch = (itemType.match(fanExperienceRegex) || [])[1];
  const badgeMatch = (itemType.match(badgeRegex) || [])[1];
  const orderIdSuffix = fanXPLookup[fanXPMatch] || badgeLookup[badgeMatch] || '';
  const key = orderId + orderIdSuffix;
  // console.log(itemType, key, fanXPMatch || badgeMatch, orderIdSuffix);

  uniqueIds[key] = (uniqueIds[key] + 1) || 1;
  const uniqueIdString = uniqueIds[key].toString().padStart(3, '0');
  return `${key}#${uniqueIdString}`;
}

function zeroPad(num) {
  return ('0000' + num).slice(-4);
}

function spacePad(num, width=4) {
  return (Array(width+1).join(' ') + num).slice(-width);
}

function getAllBadgeItems() {
  return Object.values(cache)
    .reduce((acc, item) => acc.concat(...item), [])
    .filter(item => item[LINEITEM_KEY].match(badgeRegex));
}

function getAllItems() {
  return [].concat(...Object.values(cache));
}

function reverseName(name) {
  return (name || '').split(' ').reverse().join(' ');
}

function uniqueFilter(value, index, array) {
  return array.indexOf(value) === index;
}

function processCSV(filename, group = [{}]) {
  const lineItems = group.map(item => item[LINEITEM_KEY]).filter(uniqueFilter);
  // console.log('Processing CSV file', (lineItems.length > 1 ? 'summary' : lineItems[0]), filename);

  // Look for the 2018 vendor CSV file.  It's a different format.
  if ((group[0] || {})[VENDORNAME_KEY]) {
    vendors.push(...group.filter(item => item[VENDORNAME_KEY] && item[VENDORNAME_KEY] !== 'Total'));
    return;
  }

  // Look for the 2019 vendor CSV file.  It's a different format.
  if ((group[0] || {})[VENDORNAME2_KEY]) {
    vendors.push(...group.filter(item => !!(item[VENDORCONFIRMED_KEY] || item[VENDORCONFIRMED2_KEY]).match(/^[yY]/)));
    return;
  }

  // Look for the summary CSV file.  It has multiple line items.
  if (lineItems.length > 1) {
    summary.push(...group);
    return;
  }

  // Update the cache.
  if (lineItems.length === 1) {
    const transactionData = {}; // within an orderID
    group.map(item => {
      const orderId = parseInt(item[ORDERID_KEY], 10);
      item[ORDERID_KEY] = orderId; // make order ID numeric
      // combine different form names for same information
      item[UNIFYING_EMAIL] = (item[UNIFYING_EMAIL] || item[UNIFYING_EMAIL2] || '').toLowerCase();
      // If the form data doesn't have a unifying email (oops, that's a process failure), then fall back to the billing email
      item[UNIFYING_EMAIL] = (item[UNIFYING_EMAIL] || item[UNIFYING_EMAIL2] || item[BILLINGEMAIL_KEY] || '').toLowerCase();

      item.sortKey = getSortKey(orderId, lineItems[0]);

      transactionData[orderId] = transactionData[orderId] || {};

      // Calculate a responsibleParty name (last name first)
      item.responsibleParty = transactionData[orderId].name =
        reverseName(item[BILLINGNAME_KEY]) ||
        transactionData[orderId].name ||
        reverseName(item[REALNAME_KEY]); // Used when no billing name is associated with a free order.

      // Also replicate the billing email
      item[BILLINGEMAIL_KEY] = transactionData[orderId].email =
        item[BILLINGEMAIL_KEY] || transactionData[orderId].email;

      // Grab any additional metadata from the notes section.  Keys are as they would appear in the downloaded spreadsheet.
      // WARNING: This will apply to ONLY THE FIRST ITEM in an order!  Use the metadata file to manipulate other items!
      // DPM TODO: Change this logic to honor an orderId field in the metadata, add the meta to the transactionData, and apply it to only the correct item.
      ((item[PRIVATE_NOTES] || '').match(/meta: ([^\n]+)/g) || [])
        .reverse()
        .map(it => JSON.parse(it.slice(6)))
        .map(it => Object.assign(item, it));
    });
    cache[lineItems[0] || filename] = group;
    return;
  }
}

function readCSV(filename) {
  return readFile(filename, { encoding: 'utf8' })
    .then(content => csvParse(content, { columns: true }))
    .then(group => processCSV(filename, group))
    .catch(err => console.log('Error reading CSV file:', filename, err.toString()));
}

function readSpreadsheets(folder) {
  console.log(`Reading CSV files from '${folder}'`);
  return readDir(folder)
    .then(files => files.filter(file => file.match(/\.csv$/)))
    .then(files => files.map(file => `${folder}/${file}`))
    .then(files => Promise.each(files.sort().map(readCSV), p => p));
}

function synthesizeMetadata() {
  // 1. Any use of SBI_GURU where there's not already adornment should adorn as presenter
  // 2. When adding the stragglers to the store, we should use a different code for entertainers, and a different code for guests.
  // 3. Same treatment as #1 for codes for entertainers and media guests
  //    SBI_ENTERTAINER, SBI_MEDIA_GUEST, SBI_GURU

  getAllBadgeItems().forEach(item => {
    // DPM TODO: exclude children and students from being shuffled.  This happened a lot for the SBI_GURU discount code.
    if (!item.departmentColor && !item[LINEITEM_KEY].match(childBadgeRegex)) {
      const sortKey = item[ORDERID_KEY] + 'G#001'; // Need to x-ref to the first item in the order to get discount code
      const discountCodes = (getAllBadgeItems().find(item => item.sortKey === sortKey) || {})[DISCOUNTCODE_KEY] || '';

      if (discountCodes.match('SBI_MEDIA_GUEST')) {
        Object.assign(item, DepartmentColors['VIP']);
      }

      if (discountCodes.match('SBI_ENTERTAINER')) {
        Object.assign(item, DepartmentColors['Entertainer']);
      }

      if (discountCodes.match('SBI_GURU')) { // TODO: Move these codes into the DepartmentColors object
        Object.assign(item, DepartmentColors['Presenter']);
      }

      // General admission badges with tagline but no department color get sent to the GeneralAdorned file.
      item.departmentColor = item.departmentColor || (item.tagline ? DepartmentColors['GeneralAdorned'].departmentColor : '');
    }
  });
}

function mixinMetadata() {
  // Split badge name on unicode character '»' to facilitate entering taglines via the store.
  // Mixin the metadata to get new badgeName, tagline, and department, and departmentColor.
  getAllBadgeItems().forEach(item => {
    const metaItem = metadata.find(entry => entry.sortKey === item.sortKey) || {};
    const [ badgeName, tagline = '' ] = (metaItem.BadgeName || item[BADGENAME_KEY] || '').split('»');

    // Object.assign(item, metaItem); // allow any spreadsheet value to be overridden by the metadata
    item[BADGENAME_KEY] = badgeName;
    item.tagline = metaItem.Tagline || tagline;
    item.department = metaItem.Department;
    item.departmentColor = metaItem.DepartmentColor;
  });
}

function verifyMetadata() {
  // Do validation on the metadata
  const allKeys = getAllBadgeItems().map(item => item.sortKey);
  metadata
    .filter(entry => !entry.Note) // skip validation for entries with notes
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .map(entry => {
      // verify that all sortKey values in the metadata actually exist
      if (!entry.sortKey) {
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
    .then(verifyMetadata);
}

function generateBadgeNumbers() {
  let badgeNum = 1;
  getAllBadgeItems()
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .map(item => ((item.badgeNum = badgeNum++), item));
    // .filter(item => item[LINEITEM_KEY].match(/Shopping/))
    // .map(item => console.log(item.badgeNum, item[LINEITEM_KEY], item.responsibleParty));
  return badgeNum - 1;
}

function processInputData(folder, metadataFile) {
  return readSpreadsheets(folder)
    .then(generateBadgeNumbers) // preserve badge count by using tap() below.
    .tap(() => readMetadata(metadataFile))
    .tap(mixinMetadata)
    .tap(synthesizeMetadata);
}

function printBadgeCounts() {
  console.log('\nBadges sold (by type):');
  Object.keys(cache)
    .filter(key => key.match(/Badge/))
    .sort()
    .forEach(key => {
      console.log(`  ${key}: ${cache[key].length}`);
    });
}

function printDiscountCodeCounts() {
  const discountCodes = summary
    .map(item => item[DISCOUNTCODE_KEY])
    .filter(Boolean)
    .map(code => code.split(','))
    .reduce((acc, codes) => acc.concat(codes), [])
    .reduce((acc, code) => (acc[code] = acc[code] + 1 || 1, acc), {});

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

function sortByBadgeNumFn(a,b) {
  return a.badgeNum - b.badgeNum;
}

function generateUnicodeKeyFile() {
  const columns = ['Order ID', 'Badge Number', 'Badge Name', 'Department', 'DepartmentColor', 'Unicode Character', 'Supported Fonts URL'];
  const records = getAllBadgeItems()
    .sort(sortByBadgeNumFn)
    .map(item => {
      const {
        [BADGENAME_KEY]: badgeName,
        department,
        departmentColor,
        badgeNum,
        sortKey } = item;

      if (badgeName.match(/[^ -~]+/g)) {
        // Read more e.g. at: https://www.compart.com/en/unicode/U+30C4
        const unicode = badgeName
          .split('')
          .map(x => x.codePointAt(0))
          .filter(x => x > 0x7f)
          .map(x => `U+${x.toString(16).toUpperCase()}`);

        console.error(`WARNING: Non-printable name for badge #${badgeNum} (order ${sortKey}): ${badgeName}`);
        console.error('         Unicode characters:', unicode);

        const getUrl = (code) => `https://www.fileformat.info/info/unicode/char/${code}/fontsupport.htm`;
        return unicode.map(code => [sortKey, zeroPad(badgeNum), badgeName, department, departmentColor, code, getUrl(code.slice(2))]);
      }

      return [];
    })
    .filter(collection => collection.length)
    .reduce((acc, collection) => acc.concat(collection), []);

  if (!records.length) return;
  return writeMailMergeFile('Unicode key.tab', records, columns);
}

function generateBadgeMailMerge(filename, group, sortFn = sortByBadgeNumFn) {
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
        console.warn(`WARNING: Order ${sortKey} has no badge name! Update the metadata.json file.`);
      } else if (badgeName.length > BADGENAME_MAX_LEN) {
        console.warn(`WARNING: Order ${sortKey} badge name exceeds maximum recommended length: '${badgeName}'`);
      }

      return [sortKey, zeroPad(badgeNum), badgeName, department, tagline];
    });

  if (!records.length) return;

  return writeMailMergeFile(`Mailmerge ${filename}.tab`, records, columns);
}

function generateChildBadgeMailMerge(filename, group) {
  const columns = ['Order ID', 'Badge Number', 'Adult Name', 'Adult Phone', 'Adult Email'];
  const records = group
    .sort(sortByBadgeNumFn)
    .map(item => {
      const {
        badgeNum,
        sortKey,
        [ADULTNAME_KEY]: adultName,
        [ADULTPHONE_KEY]: adultPhone,
        [ADULTEMAIL_KEY]: adultEmail
      } = item;
      return [sortKey, zeroPad(badgeNum), adultName, adultPhone.trim(), adultEmail];
    });

  if (!records.length) return;
  return writeMailMergeFile(`Mailmerge ${filename} BACK.tab`, records, columns);
}

function generateEnvelopeMailMerge() {
  // Front of Packets:

  // The top information (name, email) needs to uniquely identify who can pick up the packet.
  // Note: Billing name won't help anyone if the badge was purchased as an anonymous gift.
  // Note: This may make more sense as [ADULTNAME_KEY]||[REALNAME_KEY], and include only one badge per packet.
  //   We could then allow someone to pick up all packets with the same unifying email (assuming they know the names on the other envelopes).
  //
  // Billing name: <Last Name>, <First Name>
  // UNIFYING FORM Email: <.com>
  //
  // Badge 1: <Type> <Badge Name>
  // Badge 2: <Type> <Badge Name>
  // Etc…
  //
  // Fan Experiences:
  // DWTS
  // PhotoOp
  //
  // Merchandise:
  // Tee-shirts, V-Neck Tee-shirts, Hoodies
  //
  // Note: We're not putting ribbons in envelopes in 2018.
  //       Volunteer ribbons will be given to volunteer coordinators.
  //       Presenter badges are already distinguished by design.
  //
  // Work with full data set
  // Reorganize data set to be keyed on [BILLINGNAME_KEY], then by [UNIFYING_EMAIL]

  const envelopes = getAllItems()
    .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
    .reduce((acc, item) => {
      const { [UNIFYING_EMAIL]: email, [REALNAME_KEY]: realName } = item;

      // When the 'admin@starbaseindy.org' email is encountered:
      // replace the email with the form real name to force a new envelope to be created.
      // replace the billing name with the form real name
      const unifyingEmail = email === 'admin@starbaseindy.org' ? reverseName(realName) + ` (${email})` : email;
      const responsibleParty = email === 'admin@starbaseindy.org' ? reverseName(realName) : item.responsibleParty;

      acc[unifyingEmail] = acc[unifyingEmail] || [];
      acc[unifyingEmail].push(Object.assign({}, item, { responsibleParty }));
      return acc;
    }, {});

  // Now that we have the envelopes organized by billing => email, generate the mailmerge data
  const records = Object.keys(envelopes).map(email =>
    envelopes[email].reduce((acc, item) => {
      const {
        [LINEITEM_KEY]: badgeType,
        [REALNAME_KEY]: realName,
        [PRIVATE_NOTES]: notes,
        [BILLINGEMAIL_KEY]: billingEmail,
        badgeNum,
        sortKey,
        responsibleParty,
      } = item;

      acc.BillingName.push(responsibleParty);
      acc.RealName.push(reverseName(realName));
      acc.Email = acc.Email || email;
      acc.BillingEmail = acc.BillingEmail || billingEmail;

      // Get DWTS by matching 'DWTS: ' in PRIVATE_NOTES of star badge purchases
      acc.DWTS = acc.DWTS.concat(badgeType.match(/Star/) && notes.match(/DWTS: [^\n]+/g) || []);

      if (sortKey.match(/#..#/)) {
        // Photo Ops, Tee-Shirts, Hoodies, DWTS (direct orders)
        const variant = [badgeType, item[LINEITEM_VARIANT]].filter(Boolean).join('/');
        acc.FanXP.push(variant);
      } else {
        // Badges
        const badgeInfo = `#${badgeNum}: ${badgeType}: ${realName}`;
        acc.Badges.push(badgeInfo);
      }

      return acc;
    }, { Email: '', RealName: [], BillingName: [], DWTS: [], FanXP: [], Badges: [] }));

  const envelopeMailMerge = records
    .map(item => ({
      BillingName: item.BillingName.filter(Boolean).filter(uniqueFilter).sort().join(' / '),
      Email: item.Email,
      Badges: item.Badges.filter(Boolean).join('\n'),
      DWTS: item.DWTS.filter(Boolean).join('\n'),
      FanXP: item.FanXP.filter(Boolean).join('\n'),
    }));

  const crossReference = records
    .map(item => item.RealName.filter(Boolean).map(name => ({
      RealName: name,
      BillingName: item.BillingName.filter(Boolean).filter(uniqueFilter).sort().join(' / '),
      BillingEmail: item.BillingEmail,
      Email: item.Email,
    })))
    .reduce((acc, item) => acc.concat(...item), [])
    .sort((a,b) => a.RealName.localeCompare(b.RealName));

  const options = {
    header: true,
    quotedString: true,
    delimiter: '\t',
  };

  return csvStringify(envelopeMailMerge, options)
   .then(data => writeFile('Mailmerge Envelope.tab', '\uFEFF' + data, { encoding: 'utf16le' }))
   .then(() => csvStringify(crossReference, options))
   .then(data => writeFile('Xref Envelope.tab', '\uFEFF' + data, { encoding: 'utf16le' }));
}

function getVendorStartingBadgeNumber() {
  const lastBadge = getAllBadgeItems().sort((a,b) => sortByBadgeNumFn(b,a))[0].badgeNum;
  // Note: The double tilde truncates the decimal value
  const nextHundred = (~~((lastBadge + 99) / 100) * 100); // round to next 100
  return Math.max(600, nextHundred);
}

// DPM TODO: source from presenter spreadsheet to generate presenter badges

function getVendorGroup(startingBadgeNum = getVendorStartingBadgeNumber()) {
  return vendors
    .concat({ [VENDORNUMBADGES_KEY]: 42, [VENDORNAME_KEY]: '\t' }) // Note: This reserves some blank badges
    .map(item => {
      const numBadges = parseInt(item[VENDORNUMBADGES_KEY], 10)
        || parseInt(item[VENDORBADGECOUNT_KEY], 10)
        || parseInt((item[VENDORCONFIRMED_KEY]).split(/\s+-\s+/, 2)[1] || '0', 10)
        || 0;
      return [...Array(numBadges)].map(() => ({
        sortKey: 'none',
        badgeNum: startingBadgeNum++,
        [BADGENAME_KEY]: item[VENDORNAME_KEY] || item[VENDORNAME2_KEY],
        tagline: '',
        ...DepartmentColors['Vendor'],
      }));
    })
    .reduce((acc, badges) => acc.concat(badges), []);
}

function generatePurchaserEmailList() {
  // Save a file that contains the first/last/email of everyone who purchased a badge
  const badges = getAllBadgeItems();
  const byEmail = {};
  let lastDate = ''; // DPM TODO: calculate this upfront along with uniqueID
  let lastEmail = '';

  badges
  .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
  .forEach(item => {
    const email = item[BILLINGEMAIL_KEY] || lastEmail;
    lastDate = item[PAIDAT_KEY] || lastDate; // YYYY-MM-DD HH:MM:SS [-]\d{4}
    if (email !== 'admin@starbaseindy.org' && !item[LINEITEM_KEY].match(childBadgeRegex)) {
      const name = reverseName(item.responsibleParty);
      byEmail[email] = byEmail[email] || {};
      // Note: This consolidates multiple orders down to an email+name pair
      byEmail[email][name] = {
        Email: email,
        Name: name,
      };
    }
  });
  
  const csvData = Object.values(byEmail)
    .map(names => Object.keys(names)
      .map(name => names[name]),
    )
    .reduce((acc, item) => acc.concat(...item), []);

  const options = {
    header: true,
    quotedString: true,
    delimiter: '\t',
  };

  return csvStringify(csvData, options)
   .then(data => writeFile('Purchaser Emails.tab', '\uFEFF' + data, { encoding: 'utf16le' }))
}

function generateMailMergeFiles() {
  console.log(''); // output a newline

  // Export Saturday|Sunday|Weekend|Star|Student (not Children|Shopping)
  const generalBadgesPromise = generateBadgeMailMerge(DepartmentColors['General'].departmentColor,
    getAllBadgeItems()
      .filter(item => !item[LINEITEM_KEY].match(/Children|Shopping/))
      .filter(item => !item.departmentColor)
      .map(item => {
        const extra = {};
        if (item[LINEITEM_KEY].match(/Saturday/)) {
          extra.department = 'SAT + SUN';
        }
        if (item[LINEITEM_KEY].match(/Sunday/)) {
          extra.department = 'SUNDAY ONLY';
        }
        return Object.assign({}, item, extra);
      }));

  // Export staff badges without taglines
  const staffBadgesPromises = getAllBadgeItems()
    .filter(item => item.departmentColor)
    .filter(item => !item.tagline)
    .concat(getVendorGroup()) // Vendors don't have taglines
    .reduce((acc, item) => {
      acc[0][item.departmentColor] = acc[0][item.departmentColor] || [];
      acc[0][item.departmentColor].push(item);
      return acc;
    }, [{}])
    .map(acc => Object.keys(acc).map(key => generateBadgeMailMerge(`Non-Adorned ${key}`, acc[key])));

  // Export staff badges with taglines
  const staffAdornedBadgesPromises = getAllBadgeItems()
    .filter(item => item.departmentColor)
    .filter(item => item.tagline)
    .reduce((acc, item) => {
      acc[0][item.departmentColor] = acc[0][item.departmentColor] || [];
      acc[0][item.departmentColor].push(item);
      return acc;
    }, [{}])
    .map(acc => Object.keys(acc).map(key => generateBadgeMailMerge(`Adorned ${key}`, acc[key])));

  // Export child badges (front AND back)
  const childPromises = Object.keys(cache)
    .filter(key => key.match(childBadgeRegex))
    .map(key =>
      generateChildBadgeMailMerge(key, cache[key])
        .then(() => generateBadgeMailMerge(key, cache[key])));

  const promises = [
    generalBadgesPromise,
    ...staffBadgesPromises,
    ...staffAdornedBadgesPromises,
    ...childPromises,
    // generateVendorMailMerge(),
    generateEnvelopeMailMerge(),
  ];

  return Promise.each(promises, p => p)
    .then(() => console.log(`\nWrote mailmerge files to ${process.cwd()}.  You're welcome.\n`));
}

function summarizeOtherItems() {
  // Report fan experience sales from the summary list
  const categories = summary
    .filter(item => item[LINEITEM_KEY].match(fanExperienceRegex))
    .map(item => [item[LINEITEM_KEY], item[LINEITEM_VARIANT]].filter(Boolean).join('/'))
    .reduce((acc, key) => (acc[key] = acc[key] + 1 || 1, acc), {});

  console.log('\nOther sales counts:');
  Object.keys(categories).sort().forEach(key => {
    console.log(key, categories[key]);
  });
}

function summarizeMonthlySales() {
  // Per month, report on number of badge sales, merch sales, and fan XP sales.  Use table format.
  // If possible, report on average based on the item price.  Ignore discount codes for this?
  if (!summary.length) {
    console.log('\nWARNING: Summary file missing.  Cannot provide month-to-month summary report.');
    return;
  }
  
  const monthlySales = [...Array(12)].map(() => ({
    badge: [],
    star: [],
    DWTS: [],
    merch: [],
    unknown: [],
    discount: [],
    total: [],
  }));
  
  let lastDate = '';
  summary.forEach(item => {
    const type = item[LINEITEM_KEY];
    const total = parseInt(item[ORDER_TOTAL] || 0, 10);
    const price = parseInt(item[LINEITEM_PRICE], 10); // NOTE: assuming 'Lineitem quantity' is always '1'
    const discount = parseInt(item[DISCOUNTAMOUNT_KEY] || '0', 10); // Only count this once per order    
    const typeKey = type.match(/Star.*Badge/) ? 'star'
      : type.match(/Dinner/) ? 'DWTS'
      : type.match(badgeRegex) ? 'badge'
      : 'merch';
      
    lastDate = item[PAIDAT_KEY] || lastDate; // YYYY-MM-DD HH:MM:SS [-]\d{4}
    const month = parseInt(lastDate.split('-')[1], 10) - 1; // make it a zero-based integer    
    const data = monthlySales[month];
    data[typeKey].push(price);
    if (total) { data.total.push(total); }
    if (discount) { data.discount.push(discount); }
    
    // console.log(month, typeKey, price, discount);
    // console.log(JSON.stringify(monthlySales));
  });

  const banner = Array(85).fill('=').join('');
  const star = monthlySales.map(data => spacePad(data.star.reduce((acc, value) => acc + value, 0), 5))
  const badgeCount = monthlySales.map(data => spacePad(data.badge.length, 5));
  const avg = (data) => (data.badge.reduce((acc, value) => acc + value, 0) / data.badge.length) || 0;
  const avgBadgePrice = monthlySales.map(data => spacePad(avg(data).toFixed(2), 5));
  const badge = monthlySales.map(data => spacePad(data.badge.reduce((acc, value) => acc + value, 0), 5));
  const DWTS = monthlySales.map(data => spacePad(data.DWTS.reduce((acc, value) => acc + value, 0), 5));
  const merch = monthlySales.map(data => spacePad(data.merch.reduce((acc, value) => acc + value, 0), 5));
  const discount = monthlySales.map(data => spacePad(data.discount.reduce((acc, value) => acc + value, 0), 5));
  const total = monthlySales.map(data => spacePad(data.total.reduce((acc, value) => acc + value, 0), 5));
  console.log();
  console.log(`Month-by-month Report:
${banner}
=            Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec  =
= badge#:  ${badgeCount.join(' ')}  =
= (avg):   ${avgBadgePrice.join(' ')}  =
= badges:  ${badge.join(' ')}  =
= star:    ${star.join(' ')}  =
= DWTS:    ${DWTS.join(' ')}  =
= merch:   ${merch.join(' ')}  =
= discnts: ${discount.join(' ')}  =
= total:   ${total.join(' ')}  =
${banner}`);
  
  
  // LINEITEM_KEY
  // LINEITEM_PRICE
  // DISCOUNTAMOUNT_KEY
  // .filter(item => item[LINEITEM_KEY].match(fanExperienceRegex))
  // .filter(item => item[LINEITEM_KEY].match(badgeRegex));

}

function generateCrossReferences() {
  // map real name to: billing name, billing email, unifying email
  const realNameCrossRef = getAllItems()
    .map(item => JSON.stringify({
      RealName: reverseName(item[REALNAME_KEY]),
      // When the 'admin@starbaseindy.org' email is encountered, replace the billing name with the form real name
      BillingName: item[UNIFYING_EMAIL] === 'admin@starbaseindy.org' ? reverseName(item[REALNAME_KEY]) : item.responsibleParty,
      BillingEmail: item[BILLINGEMAIL_KEY],
      UnifyingEmail: item[UNIFYING_EMAIL],
    }))
  .sort((a, b) => a.localeCompare(b))
  .filter(uniqueFilter)
  .map(item => JSON.parse(item));

  // map unifying email to each item purchased
  // Items can be photo ops, tee-shirts (variant), badges (with badgeNum, real name)
  const unifyingEmailCrossRef = getAllItems()
   .map(item => JSON.stringify({
     UnifyingEmail: item[UNIFYING_EMAIL],
     Item: [
       item[LINEITEM_KEY],
       [item[LINEITEM_VARIANT]].filter(v => v !== 'Through June 30')[0],
       item.badgeNum,
       item[BADGENAME_KEY]
     ].filter(Boolean).join('/'),
   }))
  .sort((a, b) => a.localeCompare(b))
  .filter(uniqueFilter)
  .map(item => JSON.parse(item));

  const options = {
    header: true,
    quotedString: true,
    delimiter: '\t',
  };

  return csvStringify(realNameCrossRef, options)
   .then(data => writeFile('Xref Real Name.tab', '\uFEFF' + data, { encoding: 'utf16le' }))
   .then(() => csvStringify(unifyingEmailCrossRef, options))
   .then(data => writeFile('Xref UnifyingEmail.tab', '\uFEFF' + data, { encoding: 'utf16le' }));
}

function main() {
  if (process.argv.length < 3) {
    console.error('Error: You must specify a folder path, where the input CSV files can be found.');
    console.error('Usage: <CSVFolder> [metadata.json]');
    process.exit(-1);
  }

  const [folder, metadataFile] = process.argv.slice(2);
  const lookup = process.argv.indexOf('-l')
  if (lookup !== -1) {
    const name = process.argv[lookup + 1];

    processInputData(folder, metadataFile)
      .then(() => getAllBadgeItems()
        .sort((a,b) => a.sortKey.localeCompare(b.sortKey))
        .filter(item => item[REALNAME_KEY].match(new RegExp(name, 'i')))
        .map(item => console.log(`${item.sortKey}: ${item[REALNAME_KEY]}: ${item.badgeNum}: ${item[BADGENAME_KEY]}: ${item[UNIFYING_EMAIL]}`)));

    return;
  }

  processInputData(folder, metadataFile)
    .then(numBadges => console.log('\nTotal badges sold:', numBadges))
    .then(printBadgeCounts)
    .then(summarizeOtherItems)
    .then(() => console.log(`\nVendor count: ${vendors.length}`))
    .then(printDiscountCodeCounts)
    .then(summarizeMonthlySales)
    .then(generateMailMergeFiles)
    .then(generateUnicodeKeyFile)
    .then(generateCrossReferences)
    .then(generatePurchaserEmailList)
    .then(() => console.log('\nDone!'))
    .catch((err) => console.log('Error!', err));
}

// Do the work
main();
