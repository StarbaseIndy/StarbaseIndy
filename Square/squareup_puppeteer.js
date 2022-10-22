const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');

// ==========================================================================
// Get SBI date ranges (Fri-Mon after Thanksgiving)
function getSBIDates(year = (new Date()).getFullYear()) {
  const first = new Date(year, 10, 1);
  const dayOfWeek = first.getDay();
  const thanksgiving = 22 + (11 - dayOfWeek) % 7;
  const startDate = new Date(year, 10, thanksgiving + 1);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), thanksgiving + 3);
  const dateRange = [startDate, endDate].map(it => `${it.getMonth() + 1}/${it.getDate()}/${it.getFullYear()}`);
  console.log('Date Range:', dateRange);
  return dateRange;
}

// ==========================================================================
// Get new Puppeteer browser
async function getNewBrowser(sessionDir) {
  const userDataDir = path.resolve(sessionDir);
  fs.mkdirSync(userDataDir, { recursive: true })

  return puppeteer.launch({ headless: false, userDataDir });
}

// ==========================================================================
// Get element text
async function getElementText(page, elem) {
  return (await page.evaluate(el => el.textContent, elem)).trim();
}

// ==========================================================================
// Pause (milliseconds)
async function pause(timeout = 1000) {
  return new Promise((resolve) => setTimeout(resolve, timeout))
}

// ==========================================================================
// Login
async function login(page) {
  await page.waitForSelector('input[id="email"]', { timeout: 5000 })
  .then(() => page.type('input[id="email"]', 'vendors@starbaseindy.org'))
  .then(() => page.type('input[id="password"]', process.env.SQUAREPWD))
  .then(() => page.click('#login-standard-submit'))
  .catch(() => { throw new Error('Did not encounter login prompt') })
  // Decline any two-factor authentication setup
  .then(() => page.waitForSelector('market-button[data-test-remind-me-later-button]', { timeout: 5000 })
    .then(() => page.click('market-button[data-test-remind-me-later-button]'))
    .then(() => page.waitForSelector('market-button[data-test-two-factor-modal-promo-opt-out-continue-button]'))
    .then(() => page.click('market-button[data-test-two-factor-modal-promo-opt-out-continue-button]'))
    .catch(() => { throw new Error('Did not encounter 2FA prompts') }))
  .catch((e) => console.log(e.message))
  
  // ==========================================================================
  // TODO: deal with captcha?

}

// ==========================================================================
// Select Date
async function selectDate(page, dates) {
  const dateSelector = await page.$('div[class="filter-bar__filters"] div[class$="filter-date"] > button'); // date selector
  await dateSelector.click(); // expand date picker
  console.log('Date picker should be expanded')
  for (let count = 0; count < 2; count++) {
    // maybe .$x()
    const [start, end] = await page.$$('div[class="filter-bar__filters"] input[class*="input-date"]');

    await start.click({ clickCount: 3 });
    await start.type(dates[0]);
    await pause();
    await end.click({ clickCount: 3 });
    await end.type(dates[1]);
    await pause();
    await start.click();
  }

  await dateSelector.click(); // collapse date picker
  console.log('Date picker should be collapsed')

  const dateText = await getElementText(page, dateSelector);
  console.log('Date set to:', dateText);
}


// ==========================================================================
// Select Location
async function selectLocation(page) {
  const locationPicker = await page.$('div[class="filter-bar__filters"] div[class^=location-selector] button'); // location picker
  await pause()
  locationPicker.click(); // expand location picker
  console.log('Location picker should be expanded')
  const allLocations = await page.$('div[class="filter-bar__filters"] label[data-test-option-checkbox="All Locations"] > span > input');
  const allLocationsChecked = await (await allLocations.getProperty('checked')).jsonValue();
  console.log('allLocationsChecked:', allLocationsChecked);
  if (allLocationsChecked) {
    await pause();
    await allLocations.click();
    console.log('All locations should be DESELECTED')
  }

  await pause()
  await page.click('div[class="filter-bar__filters"] label[data-test-option-checkbox="SBI"] > span > input')
  console.log('SBI location should be SELECTED')

  await pause()
  await locationPicker.click() // collapse location picker
  console.log('Location picker should be collapsed')

  let locationText = await getElementText(page, locationPicker);
  console.log('Location picker set to:', locationText);
}

// ==========================================================================
// Export Reports
async function exportReports(page) {
  const [exportButton] = await page.$x('//div[contains(@class, "filter-bar__actions")]//button[contains(., "Export")]');
  
  exportButton.click(); // expand export options
  console.log('Export options should be expanded');
  await pause();

  const [exportDetailButton] = await page.$x('//div[contains(@class, "filter-bar__actions")]//button[contains(., "Items Detail CSV")]');
  const [exportTransactionsButton] = await page.$x('//div[contains(@class, "filter-bar__actions")]//button[contains(., "Transactions CSV")]');

  console.log('FIRST CLICK');
  exportDetailButton.click(); 
  await page.waitForNetworkIdle();

  exportButton.click(); // expand export options again 
  await pause();
  console.log('Export options should be expanded');

  console.log('SECOND CLICK');
  exportTransactionsButton.click();
  await page.waitForNetworkIdle();
  console.log('DONE CLICKING');

  await pause(5000);
}

// ==========================================================================
// Set Download Behavior
async function setDownloadBehavior(page, downloadDir) {
  const downloadPath = path.resolve(downloadDir);
  fs.mkdirSync(downloadPath, { recursive: true })
  fsExtra.emptyDirSync(downloadPath);

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
}

// ==========================================================================
// main
async function main() {
  const dates = getSBIDates(process.argv[2]);

  const browser = await getNewBrowser('./session');
  const page = (await browser.pages())[0];
  // const page = await browser.newPage();
  await page.goto("https://squareup.com/dashboard/sales/transactions");


  await login(page);

  await setDownloadBehavior(page, './download');

  await selectDate(page, dates);
  await pause();

  await selectLocation(page);
  await pause();

  await exportReports(page);
  await pause();

  await browser.close();
}


// ==========================================================================
main();
