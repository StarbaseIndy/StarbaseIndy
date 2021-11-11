# StarbaseIndy
Repository for web content, such as the (future) registration system, online pocket schedule, etc.


## Online Programming Guide

### Create guide for new year

* Copy folder from prior year
* Update util2 script with new document link
* * e.g.: https://docs.google.com/spreadsheets/d/1BjDDm1Bss-Qn_IbeJIM-MbcefHfW2kVMcMR0bRgMWZI/edit?usp=sharing
* Update index.html
* * new KONOPAS ID
* * delete vendor list
* * update year references
* * update convention dates
* Generate people/program data files using util2 script
* Update publish.html URL to specify year
* Register new convention + year with lambda (CloudFormation/index.js)
* Test publishing lambda
* * Publish: e.g. https://starbaseindy.github.io/StarbaseIndy/2021/publish.html)
* * View: e.g. https://starbaseindy.github.io/StarbaseIndy/2021
* Clean out and pre-populate images folder of presenters/guests
* Update qr-code.png (https://tinyurl.com, https://www.qrcode-monkey.com)
* Update OnlineMap.jpg
* If necessary, update title.jpg, favicon.192.png, and favicon.ico

