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

const getDisplayTime = (item) => {
  const [hour, minute] = item.time.split(':').map(it => +it);
  return (new Date( 0, 0, 1, hour, minute)).toLocaleTimeString().replace(':00 ', '').toLowerCase();
};

const getEndTime = (item) => {
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


const programFile = path.resolve(argv.program);
const code = fs.readFileSync(programFile, 'utf8');
const data = vm.runInNewContext(code + '; program');
const program = data.filter(it => it.id != null && it.loc[0] != null && !(it.status || '').match(/Cancelled/i))
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

  // Also insert a placeholder event for the end date
  const endTime = getEndTime(it);
  acc[date][endTime] ||= {};
  acc[date][endTime][location] ||= {};

  const item = acc[date][time][location];
  if (item && item.title) {
    console.warn(`OVERLAP DETECTED: ${item.date} ${item.time} ${location}: ${item.title} ${item.status || ''} overlaps ${it.title} ${it.status || ''}`)

    // Sometimes overlap is okay.
    // Represent this by "nesting" the later entry into the earlier entry.
    const divStyle = 'width:80%; border:1px solid black;; margin-left: auto; margin-right: 0;';
    it.mins = Math.max(+it.mins, +item.mins);
    it.title += `<br/><br/><div style="${divStyle}">${item.title}</div>`;
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
      if (!item.title) return;
      const itemEndTime = getEndTime(item);
      // See if this item spans any rows
      for (let idx = timeIndex + 1; idx < rowAry.length; idx++) {
        const nextEntry = grid[idx][locIndex];
        if (1 === itemEndTime.localeCompare(nextEntry.time)) {
          nextEntry.skip = true;
          item.rowSpan++;
          // Warn about overlaps
          if (nextEntry.title) {
            console.warn(`OVERLAP DETECTED: ${item.date} ${item.location}: ${item.title} ${item.time} overlaps ${nextEntry.title} ${nextEntry.time}`)
          }
        }
      }
    });
  });
});

// Generate the HTML
const tableStyle = `style="border: 1px solid black; border-collapse: collapse; vertical-align: top;"`;
const makeTableElement = (elementName, content, attrs=[]) => `<${elementName} ${attrs.join(' ')}>${content}</${elementName}>`;
const getTR = (content) => makeTableElement('tr', content, [tableStyle]);
const getTD = (content, attr=[]) => makeTableElement('td', content, [tableStyle, ...attr]);
const getTH = (content) => makeTableElement('th', content, [tableStyle]);
const getDiv = (content, minHeight = 20) => `<div style="min-height: ${minHeight}px">${content}</div>`;
const getTable = (content) => makeTableElement('table', content, [tableStyle]);
const html = {};
Object.entries(dayGrids).forEach(([date, {grid, locCounters}]) => {
  const filteredLocations = Object.keys(locCounters).filter((key) => locCounters[key]);
  const headers = ['', ...filteredLocations].map(it => getTH(it)).join('\n\t\t');
  const rows = ['', getTR(`\n\t\t${headers}\n\t`)];
  grid.forEach((_row, timeIndex) => {
    const columns = [''];
    grid[timeIndex].forEach((item, locIndex) => {
      if (locIndex === 0) columns.push(getTH(getDisplayTime(item))); // push row headers
      if (item.skip || !locCounters[item.location]) return;
      const rowSpan = item.rowSpan ? `rowspan=${item.rowSpan + 1}` : '';
      const bgColor = item.title ? '' : 'bgcolor="LightGray"';
      const minRowHeight = timeDiff(item.time, (grid[timeIndex+1] || [])[locIndex]?.time) / 15 * 20;
      columns.push(getTD(getDiv(item.title || '', minRowHeight), [rowSpan, bgColor]));
    });
    rows.push(getTR(columns.join('\n\t\t')));
  });
  html[date] = getTable(rows.join('\n\t'));
});

let output = '';
Object.entries(html).forEach(([date, table]) => {
  output += `<h2>${ getWeekdayName(date) }</h2>\n${table}`;
});

// Write to output file
fs.writeFileSync('../pocketSchedule.html', output);

console.log('Done!');