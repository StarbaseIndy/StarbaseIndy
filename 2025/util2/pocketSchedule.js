const path = require('path');
const fs = require('fs');
const vm = require('vm');
const argv = require('yargs')
  .usage('Usage: $0 [-p path/to/program.js] [-l locations]')
  .option('p', {
    alias: 'program',
    describe: 'Path to KonOpas program.js file',
    default: '../data/program.js',
    type: 'string'
  })
  .option('l', {
    alias: 'locations',
    describe: 'List of locations in the order they should appear on the pocket schedule',
    default: [],
    type: 'array'
  })
  .option('e', {
    alias: 'exclude',
    describe: 'List of locations to exclude from the pocket schedule',
    default: [],
    type: 'array',
  })
  .argv;

// TODO:
// - Add css page break directives so the pocket schedule will pretty print

// A programming item looks like this:
// { 
//   id: '94',
//   title: 'Kerbal Space Program',
//   status?: 'NEW',
//   date: '2021-11-28',
//   time: '12:00',
//   mins: '120',
//   desc: 'Full Description',
//   loc: [ 'Salon 8' ],
//   tags: [ 'Gaming' ],
//   people: [ { name: "Full Name", id:"3" } ]
// }
//
// Items need to span to their end time.  If nothing else starts at the end time, then a placeholder item must be added.
// It's okay for items to overlap - this can happen in an activity room where planned and general events take place.
// - For this reason, a location has two columns, and most entries will colspan=2, except for overlapping events.

const timeDiff = (time1, time2 = time1) => {
  const [date1, date2] = [time1, time2].map(it => new Date( 0, 0, 1, ...it.split(':', 2)))
  return (date2 - date1) / 60000; // milliseconds to minutes
};

const getItemHeight = (item1) => {
  return item1.mins / 15 * 20; // 20 px high for each quarter hour
};

const getDisplayTime = (item) => {
  const [hour, minute] = item.time.split(':').map(it => +it);
  return (new Date( 0, 0, 1, hour, minute)).toLocaleTimeString().replace(/:00\s/, '').toLowerCase();
};

const getEndTime = (item) => {
  if (isNaN(+item.mins)) {
    console.warn(`WARNING: ${item.date} ${item.loc[0]}: ${item.originalTitle || item.title}: invalid/missing duration (mins)`);
    return item.time;
  }

  const [hour, minute] = item.time.split(':').map(it => +it);
  const timeOfDay = new Date(0, 0, 1, hour, minute + +item.mins);
  const midnightOffset = (timeOfDay.getDate() - 1) * 24;
  return [timeOfDay.getHours() + midnightOffset, timeOfDay.getMinutes()].map(it => it.toString().padStart(2, '0')).join(':');
};

const getWeekdayName = (date) => {
  const dateObj = new Date(...date.split('-').map((it, idx) => idx === 1 ? it-1 : it)); // construct in localtime, not UTC
  const weekday = (dateObj.toLocaleString('en-us', {  weekday: 'long' })); // get the weekday name
  return `${date} ${ weekday }`;
};

const getHashFromArgs = (arg, val) => arg.filter(it => it).reduce((acc, it) => { acc[it] = val; return acc; }, {}); 

const overlapItems = (existingItem, newItem) => {
  // Sometimes overlap is okay.
  // Represent this by "nesting" the later entry into the earlier entry.
  console.warn(`
OVERLAP DETECTED:
  ${existingItem.date} ${existingItem.loc[0]}: ${existingItem.originalTitle || existingItem.title}  ${existingItem.time}-${getEndTime(existingItem)} ${existingItem.status || ''} 
  overlaps
  ${newItem.originalTitle || newItem.title} ${newItem.time}-${getEndTime(newItem)} ${newItem.status || ''}`)
  
  // Keep track of nested items, and bring sub-nested items up
  existingItem.originalTitle ||= existingItem.title;
  existingItem.container ||= [];
  existingItem.container.push(newItem, ...(newItem.container || []));
  newItem.container = [];
  newItem.skip = true;

  // Completely reconstruct the title for existingItem 
  existingItem.title = existingItem.originalTitle;
  existingItem.container.forEach(it => {
    const minHeight = getItemHeight(it);
    const divStyle = `min-height: ${minHeight}px`;
    existingItem.title += `<br/><br/><div class="nested" style="${divStyle}">${it.originalTitle || it.title} ${getDisplayTime(it)}</div>`;
  })

  const endTimeDiff = timeDiff(getEndTime(existingItem), getEndTime(newItem)); // DPM TODO: verify
  if (endTimeDiff > 0) {
    // Existing item ends BEFORE new item end time: extend existing end time
    existingItem.mins = +existingItem.mins + endTimeDiff;
    console.warn(`  WARNING: time extended by ${endTimeDiff} minutes; new end time: ${getEndTime(existingItem)}`);
  }
}

const programFile = path.resolve(argv.program);
const code = fs.readFileSync(programFile, 'utf8');
const data = vm.runInNewContext(code + '; program');
data.forEach(it => it.loc || console.log(`WARNING: ${it.title} has no location!`))
const program = data.filter(it => it.id && it.loc?.at(0) && !(it.status || '').match(/Cancelled/i))
const locationsHash = { // provided headers will be defined first, thus establishing table column order
  ...getHashFromArgs(argv.locations, true),
  ...program.reduce((acc, it) => { it.loc.forEach(loc => acc[loc] = true); return acc; }, {}),
  ...getHashFromArgs(argv.exclude, false),
};
const allLocations = Object.keys(locationsHash).filter(it => locationsHash[it]);


