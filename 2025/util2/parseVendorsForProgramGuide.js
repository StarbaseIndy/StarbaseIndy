const csv = require('csv');
const Promise = require('bluebird');
const Fs = require('fs');

const csvParse = Promise.promisify(csv.parse);
const readFile = Promise.promisify(Fs.readFile);
const writeFile = Promise.promisify(Fs.writeFile);


const VENDORNAME2_KEY = 'Company Name';
const VENDORCONFIRMED3_KEY = 'Status'
const VENDORCONFIRMED4_KEY = 'Paid'
const VENDORSELL_KEY = 'What would you like to sell';
const VENDORWEB_KEY = 'Website';
const VENDORBIO_KEY = 'Short Bio for Promotional Material';
const VENDORTYPE_KEY = 'Type of Booth';

const artists = [];
const authors = [];
const vendors = [];


function processCSV(filename, group = [{}]) {
  // Look for the 2019 vendor CSV file.  It's a different format.
  if ((group[0] || {})[VENDORNAME2_KEY]) {
	  const confirmed = group.filter(item => {
      const status = item[VENDORCONFIRMED4_KEY] || item[VENDORCONFIRMED3_KEY] || ''; 
      return !!(status.match(/paid|^[YyXx]/i));
    });

	  // Collect artists, then authors, then vendors
    artists.push(...confirmed.filter(item => !!(item[VENDORTYPE_KEY].match(/artist/i))));
    authors.push(...confirmed.filter(item => !!(item[VENDORTYPE_KEY].match(/author/i))));
    vendors.push(...confirmed.filter(item => !!(item[VENDORTYPE_KEY].match(/vendor/i))));

    return;
  }
}

function readCSV(filename) {
  return readFile(filename, { encoding: 'utf8' })
    .then(content => csvParse(content, { columns: true }))
    .then(group => processCSV(filename, group))
    .catch(err => console.log('Error reading CSV file:', filename, err.toString()));
}

function generateHTML(label, data) {
  const year = (new Date()).getFullYear();
  return `\n\n    <!-- ${label} -->\n    <h2>${label}</h2>\n` + 
  data.map(item => {
    const bizName = item[VENDORNAME2_KEY];
    const bizPic = bizName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/[ ]/g, '_') + '.png';
    const imageUrl = `https://starbaseindy.github.io/StarbaseIndy/${year}/images/${bizPic}`;

    return `
    <hr>
    <a class="bizname" href="${item[VENDORWEB_KEY]}" target="_blank">${bizName}</a>
    <div>
    <a class="bizimg" href="${item[VENDORWEB_KEY]}" target="_blank">
      <img height="100" src="${imageUrl}"/>
    </a>
    <p>${item[VENDORBIO_KEY]}
    <p>On offer: ${item[VENDORSELL_KEY]}
    </div>	
`
  })
  .join('\n');
}

function main() {
  if (process.argv.length < 3) {
    console.error('Error: You must specify a the vendor CSV file.');
    console.error('Usage: <Vendor.CSV>');
    process.exit(-1);
  }

  const [vendorCSV] = process.argv.slice(2);

  readCSV(vendorCSV)
    .then(() => console.log(`\nVendor count: ${artists.length + authors.length + vendors.length}`))
	//.then(html => console.log('Artists: \n', generateHTML('Artists', artists)))
	//.then(html => console.log('Authors: \n', generateHTML('Authors', authors)))
	//.then(html => console.log('Vendors: \n', generateHTML('Vendors', vendors)))
	.then(data => writeFile('vendors.html', generateHTML('Artists', artists) + generateHTML('Authors', authors) + generateHTML('Vendors', vendors), { encoding: 'utf8' }))
    .then(() => console.log('\nDone!  Output written to vendors.html'))
    .catch((err) => console.log('Error!', err));
}


main();

