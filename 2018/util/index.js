var csv = require('csv');
var Wreck = require('wreck');
var Fs = require('fs');
var Promise = require('bluebird');

const key = '1lM2W52BqQCc249g3NhRiIBvKllJTc0f6z_ES-QBpqrs';
const config = [
  {
    key,
    gid: 0,
    path: '../StarbaseIndy/2017/data',
    name: 'program',
  },
  {
    key,
    gid: 1,
    path: '../StarbaseIndy/2017/data',
    name: 'people',
  }
];

// ====================================================================
// No need to touch anything below this line
// ====================================================================

const fsWriteFile = Promise.promisify(Fs.writeFile);
const csvParse = Promise.promisify(csv.parse);

function getUri(key, gid) {
  return `https://docs.google.com/spreadsheets/d/${key}/export?format=csv&gid=${gid}`;
};

function processPage(key, gid, processFn) {
  const parseOptions = {
    relax_column_count: true,
    columns: (ary) => ary.map((value) => value.match(/^\d+$/) ? false : value),
  };

  // TODO: this isn't giving us a 304 return value
  const wreckOptions = {
    headers: { 'If-Modified-Since': 'Sun, 12 Feb 2018 01:16:45 GMT' },
  };
  return Wreck.get(getUri(key, gid), wreckOptions)
    .then((response) => { console.log('Response status:', response.statusCode); return response; })
    .then((response) => response.payload)
    .then((payload) => csvParse(payload, parseOptions))
    .then((data) => processFn(gid, data));
}

function dummyFn(gid, data) {
  // console.log(`data ${gid}:`, data);
  return Promise.resolve(gid);
}

function processCSV(gid, data) {
  const init = (obj, key, value) => obj[key] = obj[key] || value;

  data.forEach((row) => {
    // console.log('ROW:', row);
    Object.entries(row).forEach(([name, value]) => {
      value = value.trim();
      if (name.includes('.')) {
        const nameSegments = name.match(/^([^.]+)\.([^.]+)(\.([^.]+))?$/);
        if (value && nameSegments) {
          const item = init(row, nameSegments[1], []);
          if (nameSegments.length >= 5 && nameSegments[4]) {
            init(item, nameSegments[2], {})[nameSegments[4]] = value;
          } else {
            item[nameSegments[2]] = value;
          }
        }
        delete row[name];
      } else if (!value) {
        delete row[name];
      } else {
        row[name] = value;
      }
    });
    // console.log('ROW:', row);
  });
  return Promise.resolve(data);

/*
  // $rows = csv->data;
	foreach ($rows as &$row) {
		foreach ($row as $colName => $colValue) {
			if (strpos($colName, '.')) {
				if ($colValue && preg_match('/^([^.]+)\.([^.]+)(\.([^.]+))?$/', $colName, $matches)) {
					if (!isset($row[$matches[1]])) $row[$matches[1]] = array();
					$x =& $row[$matches[1]];
					if ((count($matches) >= 5) && $matches[4]) {
						if (!isset($x[$matches[2]])) $x[$matches[2]] = array();
						$x[$matches[2]][$matches[4]] = $colValue;
					} else {
						$x[$matches[2]] = $colValue;
					}
				}
				unset($row[$colName]);
			} else if (!$colValue) {
				unset($row[$colName]);
			}
		}
	}

  // json_encode($rows);
*/

/*
var people = [
  {
    "id":"1",
    "bio":"Alan is a fluent Klingon speaker ...",
    "name":["Alan","Anderson"],
    "prog":["2"]
  },{
    "id":"2",
    "bio":"Alton Jackson moved to Indiana ...",
    "name":["Alton","Jackson"],
    "prog":["101"]
  },{
    "id":"3","bio":"Ann Yvette Burton MD i...


var program = [
  {
    "id":"2",
    "title":"Klingon science through the lens of language",
    "date":"2017-11-24",
    "time":"14:00",
    "mins":"60",
    "desc":"We can explore Klingon science and...",
    "loc":["tlhIngan rlvSo' (Intl Boardroom)"],
    "tags":["Discussion","Klingon","STEM"],
    "people":[
      {
        "id":"1",
        "name":"Alan Anderson"
      }
    ]
  },{
    "id":"13",
    "title":"Plus Size Cosplay - No Limits, No Restrictions",
    "date":"2017-11-24",
    "time":"14:00",
    "mins":"60",
    "desc":"I'll be going over some of the common misconceptions about \"appropriate\" body types to cosplay. I'll be
*/
}

function processSheet(config) {
  const promises = [];
  config.forEach((item) => {
    const promise = processPage(item.key, item.gid, processCSV)
      .then((data) => fsWriteFile(`${item.path}/${item.name}.js`, `var ${item.name} = ` + JSON.stringify(data)));
    promises.push(promise);
  });

  return Promise.all(promises);
}


// do the work
processSheet(config)
  .then((values) => { console.log('Done!'); })
  .catch((err) => { console.log('Error:', err); });