// Arrange data per: date => time => location
// { date: { location: {time: entry} } }
const nestedDateLocTimeData = program.reduce((acc, it) => {
  const { date, time } = it;
  const location = it.loc[0];

  // If the item location is excluded, don't make an entry for it
  if (!locationsHash[location]) return acc;

  acc[date] ||= {};
  acc[date][time] ||= {};

  // Also insert a placeholder event for the end date, which can be overwritten by actual events
  const endTime = getEndTime(it);
  acc[date][endTime] ||= {};
  acc[date][endTime][location] ||= {};

  let item = acc[date][time][location];
  if (item && item.title) {
    if (+it.mins < +item.mins) [it, item] = [item, it]; // swap items
    overlapItems(it, item);
  }

  acc[date][time][location] = it;
  return acc;
}, {});

// Arrange data into a 2d array per day, with each axis sorted
// { date: Array.from(Array(#locations), () => new Array(#timeslots)) }
const dayGrids = {};
Object.entries(nestedDateLocTimeData).sort((a,b) => a[0].localeCompare(b[0])).forEach(([date, times]) => {
  const numTimeSlots = Object.keys(times).length;
  dayGrids[date] = { 
    grid: Array.from(Array(numTimeSlots), () => new Array(allLocations.length)),
    locCounters: allLocations.reduce((acc, it) => { acc[it] = 0; return acc; }, {}),
  };
  Object.entries(times).sort((a,b) => a[0].localeCompare(b[0])).forEach(([time, locations], timeIndex) => {
    allLocations.forEach((location, locIndex) => {
      const entry = locations[location];
      const defaults = { date, time, mins: 0, location, rowSpan: 0, skip: false };
      dayGrids[date].grid[timeIndex][locIndex] = Object.assign({}, defaults, entry);
      dayGrids[date].locCounters[location] += entry?.title ? 1 : 0; // track if a location on a given day has programming
    });
  });
});

// Demark row span areas, and entries to skip 
Object.entries(dayGrids).forEach(([_date, {grid}]) => {
  grid.forEach((_row, timeIndex, rowAry) => {
    grid[timeIndex].forEach((item, locIndex) => {
      if (!item.title || item.skip) return;
      // See if this item spans any rows
      for (let idx = timeIndex + 1; idx < rowAry.length; idx++) {
        const itemEndTime = getEndTime(item); // Note: end time can change if it's merged with another event
        const nextEntry = grid[idx][locIndex];
        if (1 === itemEndTime.localeCompare(nextEntry.time)) {
          // end > start overlap detected
          nextEntry.skip = true;
          item.rowSpan++;
          if (nextEntry.title) {
            // Manage overlapping events
            overlapItems(item, nextEntry);
          }
        }
      }
    });
  });
});

// Generate the HTML

// DPM TODO: See if we can tell table rows to page-break-before: avoid, but tell rows with a rowspan to page-break-before: auto

const makeTableElement = (elementName, content, attrs=[]) => `<${elementName} ${attrs.join(' ')}>${content}</${elementName}>`;
const getTR = (content) => makeTableElement('tr', content);
const getTD = (content, attr=[]) => makeTableElement('td', content, attr);
const getTH = (content, attr=[]) => makeTableElement('th', content, attr);
const getTHead = (content) => makeTableElement('thead', content);
const getTBody = (content) => makeTableElement('tbody', content);
const getDiv = (content, minHeight = 20, elClass = 'div') => `<div class="${elClass}" style="min-height: ${minHeight}px;">${content}</div>`;
const getTable = (content) => makeTableElement('table', content);
const html = {};
Object.entries(dayGrids).forEach(([date, {grid, locCounters}]) => {
  const filteredLocations = Object.keys(locCounters).filter((key) => locCounters[key]);
  const headers = ['', ...filteredLocations].map(it => getTH(it));
  const headerRows = [
    getTR(getTH(`<h2>${ getWeekdayName(date) }</h2>`, [`colspan=${headers.length}`, `style="border: 0px; text-align: left"`])),
    getTR(`\n\t\t${headers.join('\n\t\t')}\n\t`)
  ];
  const rows = [];
  grid.forEach((_row, timeIndex) => {
    const columns = [''];
    grid[timeIndex].forEach((item, locIndex) => {
      if (locIndex === 0) columns.push(getTH(getDisplayTime(item))); // event time
      if (item.skip || !locCounters[item.location]) return;
      const rowSpan = item.rowSpan ? `rowspan=${item.rowSpan + 1}` : '';
      const tdClass = item.title ? '' : 'class="empty"';
      columns.push(
        getTD(
          item.title ? getDiv(item.title || '', getItemHeight(item)) : '', 
          [rowSpan, tdClass],
        )
      );
    });
    rows.push(getTR(columns.join('\n\t\t')));
  });
  html[date] = getTable(
    getTHead(headerRows.join('\n\t'))
    + 
    getTBody(rows.join('\n\t')));
});

let output = `<html>
<head>
  <style>
    .empty {
      background-color: lightgray
    }
    .nested {
      width:80%;
      border:1px solid black; 
      border-right: none; 
      margin-left: auto; 
      margin-right: 0; 
      padding: 2px; 
    } 
    .tableContainer {
      page-break-after: always;
    }
    table { 
      border-collapse: collapse; 
    }
    tr {
      page-break-inside: avoid;
    }
    td, th {
      border: 1px solid black; 
      vertical-align: top; 
      padding: 2px; 
      padding-right: 0px;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
`;
Object.entries(html).forEach(([date, table]) => {
  output += getDiv(table, 0, 'tableContainer');
});
output += '</body></html>'

// Write to output file
fs.writeFileSync('../pocketSchedule.html', output);

console.log('\nDone!');
