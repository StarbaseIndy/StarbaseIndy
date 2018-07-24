<?php

/*  Google Drive Spreadsheet -> JSON converter
 *  Copyright (c) 2013 by Eemeli Aro <eemeli@gmail.com>
 *
 *
 *  Fetches a non-private Google Drive/Docs spreadsheet as CSV and converts it
 *  to JSON. In field names, a "." indicates sub-objects; use zero-indexed
 *  entries to generate arrays rather than objects.
 *
 *  EXAMPLE USAGE:

      <?php
      $key = preg_replace('/\W/', '', @$_GET['key']);
      $gid = isset($_GET['gid']) ? preg_replace('/\D/', '', $_GET['gid']) : '0';

      require_once('gdrive2json.php');

      header("Content-type: application/json; charset=UTF-8;");
      echo gdrive2json($key, $gid);

 *  Permission to use, copy, modify, and/or distribute this software for any
 *  purpose with or without fee is hereby granted, provided that the above
 *  copyright notice and this permission notice appear in all copies.
 *
 *  The software is provided "as is" and the author disclaims all warranties
 *  with regard to this software including all implied warranties of
 *  merchantability and fitness. In no event shall the author be liable for
 *  any special, direct, indirect, or consequential damages or any damages
 *  whatsoever resulting from loss of use, data or profits, whether in an
 *  action of contract, negligence or other tortious action, arising out of
 *  or in connection with the use or performance of this software.
 *
 */


require_once('url_fetch.php');
require_once('parsecsv.lib.php');

function gdrive2json($key, $gid = '0', $version = 'ccc') {
	if (!$key) exit("'key' parameter is required.");

	$url = ($version == 'ccc')
	     ? "https://docs.google.com/spreadsheet/ccc?output=csv&key=$key&gid=$gid"
	     : "https://docs.google.com/spreadsheets/d/$key/export?format=csv&gid=$gid";
	$rc = url_fetch($url, $csv_str);
	if ($rc) exit("URL fetch error: $rc");

	if (preg_match('|<html.*<head.*</head>.*<body.*</body>.*</html>|s', $csv_str)) {
		exit("ERROR: CSV content appears to be an HTML page.\nPlease set document permissions to be  publically accessible via link without any username or password.");
	}
	
	// DPM: DEBUGGING
	$csv_file = "../util/$key.$gid.csv";
	$handle = fopen($csv_file, 'w') or die('Cannot open file:' + $csv_file);
	fwrite($handle, $csv_str);
	fclose($handle);

	$csv = new parseCSV("$csv_str\n");
	$a = $csv->data;

	foreach ($a as &$i) {
		$meta = array();
		foreach ($i as $k => $v) {
			if (strpos($k, '.')) {
				if ($v && preg_match('/^([^.]+)\.([^.]+)(\.([^.]+))?$/', $k, $m)) {
					isset($i[$m[1]]) or $i[$m[1]] = array();
					$x =& $i[$m[1]];
					// Calculate the next index, to keep arrays sequential.  This allows the spreadsheet to be more user-friendly by allowing gaps.
					isset($meta[$m[1]]) or $meta[$m[1]] = array();
					isset($meta[$m[1]][$m[2]]) or $meta[$m[1]][$m[2]] = count($x);
					$index = $meta[$m[1]][$m[2]];

					if ((count($m) >= 5) && $m[4]) {
						isset($x[$index]) or $x[$index] = array();
						$x[$index][$m[4]] = $v;
					} else {
						$x[$index] = $v;
					}
				}
				unset($i[$k]);
			} else if (!$v) {
				unset($i[$k]);
			}
		}
	}

	return json_encode($a);
}